/**
 * Recurring-series detection (P7-1, tuned per P8-5.2/5.3): normalization,
 * tolerance, cadence, detection, short-window monthly, category-hint seeds.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AMOUNT_TOLERANCE_PERCENT,
  CADENCE_WINDOWS,
  MIN_OCCURRENCES,
  RecurrenceError,
  SERIES_ID_VERSION,
  SHORT_WINDOW_MONTHLY_MIN_OCCURRENCES,
  SHORT_WINDOW_MONTHLY_PERIODS,
  SUBSCRIPTIONS_HINT_CATEGORY_ID,
  amountsWithinTolerance,
  classifyCadence,
  daysBetween,
  detectRecurringSeries,
  minOccurrencesFor,
  nextExpectedDate,
  normalizePayeeForRecurrence,
  seriesIdFor,
  type RecurrenceCandidateTxn,
} from '../src/recurrence.js';

function txn(overrides: Partial<RecurrenceCandidateTxn> & { txnId: string }): RecurrenceCandidateTxn {
  return {
    payee: 'NETFLIX.COM',
    amountMinor: -1599,
    currency: 'USD',
    date: '2026-01-15',
    accountId: 'acct-1',
    ...overrides,
  };
}

describe('normalizePayeeForRecurrence', () => {
  it('lowercases and collapses whitespace', () => {
    assert.equal(normalizePayeeForRecurrence('  Spotify   USA  '), 'spotify usa');
  });

  it('strips trailing long digit runs (store/reference numbers)', () => {
    assert.equal(normalizePayeeForRecurrence('NETFLIX.COM 884213'), 'netflix.com');
    assert.equal(normalizePayeeForRecurrence('ACME UTILITIES 0012345'), 'acme utilities');
  });

  it('strips trailing date-shaped tokens', () => {
    assert.equal(normalizePayeeForRecurrence('GEICO 06/01'), 'geico');
    assert.equal(normalizePayeeForRecurrence('GEICO 2026-05-01'), 'geico');
    assert.equal(normalizePayeeForRecurrence('GEICO 12/31/26'), 'geico');
  });

  it('strips trailing #/* reference markers', () => {
    assert.equal(normalizePayeeForRecurrence('Blue Bottle #0042'), 'blue bottle');
    assert.equal(normalizePayeeForRecurrence('Blue Bottle *12'), 'blue bottle');
  });

  it('strips multiple trailing noise tokens', () => {
    assert.equal(normalizePayeeForRecurrence('ACME 06/01 884213'), 'acme');
  });

  it('preserves short interior/trailing numbers that are part of the name', () => {
    assert.equal(normalizePayeeForRecurrence('PHO 75'), 'pho 75');
    assert.equal(normalizePayeeForRecurrence('7 ELEVEN'), '7 eleven');
  });

  it('does not strip alphanumeric tokens', () => {
    assert.equal(normalizePayeeForRecurrence('Hulu HU123456'), 'hulu hu123456');
  });

  it('strips trailing separator punctuation left behind', () => {
    assert.equal(normalizePayeeForRecurrence('ACME - 884213'), 'acme');
  });

  it('never returns empty: all-noise payee falls back to its collapsed form', () => {
    assert.equal(normalizePayeeForRecurrence('884213'), '884213');
  });
});

describe('amountsWithinTolerance', () => {
  it('locks the P8-5.2 tolerance literal', () => {
    assert.equal(AMOUNT_TOLERANCE_PERCENT, 12);
  });

  it('accepts equal amounts and the exact 12% boundary', () => {
    assert.equal(amountsWithinTolerance(-1000, -1000), true);
    // |diff|*100 = 12000 == 12 * max(1000, 880)
    assert.equal(amountsWithinTolerance(-1000, -880), true);
    assert.equal(amountsWithinTolerance(-880, -1000), true);
    // |diff|*100 = 13600 <= 12 * 1136 = 13632
    assert.equal(amountsWithinTolerance(1000, 1136), true);
  });

  it('rejects just past the 12% boundary', () => {
    // |diff|*100 = 12100 > 12 * 1000 = 12000
    assert.equal(amountsWithinTolerance(-1000, -879), false);
    // |diff|*100 = 13700 > 12 * 1137 = 13644
    assert.equal(amountsWithinTolerance(1000, 1137), false);
  });

  it('accepts the 10-12% band that P7-1 used to reject (price-bump fix)', () => {
    // 11% apart: |diff|*100 = 11000 <= 12 * 1000 = 12000
    assert.equal(amountsWithinTolerance(-1000, -890), true);
  });

  it('rejects opposite signs (a refund is not a bill occurrence)', () => {
    assert.equal(amountsWithinTolerance(-1599, 1599), false);
    assert.equal(amountsWithinTolerance(1599, -1599), false);
  });

  it('matches two zeros; zero never matches a non-zero', () => {
    assert.equal(amountsWithinTolerance(0, 0), true);
    assert.equal(amountsWithinTolerance(0, 5), false);
    assert.equal(amountsWithinTolerance(-5, 0), false);
  });

  it('throws on unsafe integers', () => {
    assert.throws(() => amountsWithinTolerance(0.5, 1), RecurrenceError);
    assert.throws(() => amountsWithinTolerance(1, Number.NaN), RecurrenceError);
  });
});

describe('classifyCadence', () => {
  it('maps every locked window boundary correctly', () => {
    const cases: Array<[number, ReturnType<typeof classifyCadence>]> = [
      [5, null], [6, 'weekly'], [7, 'weekly'], [8, 'weekly'], [9, null],
      [11, null], [12, 'biweekly'], [14, 'biweekly'], [16, 'biweekly'], [17, null],
      [25, null], [26, 'monthly'], [30, 'monthly'], [35, 'monthly'], [36, null],
      [349, null], [350, 'yearly'], [365, 'yearly'], [380, 'yearly'], [381, null],
    ];
    for (const [gap, expected] of cases) {
      assert.equal(classifyCadence(gap), expected, `gap ${gap}`);
    }
  });

  it('returns null for non-finite input', () => {
    assert.equal(classifyCadence(Number.NaN), null);
    assert.equal(classifyCadence(Number.POSITIVE_INFINITY), null);
  });

  it('windows and minimums match the locked P7-1 contract', () => {
    assert.deepEqual(CADENCE_WINDOWS.weekly, { minDays: 6, maxDays: 8, nominalDays: 7 });
    assert.deepEqual(CADENCE_WINDOWS.biweekly, { minDays: 12, maxDays: 16, nominalDays: 14 });
    assert.deepEqual(CADENCE_WINDOWS.monthly, { minDays: 26, maxDays: 35, nominalDays: 30 });
    assert.deepEqual(CADENCE_WINDOWS.yearly, { minDays: 350, maxDays: 380, nominalDays: 365 });
    assert.deepEqual(MIN_OCCURRENCES, { weekly: 3, biweekly: 3, monthly: 3, yearly: 2 });
  });
});

describe('minOccurrencesFor (P8-5.2 short-window monthly)', () => {
  it('locks the short-window constants', () => {
    assert.equal(SHORT_WINDOW_MONTHLY_PERIODS, 3);
    assert.equal(SHORT_WINDOW_MONTHLY_MIN_OCCURRENCES, 2);
  });

  it('accepts monthly at 2 occurrences strictly below 3 periods (90 days)', () => {
    assert.equal(minOccurrencesFor('monthly', 89), 2);
    assert.equal(minOccurrencesFor('monthly', 50), 2);
    assert.equal(minOccurrencesFor('monthly', 0), 2);
  });

  it('requires 3 at exactly 90 days and beyond (boundary is strict)', () => {
    assert.equal(minOccurrencesFor('monthly', 90), 3);
    assert.equal(minOccurrencesFor('monthly', 400), 3);
  });

  it('never relaxes when the window is unknown or non-finite', () => {
    assert.equal(minOccurrencesFor('monthly'), 3);
    assert.equal(minOccurrencesFor('monthly', Number.NaN), 3);
    assert.equal(minOccurrencesFor('monthly', Number.POSITIVE_INFINITY), 3);
  });

  it('only monthly is relaxed; other cadences keep their locked minimums', () => {
    assert.equal(minOccurrencesFor('weekly', 50), 3);
    assert.equal(minOccurrencesFor('biweekly', 50), 3);
    assert.equal(minOccurrencesFor('yearly', 50), 2);
  });
});

describe('daysBetween / nextExpectedDate', () => {
  it('computes whole-day gaps, signed', () => {
    assert.equal(daysBetween('2026-01-15', '2026-02-15'), 31);
    assert.equal(daysBetween('2026-02-15', '2026-01-15'), -31);
    assert.equal(daysBetween('2026-06-09', '2026-06-09'), 0);
    // Across a DST change (pure UTC math, no off-by-one).
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  });

  it('weekly/biweekly add plain days', () => {
    assert.equal(nextExpectedDate('2026-01-01', 'weekly'), '2026-01-08');
    assert.equal(nextExpectedDate('2026-12-28', 'weekly'), '2027-01-04');
    assert.equal(nextExpectedDate('2026-01-01', 'biweekly'), '2026-01-15');
  });

  it('monthly adds a calendar month with day clamping', () => {
    assert.equal(nextExpectedDate('2026-03-15', 'monthly'), '2026-04-15');
    assert.equal(nextExpectedDate('2026-01-31', 'monthly'), '2026-02-28');
    assert.equal(nextExpectedDate('2024-01-31', 'monthly'), '2024-02-29');
    assert.equal(nextExpectedDate('2025-12-31', 'monthly'), '2026-01-31');
  });

  it('yearly adds a year, clamping Feb 29', () => {
    assert.equal(nextExpectedDate('2026-06-09', 'yearly'), '2027-06-09');
    assert.equal(nextExpectedDate('2024-02-29', 'yearly'), '2025-02-28');
  });
});

describe('seriesIdFor', () => {
  it('is deterministic, 32 lowercase hex chars', () => {
    const id = seriesIdFor('acct-1', 'USD', 'netflix.com', 'monthly');
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.equal(id, seriesIdFor('acct-1', 'USD', 'netflix.com', 'monthly'));
  });

  it('varies with every component', () => {
    const base = seriesIdFor('acct-1', 'USD', 'netflix.com', 'monthly');
    assert.notEqual(seriesIdFor('acct-2', 'USD', 'netflix.com', 'monthly'), base);
    assert.notEqual(seriesIdFor('acct-1', 'EUR', 'netflix.com', 'monthly'), base);
    assert.notEqual(seriesIdFor('acct-1', 'USD', 'hulu.com', 'monthly'), base);
    assert.notEqual(seriesIdFor('acct-1', 'USD', 'netflix.com', 'yearly'), base);
  });

  it('rejects empty components', () => {
    assert.throws(() => seriesIdFor('', 'USD', 'netflix.com', 'monthly'), RecurrenceError);
  });
});

describe('detectRecurringSeries', () => {
  const monthly = [
    txn({ txnId: 't1', date: '2026-01-15', payee: 'NETFLIX.COM 884213' }),
    txn({ txnId: 't2', date: '2026-02-15', payee: 'NETFLIX.COM 991010' }),
    txn({ txnId: 't3', date: '2026-03-15', payee: 'NETFLIX.COM 123456' }),
  ];

  it('detects a monthly series across payee suffix noise', () => {
    const series = detectRecurringSeries(monthly);
    assert.equal(series.length, 1);
    const s = series[0]!;
    assert.equal(s.cadence, 'monthly');
    assert.equal(s.payeeNormalized, 'netflix.com');
    assert.equal(s.payee, 'NETFLIX.COM 123456');
    assert.equal(s.avgAmountMinor, -1599);
    assert.equal(s.currency, 'USD');
    assert.equal(s.accountId, 'acct-1');
    assert.equal(s.lastDate, '2026-03-15');
    assert.equal(s.nextExpectedDate, '2026-04-15');
    assert.equal(s.occurrenceCount, 3);
    assert.deepEqual(s.txnIds, ['t1', 't2', 't3']);
    assert.equal(s.seriesId, seriesIdFor('acct-1', 'USD', 'netflix.com', 'monthly'));
  });

  it('is order-independent (same output for shuffled input)', () => {
    const shuffled = [monthly[2]!, monthly[0]!, monthly[1]!];
    assert.deepEqual(detectRecurringSeries(shuffled), detectRecurringSeries(monthly));
  });

  it('requires 3 occurrences for monthly', () => {
    assert.deepEqual(detectRecurringSeries(monthly.slice(0, 2)), []);
  });

  it('requires only 2 occurrences for yearly', () => {
    const yearly = [
      txn({ txnId: 'y1', date: '2025-06-01', amountMinor: -9900, payee: 'AMAZON PRIME' }),
      txn({ txnId: 'y2', date: '2026-06-01', amountMinor: -9900, payee: 'AMAZON PRIME' }),
    ];
    const series = detectRecurringSeries(yearly);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.cadence, 'yearly');
    assert.equal(series[0]!.occurrenceCount, 2);
    assert.equal(series[0]!.nextExpectedDate, '2027-06-01');
  });

  it('detects weekly and biweekly cadences', () => {
    const weekly = ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'].map((date, i) =>
      txn({ txnId: `w${i}`, date, payee: 'GYM', amountMinor: -2500 }),
    );
    const biweekly = ['2026-05-01', '2026-05-15', '2026-05-29'].map((date, i) =>
      txn({ txnId: `b${i}`, date, payee: 'CLEANER', amountMinor: -8000 }),
    );
    const series = detectRecurringSeries([...weekly, ...biweekly]);
    assert.deepEqual(
      series.map((s) => [s.payeeNormalized, s.cadence]),
      [
        ['cleaner', 'biweekly'],
        ['gym', 'weekly'],
      ],
    );
  });

  it('groups amounts within the 12% tolerance and averages them (half away from zero)', () => {
    const drift = [
      txn({ txnId: 'd1', date: '2026-01-10', amountMinor: -1699 }),
      txn({ txnId: 'd2', date: '2026-02-10', amountMinor: -1599 }),
      txn({ txnId: 'd3', date: '2026-03-10', amountMinor: -1599 }),
    ];
    const series = detectRecurringSeries(drift);
    assert.equal(series.length, 1);
    // (-1699 - 1599 - 1599) / 3 = -1632.33 -> -1632
    assert.equal(series[0]!.avgAmountMinor, -1632);
  });

  it('keeps far-apart amounts in separate clusters (no series from 3 mixed)', () => {
    // Same payee, alternating -500 / -5000: neither cluster reaches 3 occurrences.
    const mixed = [
      txn({ txnId: 'm1', date: '2026-01-10', amountMinor: -500 }),
      txn({ txnId: 'm2', date: '2026-02-10', amountMinor: -5000 }),
      txn({ txnId: 'm3', date: '2026-03-10', amountMinor: -500 }),
      txn({ txnId: 'm4', date: '2026-04-10', amountMinor: -5000 }),
    ];
    assert.deepEqual(detectRecurringSeries(mixed), []);
  });

  it('separates accounts and currencies into distinct series', () => {
    const other = monthly.map((t, i) => ({ ...t, txnId: `o${i}`, accountId: 'acct-2' }));
    const series = detectRecurringSeries([...monthly, ...other]);
    assert.equal(series.length, 2);
    assert.notEqual(series[0]!.seriesId, series[1]!.seriesId);
  });

  it('ignores irregular gaps that classify to no cadence', () => {
    const irregular = [
      txn({ txnId: 'i1', date: '2026-01-01' }),
      txn({ txnId: 'i2', date: '2026-01-11' }),
      txn({ txnId: 'i3', date: '2026-01-21' }),
      txn({ txnId: 'i4', date: '2026-01-31' }),
    ];
    assert.deepEqual(detectRecurringSeries(irregular), []);
  });

  it('tolerates one missed occurrence via the median gap', () => {
    // Monthly with a skipped month: gaps 31, 62, 31 -> median 31 -> monthly.
    const skipped = [
      txn({ txnId: 's1', date: '2026-01-15' }),
      txn({ txnId: 's2', date: '2026-02-15' }),
      txn({ txnId: 's3', date: '2026-04-18' }),
      txn({ txnId: 's4', date: '2026-05-19' }),
    ];
    const series = detectRecurringSeries(skipped);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.cadence, 'monthly');
  });

  it('counts unique dates only (same-day duplicate does not fake an occurrence)', () => {
    const withDupe = [...monthly.slice(0, 2), txn({ txnId: 'dup', date: '2026-02-15' })];
    assert.deepEqual(detectRecurringSeries(withDupe), []);
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(detectRecurringSeries([]), []);
  });

  it('on a seriesId collision (two amount clusters, one payee) keeps the series with more occurrences', () => {
    // seriesId excludes amount, so a $5 monthly cluster and a $50 monthly
    // cluster of the same payee collide; the 4-occurrence cluster must win.
    const small = ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'].map((date, i) =>
      txn({ txnId: `small${i}`, date, payee: 'STORAGE CO', amountMinor: -500 }),
    );
    const large = ['2026-01-20', '2026-02-20', '2026-03-20'].map((date, i) =>
      txn({ txnId: `large${i}`, date, payee: 'STORAGE CO', amountMinor: -5000 }),
    );
    const series = detectRecurringSeries([...small, ...large]);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.avgAmountMinor, -500);
    assert.equal(series[0]!.occurrenceCount, 4);
    // Deterministic regardless of input order.
    assert.deepEqual(detectRecurringSeries([...large, ...small]), series);
  });

  it('breaks an occurrence-count tie on the collision by later lastDate', () => {
    const early = ['2026-01-10', '2026-02-10', '2026-03-10'].map((date, i) =>
      txn({ txnId: `e${i}`, date, payee: 'STORAGE CO', amountMinor: -500 }),
    );
    const late = ['2026-02-25', '2026-03-25', '2026-04-25'].map((date, i) =>
      txn({ txnId: `l${i}`, date, payee: 'STORAGE CO', amountMinor: -5000 }),
    );
    const series = detectRecurringSeries([...early, ...late]);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.lastDate, '2026-04-25');
    assert.equal(series[0]!.avgAmountMinor, -5000);
    assert.deepEqual(detectRecurringSeries([...late, ...early]), series);
  });

  it('returns series sorted by payeeNormalized, then seriesId', () => {
    const a = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      txn({ txnId: `za${i}`, date, payee: 'ZEBRA GYM', amountMinor: -2000 }),
    );
    const b = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      txn({ txnId: `aa${i}`, date, payee: 'ACME GYM', amountMinor: -3000 }),
    );
    const series = detectRecurringSeries([...a, ...b]);
    assert.deepEqual(
      series.map((s) => s.payeeNormalized),
      ['acme gym', 'zebra gym'],
    );
  });

  it('clusters against the RUNNING mean, not pairwise extremes', () => {
    // -1140 vs -1000 directly: |140|*100 = 14000 > 12*1140 = 13680, NOT
    // within tolerance. But the running mean of {-1140, -1070} is -1105, and
    // |-1105 - (-1000)|*100 = 10500 <= 12*1105 = 13260 — so all three chain
    // into one cluster. A mutant that compares against the first/last element
    // instead of the mean splits them and detects nothing.
    const drift = [
      txn({ txnId: 'r1', date: '2026-01-05', amountMinor: -1140 }),
      txn({ txnId: 'r2', date: '2026-02-05', amountMinor: -1070 }),
      txn({ txnId: 'r3', date: '2026-03-05', amountMinor: -1000 }),
    ];
    const series = detectRecurringSeries(drift);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.occurrenceCount, 3);
    // mean(-1140, -1070, -1000) = -1070 exactly
    assert.equal(series[0]!.avgAmountMinor, -1070);
  });

  it('rejects malformed dates loudly', () => {
    assert.throws(
      () => detectRecurringSeries([txn({ txnId: 'bad', date: 'not-a-date' })]),
      /yyyy-mm-dd/,
    );
  });

  it('stamps source "detector" on every cadence-classified series', () => {
    const series = detectRecurringSeries(monthly);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.source, 'detector');
  });
});

describe('short-window monthly detection (P8-5.2)', () => {
  // Realistic first-link shape: SimpleFIN served ~50 days of history, so a
  // monthly bill has exactly 2 hits (AMC A-List on the 20th).
  const twoMonthly = [
    txn({ txnId: 'amc1', date: '2026-04-20', payee: 'AMC ONLINE 5026', amountMinor: -2599 }),
    txn({ txnId: 'amc2', date: '2026-05-20', payee: 'AMC ONLINE 5027', amountMinor: -2599 }),
  ];

  it('accepts 2 monthly occurrences when the observed window is under 3 periods', () => {
    const series = detectRecurringSeries(twoMonthly, { observedWindowDays: 50 });
    assert.equal(series.length, 1);
    const s = series[0]!;
    assert.equal(s.cadence, 'monthly');
    assert.equal(s.occurrenceCount, 2);
    assert.equal(s.payeeNormalized, 'amc online');
    assert.equal(s.lastDate, '2026-05-20');
    assert.equal(s.nextExpectedDate, '2026-06-20');
    assert.equal(s.source, 'detector');
  });

  it('still requires 3 without a window, and at exactly 90 days', () => {
    assert.deepEqual(detectRecurringSeries(twoMonthly), []);
    assert.deepEqual(detectRecurringSeries(twoMonthly, { observedWindowDays: 90 }), []);
  });

  it('detects at 89 days (strict boundary)', () => {
    assert.equal(detectRecurringSeries(twoMonthly, { observedWindowDays: 89 }).length, 1);
  });

  it('does not relax other cadences in a short window', () => {
    const twoWeekly = [
      txn({ txnId: 'gym1', date: '2026-05-01', payee: 'GYM', amountMinor: -2500 }),
      txn({ txnId: 'gym2', date: '2026-05-08', payee: 'GYM', amountMinor: -2500 }),
    ];
    assert.deepEqual(detectRecurringSeries(twoWeekly, { observedWindowDays: 30 }), []);
  });

  it('still requires the gap to classify as monthly: a 36-day gap detects nothing', () => {
    const offCadence = [
      txn({ txnId: 'x1', date: '2026-04-10', payee: 'IRREGULAR CO', amountMinor: -2000 }),
      txn({ txnId: 'x2', date: '2026-05-16', payee: 'IRREGULAR CO', amountMinor: -2000 }),
    ];
    assert.deepEqual(detectRecurringSeries(offCadence, { observedWindowDays: 50 }), []);
  });
});

describe('subscriptions category-hint cross-seed (P8-5.3)', () => {
  const HINT = { hintCategoryId: SUBSCRIPTIONS_HINT_CATEGORY_ID };
  const sub = (
    overrides: Partial<RecurrenceCandidateTxn> & { txnId: string },
  ): RecurrenceCandidateTxn =>
    txn({ categoryId: SUBSCRIPTIONS_HINT_CATEGORY_ID, ...overrides });

  it('locks the hint category slug', () => {
    assert.equal(SUBSCRIPTIONS_HINT_CATEGORY_ID, 'subscriptions');
  });

  it('seeds a 2-occurrence subscription payee whose gap classifies to no cadence', () => {
    // 20-day gap: classifyCadence(20) === null, so the detector alone emits
    // nothing — the hint pass must, with the 'monthly' fallback cadence.
    const series = detectRecurringSeries(
      [
        sub({ txnId: 'p1', date: '2026-05-01', payee: 'PATREON* MEMBER', amountMinor: -500 }),
        sub({ txnId: 'p2', date: '2026-05-21', payee: 'PATREON* MEMBER', amountMinor: -700 }),
      ],
      HINT,
    );
    assert.equal(series.length, 1);
    const s = series[0]!;
    assert.equal(s.source, 'category-hint');
    assert.equal(s.cadence, 'monthly');
    assert.equal(s.occurrenceCount, 2);
    assert.equal(s.avgAmountMinor, -600); // no amount clustering in the hint pass
    assert.equal(s.lastDate, '2026-05-21');
    assert.equal(s.nextExpectedDate, '2026-06-21');
    assert.deepEqual(s.txnIds, ['p1', 'p2']);
    assert.equal(
      s.seriesId,
      seriesIdFor('acct-1', 'USD', 'patreon* member', 'monthly'),
    );
  });

  it('uses the classified cadence when the median gap lands in a window', () => {
    const series = detectRecurringSeries(
      [
        sub({ txnId: 'b1', date: '2026-05-01', payee: 'SUBSTACK', amountMinor: -800 }),
        sub({ txnId: 'b2', date: '2026-05-15', payee: 'SUBSTACK', amountMinor: -800 }),
      ],
      HINT,
    );
    assert.equal(series.length, 1);
    assert.equal(series[0]!.cadence, 'biweekly');
    assert.equal(series[0]!.nextExpectedDate, '2026-05-29');
    assert.equal(series[0]!.source, 'category-hint');
  });

  it('emits nothing without the hintCategoryId option', () => {
    assert.deepEqual(
      detectRecurringSeries([
        sub({ txnId: 'p1', date: '2026-05-01', amountMinor: -500 }),
        sub({ txnId: 'p2', date: '2026-05-21', amountMinor: -500 }),
      ]),
      [],
    );
  });

  it('never duplicates a payee the detector already emitted (detector wins)', () => {
    const series = detectRecurringSeries(
      [
        sub({ txnId: 'n1', date: '2026-01-15', payee: 'NETFLIX.COM' }),
        sub({ txnId: 'n2', date: '2026-02-15', payee: 'NETFLIX.COM' }),
        sub({ txnId: 'n3', date: '2026-03-15', payee: 'NETFLIX.COM' }),
      ],
      HINT,
    );
    assert.equal(series.length, 1);
    assert.equal(series[0]!.source, 'detector');
    assert.equal(series[0]!.occurrenceCount, 3);
  });

  it('requires 2 UNIQUE dates: one occurrence or a same-day pair seeds nothing', () => {
    assert.deepEqual(
      detectRecurringSeries([sub({ txnId: 'p1', date: '2026-05-01' })], HINT),
      [],
    );
    assert.deepEqual(
      detectRecurringSeries(
        [
          sub({ txnId: 'p1', date: '2026-05-01', amountMinor: -500 }),
          sub({ txnId: 'p2', date: '2026-05-01', amountMinor: -500 }),
        ],
        HINT,
      ),
      [],
    );
  });

  it('ignores uncategorized and other-category transactions', () => {
    const series = detectRecurringSeries(
      [
        txn({ txnId: 'g1', date: '2026-05-01', payee: 'GROCER', categoryId: 'groceries' }),
        txn({ txnId: 'g2', date: '2026-05-21', payee: 'GROCER', categoryId: 'groceries' }),
        txn({ txnId: 'u1', date: '2026-05-02', payee: 'MYSTERY', categoryId: null }),
        txn({ txnId: 'u2', date: '2026-05-22', payee: 'MYSTERY' }),
      ],
      HINT,
    );
    assert.deepEqual(series, []);
  });

  it('counts and averages over the subscription-categorized subset only', () => {
    const series = detectRecurringSeries(
      [
        sub({ txnId: 's1', date: '2026-05-01', payee: 'HULU', amountMinor: -1000 }),
        sub({ txnId: 's2', date: '2026-05-19', payee: 'HULU', amountMinor: -1200 }),
        // Same payee, uncategorized: must not join the hint series.
        txn({ txnId: 'o1', date: '2026-05-10', payee: 'HULU', amountMinor: -9900, categoryId: null }),
      ],
      HINT,
    );
    assert.equal(series.length, 1);
    assert.equal(series[0]!.occurrenceCount, 2);
    assert.equal(series[0]!.avgAmountMinor, -1100);
    assert.deepEqual(series[0]!.txnIds, ['s1', 's2']);
  });

  it('is order-independent with hints in play', () => {
    const input = [
      sub({ txnId: 'p1', date: '2026-05-01', payee: 'PATREON', amountMinor: -500 }),
      sub({ txnId: 'p2', date: '2026-05-21', payee: 'PATREON', amountMinor: -700 }),
      sub({ txnId: 'n1', date: '2026-01-15', payee: 'NETFLIX.COM' }),
      sub({ txnId: 'n2', date: '2026-02-15', payee: 'NETFLIX.COM' }),
      sub({ txnId: 'n3', date: '2026-03-15', payee: 'NETFLIX.COM' }),
    ];
    const forward = detectRecurringSeries(input, HINT);
    const reversed = detectRecurringSeries([...input].reverse(), HINT);
    assert.deepEqual(reversed, forward);
    assert.deepEqual(
      forward.map((s) => [s.payeeNormalized, s.source]),
      [
        ['netflix.com', 'detector'],
        ['patreon', 'category-hint'],
      ],
    );
  });

  it('keeps accounts separate in the hint pass', () => {
    const series = detectRecurringSeries(
      [
        sub({ txnId: 'a1', date: '2026-05-01', payee: 'PATREON', accountId: 'acct-1' }),
        sub({ txnId: 'a2', date: '2026-05-21', payee: 'PATREON', accountId: 'acct-1' }),
        sub({ txnId: 'b1', date: '2026-05-02', payee: 'PATREON', accountId: 'acct-2' }),
        sub({ txnId: 'b2', date: '2026-05-22', payee: 'PATREON', accountId: 'acct-2' }),
      ],
      HINT,
    );
    assert.equal(series.length, 2);
    assert.notEqual(series[0]!.seriesId, series[1]!.seriesId);
    assert.ok(series.every((s) => s.source === 'category-hint'));
  });

  it('suppresses the hint even when its fallback cadence differs from the detector series', () => {
    // The detector emits WEEKLY for this payee (uncategorized cluster); the
    // subscription-categorized cluster's 20-day gap would fall back to
    // MONTHLY — a different seriesId, so only the group-level suppression
    // prevents a duplicate review row for an already-detected payee.
    const weekly = ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'].map((date, i) =>
      txn({ txnId: `w${i}`, date, payee: 'STREAMCO', amountMinor: -1000, categoryId: null }),
    );
    const subs = [
      sub({ txnId: 's1', date: '2026-05-03', payee: 'STREAMCO', amountMinor: -5000 }),
      sub({ txnId: 's2', date: '2026-05-23', payee: 'STREAMCO', amountMinor: -5000 }),
    ];
    const series = detectRecurringSeries([...weekly, ...subs], HINT);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.cadence, 'weekly');
    assert.equal(series[0]!.source, 'detector');
  });

  it('combines with the short window: hint still fires for sub-cadence payees', () => {
    // 2 monthly subscription hits in a short window are caught by the
    // DETECTOR (P8-5.2) — not the hint pass — and stamped 'detector'.
    const series = detectRecurringSeries(
      [
        sub({ txnId: 'm1', date: '2026-04-20', payee: 'AMC ONLINE' }),
        sub({ txnId: 'm2', date: '2026-05-20', payee: 'AMC ONLINE' }),
      ],
      { ...HINT, observedWindowDays: 50 },
    );
    assert.equal(series.length, 1);
    assert.equal(series[0]!.source, 'detector');
  });
});

describe('mutation hardening (P7-10)', () => {
  it('RecurrenceError carries its name and a precise message', () => {
    try {
      amountsWithinTolerance(0.5, 1);
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof RecurrenceError);
      assert.equal(error.name, 'RecurrenceError');
      assert.match(error.message, /amounts must be safe integers in minor units/);
    }
  });

  it('matches positive amounts too (income recurs as well as bills)', () => {
    assert.equal(amountsWithinTolerance(1000, 1000), true);
    assert.equal(amountsWithinTolerance(1000, 950), true);
  });

  it('strips trailing noise down to the last remaining token, no further', () => {
    // '884213' strips (multi-token), then '#1' must SURVIVE as the final token.
    assert.equal(normalizePayeeForRecurrence('#1 884213'), '#1');
  });

  it('falls back to the collapsed form when punctuation stripping empties the result', () => {
    assert.equal(normalizePayeeForRecurrence('##'), '##');
  });

  it('noise tokens are anchored: digit-leading alphanumerics are not noise', () => {
    assert.equal(normalizePayeeForRecurrence('ACME 12345xyz'), 'acme 12345xyz');
  });

  it('locks the seriesId derivation version literal', () => {
    assert.equal(SERIES_ID_VERSION, 'v1');
  });

  it('rejects empty currency and payeeNormalized in seriesIdFor', () => {
    assert.throws(() => seriesIdFor('acct-1', '', 'netflix.com', 'monthly'), /non-empty components/);
    assert.throws(() => seriesIdFor('acct-1', 'USD', '', 'monthly'), /non-empty components/);
  });

  it('zero-pads years below 1000 in calendar math', () => {
    assert.equal(nextExpectedDate('0500-01-31', 'monthly'), '0500-02-28');
    assert.equal(nextExpectedDate('0500-12-28', 'weekly'), '0501-01-04');
  });

  it('orders txnIds by date then txnId, including same-day duplicates, from scrambled input', () => {
    // txnId order deliberately CONFLICTS with date order ('tz' is earliest,
    // 'ta' latest) so a comparator that consults txnId first fails.
    const series = detectRecurringSeries([
      txn({ txnId: 'ta', date: '2026-03-15', payee: 'DUPDAY GYM 444' }),
      txn({ txnId: 'fb', date: '2026-02-15', payee: 'DUPDAY GYM 333' }),
      txn({ txnId: 'fa', date: '2026-02-15', payee: 'DUPDAY GYM 222' }),
      txn({ txnId: 'tz', date: '2026-01-15', payee: 'DUPDAY GYM 111' }),
    ]);
    assert.equal(series.length, 1);
    const s = series[0]!;
    assert.equal(s.occurrenceCount, 3); // 3 unique dates from 4 txns
    assert.deepEqual(s.txnIds, ['tz', 'fa', 'fb', 'ta']);
    assert.equal(s.payee, 'DUPDAY GYM 444'); // display payee = most recent occurrence
    assert.equal(s.lastDate, '2026-03-15');
    assert.equal(s.nextExpectedDate, '2026-04-15');
  });

  it('sorts amounts before clustering: non-monotonic input still chains one cluster', () => {
    // Ascending order chains -1140 -> -1070 -> -1000 via the running mean, but
    // walking the raw input order (-1140, -1000, -1070) would split clusters
    // and detect nothing (-1140 vs -1000 is past 12% pairwise).
    const series = detectRecurringSeries([
      txn({ txnId: 'n1', date: '2026-01-05', amountMinor: -1140 }),
      txn({ txnId: 'n2', date: '2026-02-05', amountMinor: -1000 }),
      txn({ txnId: 'n3', date: '2026-03-05', amountMinor: -1070 }),
    ]);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.occurrenceCount, 3);
    assert.equal(series[0]!.avgAmountMinor, -1070);
  });

  it('replaces the existing series on an occurrence tie when the candidate has a later lastDate', () => {
    // The -5000 cluster sorts first (ascending amounts) and is processed first;
    // the -500 candidate must REPLACE it: equal occurrences, later lastDate.
    const early = ['2026-01-10', '2026-02-10', '2026-03-10'].map((date, i) =>
      txn({ txnId: `te${i}`, date, payee: 'TIE CO', amountMinor: -5000 }),
    );
    const late = ['2026-02-25', '2026-03-25', '2026-04-25'].map((date, i) =>
      txn({ txnId: `tl${i}`, date, payee: 'TIE CO', amountMinor: -500 }),
    );
    const series = detectRecurringSeries([...early, ...late]);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.avgAmountMinor, -500);
    assert.equal(series[0]!.lastDate, '2026-04-25');
  });

  it('keeps the first-processed series when occurrences AND lastDate tie exactly', () => {
    const dates = ['2026-01-15', '2026-02-15', '2026-03-15'];
    const big = dates.map((date, i) =>
      txn({ txnId: `bg${i}`, date, payee: 'EXACT TIE CO', amountMinor: -5000 }),
    );
    const small = dates.map((date, i) =>
      txn({ txnId: `sm${i}`, date, payee: 'EXACT TIE CO', amountMinor: -500 }),
    );
    const series = detectRecurringSeries([...big, ...small]);
    assert.equal(series.length, 1);
    // -5000 sorts first by amount and is processed first; an exact tie must NOT replace it.
    assert.equal(series[0]!.avgAmountMinor, -5000);
  });

  it('never lets a lower-occurrence candidate steal the series, even with a later lastDate', () => {
    const strong = ['2026-01-20', '2026-02-20', '2026-03-20', '2026-04-20'].map((date, i) =>
      txn({ txnId: `st${i}`, date, payee: 'STEAL CO', amountMinor: -5000 }),
    );
    const weak = ['2026-03-12', '2026-04-12', '2026-05-12'].map((date, i) =>
      txn({ txnId: `wk${i}`, date, payee: 'STEAL CO', amountMinor: -500 }),
    );
    const series = detectRecurringSeries([...strong, ...weak]);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.avgAmountMinor, -5000);
    assert.equal(series[0]!.occurrenceCount, 4);
  });

  it('sorts output by payeeNormalized when group processing order disagrees', () => {
    // Groups process in (accountId, currency, payee) key order: acct-1/zebra
    // BEFORE acct-2/acme — the output sort must invert that.
    const zebra = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      txn({ txnId: `z${i}`, date, payee: 'ZEBRA GYM', amountMinor: -2000, accountId: 'acct-1' }),
    );
    const acme = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      txn({ txnId: `a${i}`, date, payee: 'ACME GYM', amountMinor: -3000, accountId: 'acct-2' }),
    );
    const series = detectRecurringSeries([...zebra, ...acme]);
    assert.deepEqual(
      series.map((s) => [s.payeeNormalized, s.accountId]),
      [
        ['acme gym', 'acct-2'],
        ['zebra gym', 'acct-1'],
      ],
    );
  });

  it('orders txnIds identically for EVERY input permutation (exhaustive, with a same-day tie)', () => {
    // txnId order conflicts with date order, and one date is duplicated, so
    // every comparator branch (both call directions) decides at least one
    // permutation. 4 txns => 24 permutations, all must agree exactly.
    const txns = [
      txn({ txnId: 'ta', date: '2026-03-15', payee: 'PERM GYM' }),
      txn({ txnId: 'fb', date: '2026-02-15', payee: 'PERM GYM' }),
      txn({ txnId: 'fa', date: '2026-02-15', payee: 'PERM GYM' }),
      txn({ txnId: 'tz', date: '2026-01-15', payee: 'PERM GYM' }),
    ];
    const permutations = (items: RecurrenceCandidateTxn[]): RecurrenceCandidateTxn[][] => {
      if (items.length <= 1) return [items];
      return items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
      );
    };
    for (const perm of permutations(txns)) {
      const series = detectRecurringSeries(perm);
      const order = perm.map((t) => t.txnId).join(',');
      assert.equal(series.length, 1, order);
      assert.deepEqual(series[0]!.txnIds, ['tz', 'fa', 'fb', 'ta'], order);
      assert.equal(series[0]!.lastDate, '2026-03-15', order);
    }
  });

  it('breaks payeeNormalized ties in the output by ascending seriesId', () => {
    // 'gym a' on acct-2 hashes BELOW its acct-1 sibling, so the sorted output
    // must invert the group-insertion order (acct-1 groups process first).
    const id1 = seriesIdFor('acct-1', 'USD', 'gym a', 'monthly');
    const id2 = seriesIdFor('acct-2', 'USD', 'gym a', 'monthly');
    assert.ok(id2 < id1, 'fixture invariant: the acct-2 series id must sort first');
    const onAcct = (accountId: string, prefix: string) =>
      ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
        txn({ txnId: `${prefix}${i}`, date, payee: 'GYM A', amountMinor: -2000, accountId }),
      );
    const series = detectRecurringSeries([...onAcct('acct-1', 'p'), ...onAcct('acct-2', 'q')]);
    assert.deepEqual(series.map((s) => s.seriesId), [id2, id1]);
    assert.deepEqual(series.map((s) => s.accountId), ['acct-2', 'acct-1']);
  });

  it('orders txnIds by date even when amount order disagrees with date order', () => {
    // Amounts stagger so the (deterministic) amount-sorted cluster order feeds
    // the date sort in an ADVERSARIAL order — equal-amount fixtures cannot do
    // this because the amount sort already canonicalizes to txnId order.
    // All four amounts chain into one cluster via the running 12% tolerance.
    const mk = (txnId: string, date: string, amountMinor: number) =>
      txn({ txnId, date: date as never, amountMinor, payee: 'STAGGER GYM' });
    const fixtures = [
      // Amount-ascending = [ta, fb, fa, tz]: same-day pair reversed, dates reversed.
      [
        mk('ta', '2026-03-15', -1300),
        mk('fb', '2026-02-15', -1250),
        mk('fa', '2026-02-15', -1200),
        mk('tz', '2026-01-15', -1150),
      ],
      // Amount-ascending = [ta, fb, tz, fa]: latest date first, a tie split around tz.
      [
        mk('ta', '2026-03-15', -1300),
        mk('fb', '2026-02-15', -1250),
        mk('tz', '2026-01-15', -1200),
        mk('fa', '2026-02-15', -1150),
      ],
    ];
    for (const fixture of fixtures) {
      const series = detectRecurringSeries(fixture);
      assert.equal(series.length, 1);
      assert.deepEqual(series[0]!.txnIds, ['tz', 'fa', 'fb', 'ta']);
      assert.equal(series[0]!.avgAmountMinor, -1225);
      assert.equal(series[0]!.lastDate, '2026-03-15');
    }
  });

  it('seriesId tie-break holds in BOTH hash directions (strict, not <=)', () => {
    // Two payees chosen so the hash order runs both ways relative to account
    // order: for 'gym a' the acct-2 id sorts first; for 'lawn co' the acct-1
    // id does. A comparator degenerated to <=/>= or a constant cannot satisfy
    // both fixtures at once.
    assert.ok(
      seriesIdFor('acct-2', 'USD', 'gym a', 'monthly') <
        seriesIdFor('acct-1', 'USD', 'gym a', 'monthly'),
      'fixture invariant: gym a inverts account order',
    );
    assert.ok(
      seriesIdFor('acct-1', 'USD', 'lawn co', 'monthly') <
        seriesIdFor('acct-2', 'USD', 'lawn co', 'monthly'),
      'fixture invariant: lawn co preserves account order',
    );
    for (const display of ['GYM A', 'LAWN CO']) {
      const normalized = display.toLowerCase();
      const expected = [
        seriesIdFor('acct-1', 'USD', normalized, 'monthly'),
        seriesIdFor('acct-2', 'USD', normalized, 'monthly'),
      ].sort();
      const onAcct = (accountId: string, prefix: string) =>
        ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
          txn({ txnId: `${prefix}${i}`, date, payee: display, amountMinor: -2000, accountId }),
        );
      for (const input of [
        [...onAcct('acct-1', 'h'), ...onAcct('acct-2', 'k')],
        [...onAcct('acct-2', 'k'), ...onAcct('acct-1', 'h')],
      ]) {
        const series = detectRecurringSeries(input);
        assert.deepEqual(series.map((s) => s.seriesId), expected, display);
      }
    }
  });
});
