/**
 * GET /cashflow — per-month income vs expense vs net (master plan section 15).
 *
 * Query forms: ?month=yyyy-mm (single month) or ?from=yyyy-mm&to=yyyy-mm
 * (inclusive range, capped at MAX_CASHFLOW_MONTHS). Defaults to the current
 * calendar month in DEFAULT_TZ.
 *
 * Rules:
 * - Pending transactions are excluded (posted-only actuals).
 * - Transfers are excluded: isTransfer flag or a TRANSFER-typed category.
 * - Classification: a category of type INCOME counts toward income, EXPENSE
 *   toward expense; uncategorized rows fall back to the amount sign (positive
 *   = income, negative = expense). Refunds inside an EXPENSE category reduce
 *   expense rather than inflate income.
 * - income/expense are positive magnitudes; net = income - expense.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  KEY_PREFIX,
  parseTxnSk,
  txnDateRangeBounds,
  userPk,
  type TxnSk,
} from '@goldfinch/shared/keys';
import {
  addMinor,
  negateMinor,
  toCurrencyDecimalString,
} from '@goldfinch/shared/money';
import type {
  CashflowMonth,
  CashflowResponse,
  CategoryItem,
  CategoryType,
  CurrencyCode,
  IsoMonth,
  MinorUnits,
} from '@goldfinch/shared/types';
import { MAX_CASHFLOW_MONTHS } from '../config.js';
import { getIdentity } from '../context.js';
import { queryAll } from '../ddb.js';
import { currentMonthInTz, listMonths, monthDateRange } from '../dates.js';
import { getEnv } from '../env.js';
import { ApiError, json } from '../http.js';
import { requireIsoMonth } from '../validate.js';

interface CashflowTxnRow {
  SK: TxnSk;
  amountMinor: MinorUnits;
  categoryId?: string | null;
  pending?: boolean;
  isTransfer?: boolean;
  currency?: CurrencyCode;
}

export async function getCashflow(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const qs = event.queryStringParameters ?? {};

  const fallbackMonth = currentMonthInTz(env.defaultTz);
  const month = qs['month'] !== undefined ? requireIsoMonth(qs['month'], 'month') : undefined;
  const from =
    month ?? (qs['from'] !== undefined ? requireIsoMonth(qs['from'], 'from') : fallbackMonth);
  const to =
    month ?? (qs['to'] !== undefined ? requireIsoMonth(qs['to'], 'to') : fallbackMonth);
  if (from > to) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'from must not be after to');
  }
  const months = listMonths(from, to);
  if (months.length > MAX_CASHFLOW_MONTHS) {
    throw new ApiError(
      400,
      'RANGE_TOO_LARGE',
      `cashflow range must not exceed ${MAX_CASHFLOW_MONTHS} months`,
    );
  }

  const pk = userPk(household);
  const categories = await queryAll<CategoryItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': KEY_PREFIX.category },
  });
  const categoryTypes = new Map<string, CategoryType>(
    categories.map((category) => [category.categoryId, category.type]),
  );

  const bounds = txnDateRangeBounds(monthDateRange(from).from, monthDateRange(to).to);
  const txns = await queryAll<CashflowTxnRow>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
    ExpressionAttributeValues: { ':pk': pk, ':start': bounds.start, ':end': bounds.end },
    ProjectionExpression: '#sk, #amountMinor, #categoryId, #pending, #isTransfer, #currency',
    ExpressionAttributeNames: {
      '#sk': 'SK',
      '#amountMinor': 'amountMinor',
      '#categoryId': 'categoryId',
      '#pending': 'pending',
      '#isTransfer': 'isTransfer',
      '#currency': 'currency',
    },
  });

  const buckets = new Map<IsoMonth, { income: MinorUnits; expense: MinorUnits }>(
    months.map((m) => [m, { income: 0, expense: 0 }]),
  );
  let currency: CurrencyCode | undefined;
  for (const txn of txns) {
    if (txn.pending === true || txn.isTransfer === true) continue;
    const categoryType =
      txn.categoryId !== null && txn.categoryId !== undefined
        ? categoryTypes.get(txn.categoryId)
        : undefined;
    if (categoryType === 'TRANSFER') continue;
    const { date } = parseTxnSk(txn.SK);
    const bucket = buckets.get(date.slice(0, 7));
    if (bucket === undefined) continue;
    currency ??= txn.currency;
    const isIncome =
      categoryType === 'INCOME' || (categoryType === undefined && txn.amountMinor > 0);
    if (isIncome) {
      bucket.income = addMinor(bucket.income, txn.amountMinor);
    } else {
      // Expense amounts are negative; accumulate the positive magnitude.
      bucket.expense = addMinor(bucket.expense, negateMinor(txn.amountMinor));
    }
  }
  const finalCurrency = currency ?? 'USD';

  const monthDtos: CashflowMonth[] = months.map((m) => {
    const bucket = buckets.get(m) as { income: MinorUnits; expense: MinorUnits };
    const netMinor = addMinor(bucket.income, negateMinor(bucket.expense));
    return {
      month: m,
      income: toCurrencyDecimalString(bucket.income, finalCurrency),
      incomeMinor: bucket.income,
      expense: toCurrencyDecimalString(bucket.expense, finalCurrency),
      expenseMinor: bucket.expense,
      net: toCurrencyDecimalString(netMinor, finalCurrency),
      netMinor,
    };
  });

  const incomeTotal = addMinor(0, ...monthDtos.map((m) => m.incomeMinor));
  const expenseTotal = addMinor(0, ...monthDtos.map((m) => m.expenseMinor));
  const netTotal = addMinor(incomeTotal, negateMinor(expenseTotal));

  const body: CashflowResponse = {
    months: monthDtos,
    totals: {
      income: toCurrencyDecimalString(incomeTotal, finalCurrency),
      incomeMinor: incomeTotal,
      expense: toCurrencyDecimalString(expenseTotal, finalCurrency),
      expenseMinor: expenseTotal,
      net: toCurrencyDecimalString(netTotal, finalCurrency),
      netMinor: netTotal,
    },
    currency: finalCurrency,
  };
  return json(200, body);
}
