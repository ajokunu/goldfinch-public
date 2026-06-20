/**
 * Parameterized i18n messages (shell.md 8.3; StrykerJS mutation target).
 *
 * The prototype built these Korean sentences inline (app.jsx 188-191,
 * sheets.jsx 31/49-50/95, the rules explainer in app.jsx 119). Korean word
 * order and particles make string concatenation untranslatable, so each case
 * is a typed pure function: (lang, args) -> string.
 *
 * Contracts:
 * - `amount` arguments are PRE-FORMATTED strings produced by the existing
 *   Money / CurrencyAmount formatting path (@goldfinch/shared money
 *   discipline). These functions never format money themselves.
 * - `payee` / `categoryName` / `name` arguments are API or profile data and
 *   are interpolated verbatim -- never passed through translate().
 * - Date/month labels are NOT here: they go through Intl /
 *   app/src/lib/dates.ts with localeTag(lang) (see ./resolve.ts).
 *
 * Korean copy for the greeting's afternoon/evening variants is proposed
 * (the prototype only ships the morning form) and is flagged for
 * native-speaker review before release.
 */
import type { Lang } from './strings';

/**
 * Budget cadence, kept as a local literal union so this PURE module stays free
 * of the @goldfinch/shared subpath import (its standalone node10 test build
 * cannot resolve subpaths). Structurally identical to the shared BudgetPeriod,
 * so callers passing a BudgetPeriod still typecheck.
 */
type PeriodArg = 'weekly' | 'monthly' | 'yearly';

/** Toast detail after a rule retags transactions: "3 transactions tagged". */
export function taggedCount(lang: Lang, n: number): string {
  if (lang === 'ko') return `${n}건 적용됨`;
  return n === 1 ? `${n} transaction tagged` : `${n} transactions tagged`;
}

/** Toast title after a one-off categorization: "Categorized as Dining". */
export function categorizedAs(lang: Lang, categoryName: string): string {
  return lang === 'ko'
    ? `${categoryName}(으)로 분류됨`
    : `Categorized as ${categoryName}`;
}

/** Suggestion reason when a stored rule matched the payee. */
export function matchesRuleFor(lang: Lang, payee: string): string {
  return lang === 'ko'
    ? `${payee} 규칙과 일치`
    : `Matches your rule for ${payee}`;
}

/** Always-tag confirmation line: "Always tag Blue Bottle as Dining". */
export function alwaysTagAs(
  lang: Lang,
  payee: string,
  categoryName: string,
): string {
  return lang === 'ko'
    ? `${payee} → 항상 ${categoryName}`
    : `Always tag ${payee} as ${categoryName}`;
}

/** Always-tag consequence when past transactions will be retagged. */
export function createsRuleAndRetags(lang: Lang, n: number): string {
  if (lang === 'ko') return `규칙 생성 및 과거 거래 ${n}건 재분류`;
  return `Creates a rule and re-tags ${n} past ${
    n === 1 ? 'transaction' : 'transactions'
  }`;
}

/** Always-tag consequence when no past transactions match. */
export function createsRuleForFuture(lang: Lang): string {
  return lang === 'ko'
    ? '향후 거래에 규칙 적용'
    : 'Creates a rule for future transactions';
}

/**
 * Budget-edit subtitle: "$420.10 spent this month". `formattedAmount` comes
 * pre-formatted from the Money / CurrencyAmount path.
 */
export function spentThisMonth(lang: Lang, formattedAmount: string): string {
  return lang === 'ko'
    ? `이번 달 ${formattedAmount} 지출`
    : `${formattedAmount} spent this month`;
}

/**
 * Rules-screen explainer. The prototype split this sentence into three
 * concatenated t() fragments around an inline-bold "Always tag"; shell.md 8.5
 * mandates restructuring it as one templated message instead of
 * concatenating fragments.
 */
export function rulesExplainer(lang: Lang): string {
  return lang === 'ko'
    ? 'GoldFinch는 이 규칙으로 새 거래를 자동 분류합니다. 카테고리를 지정할 때 항상 태그를 켜두면 새 규칙을 학습합니다.'
    : 'GoldFinch auto-categorizes new transactions with these rules. Each time you set a category and keep Always tag on, it learns a new one.';
}

/**
 * Time-of-day greeting ("Good morning[, Ji-woo]"). `hour` is the local
 * 24-hour clock hour (0-23): before 12 is morning, 12 to before 18 is
 * afternoon, 18 onward is evening. `name` is profile data (ID-token claim),
 * interpolated verbatim; omit it (or pass an empty string) for the bare
 * greeting.
 */
/**
 * Inline validation message for the Settings display-name field. `min`/`max`
 * are the shared PROFILE_DISPLAY_NAME_MIN/MAX_LENGTH constants
 * (@goldfinch/shared/constants) so the copy can never drift from the API's
 * actual bounds. Korean copy proposed, flagged for native-speaker review.
 */
export function displayNameLengthError(
  lang: Lang,
  min: number,
  max: number,
): string {
  return lang === 'ko'
    ? `표시 이름은 ${min}-${max}자여야 합니다`
    : `Display name must be ${min}-${max} characters`;
}

/** Budget-editor period-picker eyebrow ("Period" / "기간"), P11-4. */
export function periodPickerLabel(lang: Lang): string {
  return lang === 'ko' ? '기간' : 'Period';
}

/**
 * Budget-editor limit eyebrow, cadence-qualified (P11-4): "Weekly limit" /
 * "Monthly limit" / "Yearly limit". Korean keeps the cadence word + 한도; the
 * three forms are a [PARAM] row (the cadence adjective varies), so they live
 * here rather than as three frozen catalog keys.
 */
export function periodLimitLabel(lang: Lang, period: PeriodArg): string {
  if (lang === 'ko') {
    const word = period === 'weekly' ? '주간' : period === 'yearly' ? '연간' : '월';
    return `${word} 한도`;
  }
  const word =
    period === 'weekly' ? 'Weekly' : period === 'yearly' ? 'Yearly' : 'Monthly';
  return `${word} limit`;
}

/**
 * Compact, locale-aware label for a yyyy-mm-dd date used inside the budget
 * range/week header sentences ("Jun 8"). The input is already an ET civil date
 * (from periodWindow / the preset resolvers), so it is anchored at UTC midnight
 * for Intl -- the device-local calendar is NEVER consulted, so the label can
 * never shift a day for a user outside ET. `year` appends the year for
 * cross-year spans. Falls back to the raw string for malformed input.
 */
function compactDay(isoDate: string, locale?: string, year = false): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: year ? 'numeric' : undefined,
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return isoDate;
  }
}

/** Whether two yyyy-mm-dd dates fall in different calendar years. */
function crossesYear(from: string, to: string): boolean {
  return from.slice(0, 4) !== to.slice(0, 4);
}

/**
 * Budget week-stepper label: the active Monday..Sunday span ("Jun 8 - Jun 14").
 * `from`/`to` are inclusive ET civil dates from the shared `stepWeek` helper;
 * `locale` is the BCP-47 tag from `localeTag(lang)`. The year is appended only
 * when the week straddles a year boundary. Korean uses the same compact span
 * with a tilde separator (the conventional Korean date-range joiner).
 */
export function weekRangeLabel(
  lang: Lang,
  from: string,
  to: string,
  locale?: string,
): string {
  const withYear = crossesYear(from, to);
  const a = compactDay(from, locale, withYear);
  const b = compactDay(to, locale, withYear);
  return lang === 'ko' ? `${a} ~ ${b}` : `${a} - ${b}`;
}

/**
 * Budget range-mode header label when a date-range preset is active but its
 * span is not a single calendar month ("Jun 1 - Jun 14"). The caller passes the
 * preset's localized name when a preset cleanly maps to one (e.g. "This
 * month"); this is the explicit-span fallback. Year is appended for cross-year
 * spans (e.g. Year-to-date in January would not, but Last 90 across New Year
 * would).
 */
export function rangeLabel(
  lang: Lang,
  from: string,
  to: string,
  locale?: string,
): string {
  const withYear = crossesYear(from, to);
  const a = compactDay(from, locale, withYear);
  const b = compactDay(to, locale, withYear);
  return lang === 'ko' ? `${a} ~ ${b}` : `${a} - ${b}`;
}

export function greeting(lang: Lang, hour: number, name?: string): string {
  const base =
    lang === 'ko'
      ? hour < 12
        ? '좋은 아침이에요'
        : hour < 18
          ? '좋은 오후예요'
          : '좋은 저녁이에요'
      : hour < 12
        ? 'Good morning'
        : hour < 18
          ? 'Good afternoon'
          : 'Good evening';
  return name === undefined || name === '' ? base : `${base}, ${name}`;
}
