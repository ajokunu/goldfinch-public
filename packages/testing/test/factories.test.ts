/**
 * Factory and fixture invariants: every factory-built item must agree with the
 * @goldfinch/shared key builders, the JWT fixtures must carry the locked
 * household claim, and the SimpleFIN fixtures must honor the wire protocol
 * (numeric strings, epoch seconds, posted=0 while pending).
 */

import { describe, expect, it } from 'vitest';
import {
  API_SCOPE,
  HOUSEHOLD_CLAIM,
  HOUSEHOLD_ID,
} from '@goldfinch/shared/constants';
import {
  acctSk,
  budgetSk,
  categorySk,
  gsi1Pk,
  gsi1Sk,
  gsi2Pk,
  gsi2Sk,
  parseTxnSk,
  syncStateSk,
  txnPointerSk,
  txnSk,
  userPk,
} from '@goldfinch/shared/keys';
import { epochToIsoDate } from '@goldfinch/shared/simplefin';
import {
  FIXTURE_DATES,
  FIXTURE_TXN_COFFEE,
  makeAccountItem,
  makeAnonymousEvent,
  makeApiGatewayEvent,
  makeBudgetItem,
  makeCategoryItem,
  makeHouseholdPayloadDayOne,
  makeHouseholdPayloadDayTwo,
  makeJwtClaims,
  makeSyncStateItem,
  makeTransactionItem,
  makeTransactionWithPointer,
  TEST_SUB_AARON,
} from '../src/index.js';

describe('item factories honor the shared key builders', () => {
  it('builds every key through the builders, never by hand', () => {
    const txn = makeTransactionItem({
      txnId: 'txn-9',
      date: '2026-06-05',
      accountId: 'acct-1',
      categoryId: 'groceries',
    });
    expect(txn.PK).toBe(userPk(HOUSEHOLD_ID));
    expect(txn.SK).toBe(txnSk('2026-06-05', 'txn-9'));
    expect(txn.GSI1PK).toBe(gsi1Pk(HOUSEHOLD_ID, 'acct-1'));
    expect(txn.GSI1SK).toBe(gsi1Sk('2026-06-05', 'txn-9'));
    expect(txn.GSI2PK).toBe(gsi2Pk(HOUSEHOLD_ID, 'groceries'));
    expect(txn.GSI2SK).toBe(gsi2Sk('2026-06-05', 'txn-9'));
    expect(parseTxnSk(txn.SK)).toEqual({ date: '2026-06-05', txnId: 'txn-9' });

    expect(makeAccountItem({ accountId: 'a1' }).SK).toBe(acctSk('a1'));
    expect(makeBudgetItem({ categoryId: 'c1' }).SK).toBe(budgetSk('c1'));
    expect(makeCategoryItem({ categoryId: 'c1' }).SK).toBe(categorySk('c1'));
    expect(makeSyncStateItem().SK).toBe(syncStateSk());
  });

  it('keeps the GSI2 spend index sparse: uncategorized rows carry no GSI2 keys', () => {
    const uncategorized = makeTransactionItem();
    expect(uncategorized.categoryId).toBeNull();
    expect(uncategorized).not.toHaveProperty('GSI2PK');
    expect(uncategorized).not.toHaveProperty('GSI2SK');

    const income = makeTransactionItem({
      categoryId: 'salary',
      inSpendIndex: false,
    });
    expect(income).not.toHaveProperty('GSI2PK');

    const transfer = makeTransactionItem({
      categoryId: 'transfer',
      isTransfer: true,
    });
    expect(transfer).not.toHaveProperty('GSI2PK');
  });

  it('pairs each transaction with a pointer at TXNPTR#<txnId> targeting its SK', () => {
    const { transaction, pointer } = makeTransactionWithPointer({
      txnId: 'txn-7',
      date: '2026-06-02',
    });
    expect(pointer.SK).toBe(txnPointerSk('txn-7'));
    expect(pointer.currentSk).toBe(transaction.SK);
    expect(pointer.simplefinTxnId).toBe(transaction.simplefinTxnId);
  });
});

describe('JWT claim fixtures', () => {
  it('defaults to the locked household claim and the api scope', () => {
    const claims = makeJwtClaims();
    expect(claims[HOUSEHOLD_CLAIM]).toBe(HOUSEHOLD_ID);
    expect(claims[HOUSEHOLD_CLAIM]).toBe('goldfinch-home');
    expect(claims['scope']).toBe(API_SCOPE);
    expect(claims['token_use']).toBe('access');
    expect(claims['sub']).toBe(TEST_SUB_AARON);
    // Access tokens carry client_id, never aud.
    expect(claims['client_id']).toBeDefined();
    expect(claims).not.toHaveProperty('aud');
  });

  it('builds HTTP API v2 events with substituted path parameters', () => {
    const event = makeApiGatewayEvent({
      routeKey: 'PATCH /transactions/{txnId}',
      pathParameters: { txnId: 'txn-1' },
      body: { date: '2026-06-05', categoryId: 'groceries' },
    });
    expect(event.routeKey).toBe('PATCH /transactions/{txnId}');
    expect(event.rawPath).toBe('/transactions/txn-1');
    expect(event.requestContext.http.method).toBe('PATCH');
    expect(
      event.requestContext.authorizer.jwt.claims[HOUSEHOLD_CLAIM],
    ).toBe(HOUSEHOLD_ID);
    expect(JSON.parse(event.body ?? '{}')).toEqual({
      date: '2026-06-05',
      categoryId: 'groceries',
    });
  });

  it('anonymous events omit both household and sub (the 401 path)', () => {
    const event = makeAnonymousEvent('GET /accounts');
    const claims = event.requestContext.authorizer.jwt.claims;
    expect(claims).not.toHaveProperty(HOUSEHOLD_CLAIM);
    expect(claims).not.toHaveProperty('sub');
  });
});

describe('SimpleFIN payload fixtures', () => {
  it('uses numeric strings for money and epoch seconds for dates', () => {
    const payload = makeHouseholdPayloadDayOne();
    for (const account of payload.accounts) {
      expect(account.balance).toMatch(/^-?\d+\.\d{2}$/);
      expect(typeof account['balance-date']).toBe('number');
      for (const txn of account.transactions ?? []) {
        expect(txn.amount).toMatch(/^-?\d+\.\d{2}$/);
        expect(typeof txn.posted).toBe('number');
      }
    }
  });

  it('day one carries the coffee transaction as pending (posted=0)', () => {
    const payload = makeHouseholdPayloadDayOne();
    const coffee = payload.accounts
      .flatMap((account) => account.transactions ?? [])
      .find((txn) => txn.id === FIXTURE_TXN_COFFEE);
    expect(coffee?.pending).toBe(true);
    expect(coffee?.posted).toBe(0);
    expect(epochToIsoDate(coffee?.transacted_at ?? 0)).toBe(
      FIXTURE_DATES.coffeePending,
    );
  });

  it('day two posts the coffee transaction into a DIFFERENT date bucket', () => {
    const payload = makeHouseholdPayloadDayTwo();
    const coffee = payload.accounts
      .flatMap((account) => account.transactions ?? [])
      .find((txn) => txn.id === FIXTURE_TXN_COFFEE);
    expect(coffee?.pending).toBe(false);
    expect(epochToIsoDate(coffee?.posted ?? 0)).toBe(FIXTURE_DATES.coffeePosted);
    expect(FIXTURE_DATES.coffeePosted).not.toBe(FIXTURE_DATES.coffeePending);
  });
});
