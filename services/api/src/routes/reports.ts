/**
 * GET /reports/trends?months=N and GET /reports/flow?month=yyyy-mm (P7-4).
 *
 * Both aggregate TXN# rows with the SAME classification rules as /cashflow:
 * - Pending transactions are excluded (posted-only actuals).
 * - Transfers are excluded: isTransfer flag or a TRANSFER-typed category.
 * - INCOME-typed categories count toward income, EXPENSE-typed toward expense;
 *   uncategorized rows fall back to the amount sign. Refunds inside an EXPENSE
 *   category reduce expense rather than inflate income.
 *
 * Multi-currency (P7-7): every aggregate is grouped per currency — one
 * PerCurrencyCashflow / FlowCurrencyGroupDto entry per currency seen, sorted
 * by currency code, never a synthetic mixed-currency total.
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
  CategoryItem,
  CategoryType,
  CurrencyCode,
  FlowCategoryDto,
  FlowCurrencyGroupDto,
  IsoMonth,
  MinorUnits,
  PerCurrencyCashflow,
  ReportsFlowResponse,
  ReportsTrendsResponse,
  TrendMonthDto,
} from '@goldfinch/shared/types';
import { DEFAULT_TREND_MONTHS, MAX_TREND_MONTHS } from '../config.js';
import { getIdentity } from '../context.js';
import { queryAll } from '../ddb.js';
import { currentMonthInTz, listMonths, monthDateRange } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json } from '../http.js';
import { requireIsoMonth } from '../validate.js';

interface ReportTxnRow {
  SK: TxnSk;
  amountMinor: MinorUnits;
  currency?: CurrencyCode;
  categoryId?: string | null;
  pending?: boolean;
  isTransfer?: boolean;
}

interface ClassifiedTxn {
  month: IsoMonth;
  currency: CurrencyCode;
  categoryId: string | null;
  isIncome: boolean;
  /** Positive magnitude for the bucket it lands in (signed for refunds). */
  amountMinor: MinorUnits;
}

async function loadCategories(env: ApiEnv, pk: string): Promise<CategoryItem[]> {
  return queryAll<CategoryItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': KEY_PREFIX.category },
  });
}

function categoryTypeMap(categories: readonly CategoryItem[]): Map<string, CategoryType> {
  return new Map(categories.map((category) => [category.categoryId, category.type]));
}

async function loadTxnRows(
  env: ApiEnv,
  pk: string,
  fromMonth: IsoMonth,
  toMonth: IsoMonth,
): Promise<ReportTxnRow[]> {
  const bounds = txnDateRangeBounds(
    monthDateRange(fromMonth).from,
    monthDateRange(toMonth).to,
  );
  return queryAll<ReportTxnRow>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
    ExpressionAttributeValues: { ':pk': pk, ':start': bounds.start, ':end': bounds.end },
    ProjectionExpression: '#sk, #amountMinor, #currency, #categoryId, #pending, #isTransfer',
    ExpressionAttributeNames: {
      '#sk': 'SK',
      '#amountMinor': 'amountMinor',
      '#currency': 'currency',
      '#categoryId': 'categoryId',
      '#pending': 'pending',
      '#isTransfer': 'isTransfer',
    },
  });
}

/** The single classification path both reports share (mirrors /cashflow). */
function classify(
  rows: readonly ReportTxnRow[],
  categoryTypes: ReadonlyMap<string, CategoryType>,
): ClassifiedTxn[] {
  const classified: ClassifiedTxn[] = [];
  for (const row of rows) {
    if (row.pending === true || row.isTransfer === true) continue;
    const categoryId = row.categoryId ?? null;
    const categoryType = categoryId !== null ? categoryTypes.get(categoryId) : undefined;
    if (categoryType === 'TRANSFER') continue;
    const { date } = parseTxnSk(row.SK);
    const isIncome =
      categoryType === 'INCOME' || (categoryType === undefined && row.amountMinor > 0);
    classified.push({
      month: date.slice(0, 7),
      currency: row.currency ?? 'USD',
      categoryId,
      isIncome,
      // Income keeps its sign; expense magnitude is the negated amount (so an
      // EXPENSE-category refund subtracts from expense).
      amountMinor: isIncome ? row.amountMinor : negateMinor(row.amountMinor),
    });
  }
  return classified;
}

function sortedCurrencies(keys: Iterable<CurrencyCode>): CurrencyCode[] {
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Trailing month window ending at `current`, inclusive, length `months`. */
function trailingMonths(current: IsoMonth, months: number): IsoMonth[] {
  let year = Number(current.slice(0, 4));
  let month = Number(current.slice(5, 7));
  month -= months - 1;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return listMonths(`${year}-${String(month).padStart(2, '0')}`, current);
}

export async function reportsTrends(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const qs = event.queryStringParameters ?? {};

  let months = DEFAULT_TREND_MONTHS;
  const rawMonths = qs['months'];
  if (rawMonths !== undefined) {
    const parsed = Number(rawMonths);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'months must be a positive integer');
    }
    if (parsed > MAX_TREND_MONTHS) {
      throw new ApiError(
        400,
        'RANGE_TOO_LARGE',
        `months must not exceed ${MAX_TREND_MONTHS}`,
      );
    }
    months = parsed;
  }

  const pk = userPk(household);
  const window = trailingMonths(currentMonthInTz(env.defaultTz), months);
  const fromMonth = window[0] as IsoMonth;
  const toMonth = window[window.length - 1] as IsoMonth;

  const [categories, rows] = await Promise.all([
    loadCategories(env, pk),
    loadTxnRows(env, pk, fromMonth, toMonth),
  ]);
  const categoryTypes = categoryTypeMap(categories);

  // month -> currency -> {income, expense}
  const buckets = new Map<IsoMonth, Map<CurrencyCode, { income: MinorUnits; expense: MinorUnits }>>(
    window.map((m) => [m, new Map()]),
  );
  for (const txn of classify(rows, categoryTypes)) {
    const monthBucket = buckets.get(txn.month);
    if (monthBucket === undefined) continue;
    let slice = monthBucket.get(txn.currency);
    if (slice === undefined) {
      slice = { income: 0, expense: 0 };
      monthBucket.set(txn.currency, slice);
    }
    if (txn.isIncome) {
      slice.income = addMinor(slice.income, txn.amountMinor);
    } else {
      slice.expense = addMinor(slice.expense, txn.amountMinor);
    }
  }

  const monthDtos: TrendMonthDto[] = window.map((month) => {
    const monthBucket = buckets.get(month) as Map<
      CurrencyCode,
      { income: MinorUnits; expense: MinorUnits }
    >;
    const perCurrency: PerCurrencyCashflow[] = sortedCurrencies(monthBucket.keys()).map(
      (currency) => {
        const slice = monthBucket.get(currency) as { income: MinorUnits; expense: MinorUnits };
        const netMinor = addMinor(slice.income, negateMinor(slice.expense));
        return {
          currency,
          income: toCurrencyDecimalString(slice.income, currency),
          incomeMinor: slice.income,
          expense: toCurrencyDecimalString(slice.expense, currency),
          expenseMinor: slice.expense,
          net: toCurrencyDecimalString(netMinor, currency),
          netMinor,
        };
      },
    );
    return { month, perCurrency };
  });

  const body: ReportsTrendsResponse = { months: monthDtos };
  return json(200, body);
}

export async function reportsFlow(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const qs = event.queryStringParameters ?? {};
  const month = requireIsoMonth(qs['month'], 'month');

  const pk = userPk(household);
  const [categories, rows] = await Promise.all([
    loadCategories(env, pk),
    loadTxnRows(env, pk, month, month),
  ]);
  const categoryTypes = categoryTypeMap(categories);
  const categoryNames = new Map(
    categories.map((category) => [category.categoryId, category.name]),
  );

  // currency -> {income, expense, perCategory expense}
  interface FlowSlice {
    income: MinorUnits;
    expense: MinorUnits;
    categories: Map<string | null, MinorUnits>;
  }
  const slices = new Map<CurrencyCode, FlowSlice>();
  for (const txn of classify(rows, categoryTypes)) {
    let slice = slices.get(txn.currency);
    if (slice === undefined) {
      slice = { income: 0, expense: 0, categories: new Map() };
      slices.set(txn.currency, slice);
    }
    if (txn.isIncome) {
      slice.income = addMinor(slice.income, txn.amountMinor);
    } else {
      slice.expense = addMinor(slice.expense, txn.amountMinor);
      slice.categories.set(
        txn.categoryId,
        addMinor(slice.categories.get(txn.categoryId) ?? 0, txn.amountMinor),
      );
    }
  }

  const perCurrency: FlowCurrencyGroupDto[] = sortedCurrencies(slices.keys()).map(
    (currency) => {
      const slice = slices.get(currency) as FlowSlice;
      const categories: FlowCategoryDto[] = [...slice.categories.entries()]
        .map(([categoryId, amountMinor]) => ({
          categoryId,
          categoryName:
            categoryId === null
              ? 'Uncategorized'
              : (categoryNames.get(categoryId) ?? categoryId),
          amount: toCurrencyDecimalString(amountMinor, currency),
          amountMinor,
        }))
        .sort(
          (a, b) =>
            b.amountMinor - a.amountMinor ||
            (a.categoryId ?? '').localeCompare(b.categoryId ?? ''),
        );
      const netMinor = addMinor(slice.income, negateMinor(slice.expense));
      return {
        currency,
        income: toCurrencyDecimalString(slice.income, currency),
        incomeMinor: slice.income,
        expense: toCurrencyDecimalString(slice.expense, currency),
        expenseMinor: slice.expense,
        net: toCurrencyDecimalString(netMinor, currency),
        netMinor,
        categories,
      };
    },
  );

  const body: ReportsFlowResponse = { month, perCurrency };
  return json(200, body);
}
