import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ACCOUNT_TYPES } from '@goldfinch/shared/accountTypes';
import type {
  ListAccountsResponse,
  SummaryResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { makeAccountItem, makeEvent, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const FIXTURES = [
  makeAccountItem({
    SK: 'ACCT#a1',
    name: 'Checking',
    accountType: 'checking',
    institution: 'Chase',
    balanceMinor: 523055,
    balanceDate: 1_749_480_000,
  }),
  makeAccountItem({
    SK: 'ACCT#a2',
    name: 'Savings',
    accountType: 'savings',
    institution: 'Ally',
    balanceMinor: 1_250_000,
    balanceDate: 1_749_400_000,
  }),
  makeAccountItem({
    SK: 'ACCT#a3',
    name: 'Sapphire',
    accountType: 'credit',
    institution: 'Chase',
    // Reported as a positive amount owed; must still subtract from net worth.
    balanceMinor: 685000,
    balanceDate: 1_749_490_000,
  }),
];

describe('GET /summary (and its GET /networth alias)', () => {
  it.each(['GET /summary', 'GET /networth'])(
    '%s computes net worth with liability classification server-side',
    async (routeKey) => {
      ddbMock.on(QueryCommand).resolves({ Items: FIXTURES });
      const res = await handler(makeEvent({ routeKey }));
      expect(res.statusCode).toBe(200);
      const body = parseBody<SummaryResponse>(res);

      expect(body.assetsTotalMinor).toBe(1_773_055);
      expect(body.assetsTotal).toBe('17730.55');
      expect(body.liabilitiesTotalMinor).toBe(685_000);
      expect(body.liabilitiesTotal).toBe('6850.00');
      expect(body.netWorthMinor).toBe(1_088_055);
      expect(body.netWorth).toBe('10880.55');
      expect(body.asOf).toBe(1_749_490_000);
      expect(body.currency).toBe('USD');
    },
  );

  it('groups by type with signed liability contributions and by institution', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: FIXTURES });
    const res = await handler(makeEvent({ routeKey: 'GET /summary' }));
    const body = parseBody<SummaryResponse>(res);

    const credit = body.byType.find((group) => group.type === 'credit')!;
    expect(credit.isLiability).toBe(true);
    expect(credit.totalMinor).toBe(-685_000);
    expect(credit.total).toBe('-6850.00');
    // P8-4: groups carry the effective type id and the shared metadata label.
    expect(credit.typeId).toBe('credit-card');
    expect(credit.label).toBe(ACCOUNT_TYPES['credit-card'].label);

    const checking = body.byType.find((group) => group.type === 'checking')!;
    expect(checking.isLiability).toBe(false);
    expect(checking.typeId).toBe('checking');
    expect(checking.totalMinor).toBe(523_055);

    const chase = body.byInstitution.find((group) => group.institution === 'Chase')!;
    expect(chase.totalMinor).toBe(523_055 - 685_000);
    expect(chase.accounts).toHaveLength(2);
  });

  it('groups by the EFFECTIVE institution so a renamed bank groups under its override', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeAccountItem({
          SK: 'ACCT#a1',
          accountType: 'checking',
          institution: 'Chase',
          balanceMinor: 100_000,
        }),
        // Synced under "Chase Bank, N.A." but the user relabeled it "Chase":
        // both accounts must land in ONE "Chase" group keyed on the effective
        // value, never split across the raw synced strings.
        makeAccountItem({
          SK: 'ACCT#a2',
          accountType: 'savings',
          institution: 'Chase Bank, N.A.',
          institutionOverride: 'Chase',
          balanceMinor: 200_000,
        }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /summary' }));
    const body = parseBody<SummaryResponse>(res);

    const chase = body.byInstitution.find((group) => group.institution === 'Chase')!;
    expect(chase.accounts).toHaveLength(2);
    expect(chase.totalMinor).toBe(300_000);
    // The raw synced label is not a separate group.
    expect(
      body.byInstitution.find((group) => group.institution === 'Chase Bank, N.A.'),
    ).toBeUndefined();
  });

  it('never mixes currencies into the totals (P7-7): non-base accounts are listed, not summed', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        ...FIXTURES,
        makeAccountItem({
          SK: 'ACCT#a4',
          name: 'EU Savings',
          accountType: 'savings',
          institution: 'N26',
          currency: 'EUR',
          balanceMinor: 999_999,
          balanceDate: 1_749_491_000,
        }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /summary' }));
    const body = parseBody<SummaryResponse>(res);

    // Top-level totals are the base-currency (USD) slice, unchanged by EUR.
    expect(body.currency).toBe('USD');
    expect(body.assetsTotalMinor).toBe(1_773_055);
    expect(body.netWorthMinor).toBe(1_088_055);

    // Groups exclude the EUR balance from the USD total but still list the
    // account with its own currency.
    const savings = body.byType.find((group) => group.type === 'savings')!;
    expect(savings.totalMinor).toBe(1_250_000);
    expect(savings.accounts).toHaveLength(2);
    expect(savings.accounts.find((a) => a.accountId === 'a4')!.currency).toBe('EUR');
    const n26 = body.byInstitution.find((group) => group.institution === 'N26')!;
    expect(n26.totalMinor).toBe(0);
    expect(n26.accounts).toHaveLength(1);
  });

  it('reclassifies on the P8-4 overrides: isLiabilityOverride flips an asset into the liabilities total', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        ...FIXTURES,
        // A checking account the user marked as a liability (e.g. an
        // overdraft line synced as 'checking').
        makeAccountItem({
          SK: 'ACCT#a5',
          name: 'Overdraft Line',
          accountType: 'checking',
          institution: 'Chase',
          balanceMinor: 100_000,
          balanceDate: 1_749_492_000,
          isLiabilityOverride: true,
        }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /summary' }));
    const body = parseBody<SummaryResponse>(res);

    // 1,000.00 moved from assets to liabilities relative to the base fixtures.
    expect(body.assetsTotalMinor).toBe(1_773_055);
    expect(body.liabilitiesTotalMinor).toBe(685_000 + 100_000);
    expect(body.netWorthMinor).toBe(1_088_055 - 100_000);

    // It stays in its (effective) checking type group but contributes
    // negatively there, and the account itself reports isLiability true.
    const checking = body.byType.find((group) => group.typeId === 'checking')!;
    expect(checking.totalMinor).toBe(523_055 - 100_000);
    const overdraft = checking.accounts.find((a) => a.accountId === 'a5')!;
    expect(overdraft.isLiability).toBe(true);
    expect(overdraft.accountTypeId).toBe('checking');
  });

  it('groups by the EFFECTIVE type when typeOverride is set, inheriting the new type liability default', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        // Synced as 'other' but the user reclassified it as a loan: it must
        // group under loan AND subtract from net worth (loan default).
        makeAccountItem({
          SK: 'ACCT#a6',
          name: 'Family Loan',
          accountType: 'other',
          institution: 'Manual',
          balanceMinor: 50_000,
          balanceDate: 1_749_493_000,
          typeOverride: 'loan',
        }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /summary' }));
    const body = parseBody<SummaryResponse>(res);

    expect(body.byType.find((group) => group.typeId === 'other')).toBeUndefined();
    const loans = body.byType.find((group) => group.typeId === 'loan')!;
    expect(loans.type).toBe('loan');
    expect(loans.label).toBe(ACCOUNT_TYPES.loan.label);
    expect(loans.isLiability).toBe(true);
    expect(loans.totalMinor).toBe(-50_000);
    expect(body.liabilitiesTotalMinor).toBe(50_000);
    expect(body.netWorthMinor).toBe(-50_000);
  });
});

describe('GET /accounts', () => {
  it('returns AccountDto items with isLiability and the money pair', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: FIXTURES });
    const res = await handler(makeEvent({ routeKey: 'GET /accounts' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<ListAccountsResponse>(res);
    expect(body.items).toHaveLength(3);
    const credit = body.items.find((account) => account.accountId === 'a3')!;
    expect(credit.isLiability).toBe(true);
    expect(credit.balance).toBe('6850.00');
    expect(credit.balanceMinor).toBe(685000);
    const checking = body.items.find((account) => account.accountId === 'a1')!;
    expect(checking.isLiability).toBe(false);
    expect(checking.balance).toBe('5230.55');
  });

  it('maps effective name/institution plus the synced + override fields', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        // No overrides: effective == synced, no override keys emitted.
        makeAccountItem({
          SK: 'ACCT#a1',
          name: 'Checking',
          institution: 'Chase',
        }),
        // Both overrides set: effective wins, synced rides along as a subtitle.
        makeAccountItem({
          SK: 'ACCT#a9',
          name: 'Quicksilver (2224)',
          institution: 'Capital One',
          nameOverride: 'Travel Card',
          institutionOverride: 'My Bank',
        }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /accounts' }));
    const body = parseBody<ListAccountsResponse>(res);

    const plain = body.items.find((account) => account.accountId === 'a1')!;
    expect(plain.name).toBe('Checking');
    expect(plain.syncedName).toBe('Checking');
    expect(plain.institution).toBe('Chase');
    expect(plain.syncedInstitution).toBe('Chase');
    // Absent overrides are not surfaced (prior wire shape preserved).
    expect(plain.nameOverride).toBeUndefined();
    expect(plain.institutionOverride).toBeUndefined();

    const renamed = body.items.find((account) => account.accountId === 'a9')!;
    expect(renamed.name).toBe('Travel Card');
    expect(renamed.syncedName).toBe('Quicksilver (2224)');
    expect(renamed.nameOverride).toBe('Travel Card');
    expect(renamed.institution).toBe('My Bank');
    expect(renamed.syncedInstitution).toBe('Capital One');
    expect(renamed.institutionOverride).toBe('My Bank');
  });

  it('reports P8-4 effective values: accountTypeId honors typeOverride and drives isLiability', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        // No overrides: synced 'credit' maps to the 'credit-card' type id.
        makeAccountItem({ SK: 'ACCT#a3', accountType: 'credit', balanceMinor: 1 }),
        // typeOverride wins over the synced type and brings its liability default.
        makeAccountItem({
          SK: 'ACCT#a7',
          accountType: 'checking',
          balanceMinor: 1,
          typeOverride: 'credit-card',
        }),
        // An explicit liability override beats the overridden type's default.
        makeAccountItem({
          SK: 'ACCT#a8',
          accountType: 'checking',
          balanceMinor: 1,
          typeOverride: 'credit-card',
          isLiabilityOverride: false,
        }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /accounts' }));
    const body = parseBody<ListAccountsResponse>(res);

    const synced = body.items.find((account) => account.accountId === 'a3')!;
    expect(synced.accountTypeId).toBe('credit-card');
    expect(synced.isLiability).toBe(true);

    const overridden = body.items.find((account) => account.accountId === 'a7')!;
    expect(overridden.accountTypeId).toBe('credit-card');
    expect(overridden.accountType).toBe('checking');
    expect(overridden.isLiability).toBe(true);

    const both = body.items.find((account) => account.accountId === 'a8')!;
    expect(both.accountTypeId).toBe('credit-card');
    expect(both.isLiability).toBe(false);
  });
});
