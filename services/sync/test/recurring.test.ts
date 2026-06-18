/**
 * Recurrence detection pass (P7-1, tuned per P8-5.2/5.3) integration tests
 * against the stateful FakeDdb: detection writes RECURRING# items via the
 * SHARED detector, the detected -> confirmed / ignored lifecycle survives
 * re-detection (user status is never overwritten; ignored series are never
 * resurrected), the short-window monthly relaxation engages from the OBSERVED
 * data span, and subscriptions-category payees cross-seed as 'category-hint'.
 */

import { recurringSk, txnSk, userPk } from '@goldfinch/shared/keys';
import {
  SUBSCRIPTIONS_HINT_CATEGORY_ID,
  normalizePayeeForRecurrence,
  seriesIdFor,
} from '@goldfinch/shared/recurrence';
import { describe, expect, it } from 'vitest';

import { runRecurrencePass } from '../src/recurring.js';
import { captureLogger } from './capture-logger.js';
import { FakeDdb } from './fake-ddb.js';
import { HOUSEHOLD, NOW, TABLE_NAME } from './fixtures.js';

const PK = userPk(HOUSEHOLD);
const ACCOUNT_ID = 'ACT-checking-1';

const NETFLIX_SERIES_ID = seriesIdFor(
  ACCOUNT_ID,
  'USD',
  normalizePayeeForRecurrence('Netflix'),
  'monthly',
);
const NETFLIX_SK = recurringSk(NETFLIX_SERIES_ID);

function postedTxn(
  date: string,
  txnId: string,
  payee: string,
  amountMinor: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    PK,
    SK: txnSk(date, txnId),
    entityType: 'TRANSACTION',
    schemaVersion: 1,
    amountMinor,
    currency: 'USD',
    payee,
    categoryId: null,
    accountId: ACCOUNT_ID,
    pending: false,
    isTransfer: false,
    postedDate: date,
    simplefinTxnId: txnId,
    categorizedBy: null,
    userCategorized: false,
    lastEditedBy: null,
    version: 1,
    ...overrides,
  };
}

function seedNetflixMonthly(ddb: FakeDdb): void {
  ddb.putItem(postedTxn('2026-03-09', 'TXN-nfx-1', 'Netflix', -1599));
  ddb.putItem(postedTxn('2026-04-09', 'TXN-nfx-2', 'Netflix', -1599));
  ddb.putItem(postedTxn('2026-05-09', 'TXN-nfx-3', 'Netflix', -1650));
}

async function runPass(ddb: FakeDdb, now: Date = NOW) {
  const captured = captureLogger();
  const result = await runRecurrencePass({
    docClient: ddb.asDocClient(),
    tableName: TABLE_NAME,
    household: HOUSEHOLD,
    now,
    lookbackDays: 400,
    logger: captured.logger,
  });
  return { result, captured };
}

describe('runRecurrencePass', () => {
  it('detects a monthly series via the shared detector and writes a RECURRING# item with status detected', async () => {
    const ddb = new FakeDdb();
    seedNetflixMonthly(ddb);

    const { result } = await runPass(ddb);

    expect(result.candidateCount).toBe(3);
    expect(result.seriesUpserted).toBe(1);

    const item = ddb.getItem(PK, NETFLIX_SK);
    expect(item).toBeDefined();
    expect(item?.entityType).toBe('RECURRING_SERIES');
    expect(item?.seriesId).toBe(NETFLIX_SERIES_ID);
    expect(item?.status).toBe('detected');
    expect(item?.payee).toBe('Netflix');
    expect(item?.payeeNormalized).toBe(normalizePayeeForRecurrence('Netflix'));
    expect(item?.cadence).toBe('monthly');
    expect(item?.avgAmountMinor).toBe(-1616); // mean of -1599, -1599, -1650
    expect(item?.currency).toBe('USD');
    expect(item?.accountId).toBe(ACCOUNT_ID);
    expect(item?.occurrenceCount).toBe(3);
    expect(item?.lastDate).toBe('2026-05-09');
    expect(item?.nextExpectedDate).toBe('2026-06-09');
    expect(item?.source).toBe('detector');
    expect(item?.createdAt).toBe(NOW.toISOString());
    expect(item?.updatedAt).toBe(NOW.toISOString());
  });

  it('preserves a user-confirmed status on re-detection while refreshing the bank-derived fields', async () => {
    const ddb = new FakeDdb();
    seedNetflixMonthly(ddb);
    await runPass(ddb);

    // Simulate PATCH /recurring/{seriesId} {status:'confirmed'}.
    const confirmed = { ...ddb.getItem(PK, NETFLIX_SK)!, status: 'confirmed' };
    ddb.putItem(confirmed);

    // A new occurrence lands and the next day's run re-detects.
    ddb.putItem(postedTxn('2026-06-08', 'TXN-nfx-4', 'Netflix', -1599));
    const later = new Date('2026-06-10T13:00:00.000Z');
    const { result } = await runPass(ddb, later);
    expect(result.seriesUpserted).toBe(1);

    const item = ddb.getItem(PK, NETFLIX_SK);
    expect(item?.status).toBe('confirmed'); // user decision survives
    expect(item?.occurrenceCount).toBe(4); // bank-derived fields refreshed
    expect(item?.lastDate).toBe('2026-06-08');
    expect(item?.nextExpectedDate).toBe('2026-07-08');
    expect(item?.createdAt).toBe(NOW.toISOString()); // first-detection stamp kept
    expect(item?.updatedAt).toBe(later.toISOString());
  });

  it('never resurrects an ignored series: status stays ignored across re-detection', async () => {
    const ddb = new FakeDdb();
    seedNetflixMonthly(ddb);
    await runPass(ddb);

    const ignored = { ...ddb.getItem(PK, NETFLIX_SK)!, status: 'ignored' };
    ddb.putItem(ignored);

    ddb.putItem(postedTxn('2026-06-08', 'TXN-nfx-4', 'Netflix', -1599));
    await runPass(ddb, new Date('2026-06-10T13:00:00.000Z'));

    const item = ddb.getItem(PK, NETFLIX_SK);
    expect(item?.status).toBe('ignored');
    expect(item?.occurrenceCount).toBe(4); // refreshed, not resurrected
  });

  it('feeds only POSTED rows to the detector: an all-pending series detects nothing', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(postedTxn('2026-03-09', 'TXN-p-1', 'Gym', -4500, { pending: true }));
    ddb.putItem(postedTxn('2026-04-09', 'TXN-p-2', 'Gym', -4500, { pending: true }));
    ddb.putItem(postedTxn('2026-05-09', 'TXN-p-3', 'Gym', -4500, { pending: true }));

    const { result } = await runPass(ddb);
    expect(result.candidateCount).toBe(0);
    expect(result.seriesUpserted).toBe(0);
    expect(ddb.listSks(PK, 'RECURRING#')).toHaveLength(0);
  });

  it('ignores transactions older than the lookback window', async () => {
    const ddb = new FakeDdb();
    seedNetflixMonthly(ddb);
    // 400-day lookback from 2026-06-09 starts 2025-05-05; this is older.
    ddb.putItem(postedTxn('2025-01-01', 'TXN-old-1', 'Netflix', -1599));

    const { result } = await runPass(ddb);
    expect(result.candidateCount).toBe(3);
    expect(ddb.getItem(PK, NETFLIX_SK)?.occurrenceCount).toBe(3);
  });

  it('accepts 2 monthly occurrences when the OBSERVED data span is under 3 periods (P8-5.2)', async () => {
    const ddb = new FakeDdb();
    // First-link shape: ~50 days of history, AMC A-List hit twice.
    ddb.putItem(postedTxn('2026-04-20', 'TXN-amc-1', 'AMC ONLINE 5026', -2599));
    ddb.putItem(postedTxn('2026-05-20', 'TXN-amc-2', 'AMC ONLINE 5027', -2599));

    const { result } = await runPass(ddb);
    expect(result.candidateCount).toBe(2);
    expect(result.seriesUpserted).toBe(1);

    const sk = recurringSk(
      seriesIdFor(ACCOUNT_ID, 'USD', normalizePayeeForRecurrence('AMC ONLINE 5026'), 'monthly'),
    );
    const item = ddb.getItem(PK, sk);
    expect(item?.cadence).toBe('monthly');
    expect(item?.occurrenceCount).toBe(2);
    expect(item?.status).toBe('detected');
    expect(item?.source).toBe('detector');
    expect(item?.nextExpectedDate).toBe('2026-06-20');
  });

  it('does NOT relax the monthly minimum once stored history spans 3+ periods', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(postedTxn('2026-04-20', 'TXN-amc-1', 'AMC ONLINE', -2599));
    ddb.putItem(postedTxn('2026-05-20', 'TXN-amc-2', 'AMC ONLINE', -2599));
    // Unrelated old transaction stretches the observed window past 90 days.
    ddb.putItem(postedTxn('2026-01-15', 'TXN-old-rent', 'Old Rent Co', -120000));

    const { result } = await runPass(ddb);
    expect(result.candidateCount).toBe(3);
    expect(result.seriesUpserted).toBe(0);
    expect(ddb.listSks(PK, 'RECURRING#')).toHaveLength(0);
  });

  it('pending exclusion never drops a series: the newest PENDING occurrence is excluded without breaking detection (P8-5.2)', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(postedTxn('2026-04-20', 'TXN-amc-1', 'AMC ONLINE', -2599));
    ddb.putItem(postedTxn('2026-05-20', 'TXN-amc-2', 'AMC ONLINE', -2599));
    // The newest occurrence is still pending on detection day.
    ddb.putItem(postedTxn('2026-06-08', 'TXN-amc-3', 'AMC ONLINE', -2599, { pending: true }));

    const { result } = await runPass(ddb);
    expect(result.candidateCount).toBe(2); // pending row excluded from input
    expect(result.seriesUpserted).toBe(1);

    const sk = recurringSk(
      seriesIdFor(ACCOUNT_ID, 'USD', normalizePayeeForRecurrence('AMC ONLINE'), 'monthly'),
    );
    const item = ddb.getItem(PK, sk);
    expect(item?.lastDate).toBe('2026-05-20'); // newest POSTED occurrence
    expect(item?.occurrenceCount).toBe(2);

    // Next day the pending row posts (re-keyed by the writer) and detection
    // picks it up: the series advances instead of having been lost.
    ddb.deleteItem(PK, txnSk('2026-06-08', 'TXN-amc-3'));
    ddb.putItem(postedTxn('2026-06-20', 'TXN-amc-3', 'AMC ONLINE', -2599));
    await runPass(ddb, new Date('2026-06-21T13:00:00.000Z'));
    const advanced = ddb.getItem(PK, sk);
    expect(advanced?.occurrenceCount).toBe(3);
    expect(advanced?.lastDate).toBe('2026-06-20');
  });

  it('cross-seeds a >=2-occurrence subscriptions payee as a category-hint series (P8-5.3)', async () => {
    const ddb = new FakeDdb();
    // Gap of 20 days classifies to no cadence; the subscriptions category
    // must still surface the payee for review.
    ddb.putItem(
      postedTxn('2026-05-01', 'TXN-pat-1', 'PATREON* MEMBER', -500, {
        categoryId: SUBSCRIPTIONS_HINT_CATEGORY_ID,
      }),
    );
    ddb.putItem(
      postedTxn('2026-05-21', 'TXN-pat-2', 'PATREON* MEMBER', -700, {
        categoryId: SUBSCRIPTIONS_HINT_CATEGORY_ID,
      }),
    );

    const { result } = await runPass(ddb);
    expect(result.seriesUpserted).toBe(1);

    const sk = recurringSk(
      seriesIdFor(ACCOUNT_ID, 'USD', normalizePayeeForRecurrence('PATREON* MEMBER'), 'monthly'),
    );
    const item = ddb.getItem(PK, sk);
    expect(item?.source).toBe('category-hint');
    expect(item?.status).toBe('detected'); // surfaced in the review list
    expect(item?.cadence).toBe('monthly'); // subscriptions fallback cadence
    expect(item?.occurrenceCount).toBe(2);
    expect(item?.avgAmountMinor).toBe(-600);
  });

  it('does not cross-seed non-subscription payees at 2 low-confidence occurrences', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(postedTxn('2026-05-01', 'TXN-g-1', 'GROCER', -500, { categoryId: 'groceries' }));
    ddb.putItem(postedTxn('2026-05-21', 'TXN-g-2', 'GROCER', -700, { categoryId: 'groceries' }));

    const { result } = await runPass(ddb);
    expect(result.seriesUpserted).toBe(0);
    expect(ddb.listSks(PK, 'RECURRING#')).toHaveLength(0);
  });

  it('upgrades a category-hint series to detector in place, preserving createdAt and a user confirm', async () => {
    const ddb = new FakeDdb();
    // Long history (window >= 90d), so 2 monthly hits are below the detector
    // minimum — only the subscriptions hint surfaces them.
    ddb.putItem(postedTxn('2025-06-15', 'TXN-bg', 'Background Co', -1000));
    const sub = (date: string, id: string) =>
      postedTxn(date, id, 'Disney Plus', -1399, {
        categoryId: SUBSCRIPTIONS_HINT_CATEGORY_ID,
      });
    ddb.putItem(sub('2026-03-09', 'TXN-dis-1'));
    ddb.putItem(sub('2026-04-09', 'TXN-dis-2'));

    await runPass(ddb);
    const sk = recurringSk(
      seriesIdFor(ACCOUNT_ID, 'USD', normalizePayeeForRecurrence('Disney Plus'), 'monthly'),
    );
    expect(ddb.getItem(PK, sk)?.source).toBe('category-hint');
    expect(ddb.getItem(PK, sk)?.occurrenceCount).toBe(2);

    // User confirms the hint from the review list.
    ddb.putItem({ ...ddb.getItem(PK, sk)!, status: 'confirmed' });

    // A third occurrence reaches detector confidence: same seriesId, source
    // upgrades, the user's confirm and first-detection stamp survive.
    ddb.putItem(sub('2026-05-09', 'TXN-dis-3'));
    await runPass(ddb, new Date('2026-06-10T13:00:00.000Z'));

    const upgraded = ddb.getItem(PK, sk);
    expect(upgraded?.source).toBe('detector');
    expect(upgraded?.occurrenceCount).toBe(3);
    expect(upgraded?.status).toBe('confirmed');
    expect(upgraded?.createdAt).toBe(NOW.toISOString());
  });

  it('skips structurally corrupt rows with a warning and still detects from the healthy rows', async () => {
    const ddb = new FakeDdb();
    seedNetflixMonthly(ddb);
    ddb.putItem(postedTxn('2026-05-10', 'TXN-bad-1', 'Corrupt Co', 12.5));
    ddb.putItem(postedTxn('2026-05-11', 'TXN-bad-2', 'No Currency Co', -1000, { currency: '' }));
    ddb.putItem(postedTxn('2026-05-12', 'TXN-bad-3', '', -1000)); // payee-less: normal data, no warn

    const { result, captured } = await runPass(ddb);

    expect(result.candidateCount).toBe(3); // only the healthy Netflix rows
    expect(result.seriesUpserted).toBe(1);
    const warns = captured.atLevel('warn');
    expect(warns.map((line) => line.msg)).toEqual([
      'skipping transaction with non-integer amountMinor in recurrence pass',
      'skipping transaction with missing currency in recurrence pass',
    ]);
  });
});
