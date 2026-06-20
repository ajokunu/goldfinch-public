/**
 * GoldFinch i18n (design-spec shell.md section 8).
 *
 * Public API:
 * - useT() / useLang(): React hooks wired to the persisted uiStore language
 *   preference. t() keys are the English source strings (typed by I18nKey).
 * - messages: typed parameterized sentences (Korean particles forbid
 *   concatenation) -- see ./messages.ts for the per-argument contracts.
 * - localeTag(): the BCP-47 tag for Intl date formatting in the active
 *   language (app/src/lib/dates.ts helpers accept it).
 * - Pure internals (translate, resolveLang) are exported for tests and
 *   non-React call sites; components should prefer the hooks.
 *
 * t() is NEVER applied to API data (payees, account names, user category and
 * goal names render verbatim), and money strings always come from the
 * existing Money / CurrencyAmount components.
 */
export { ko } from './strings';
export type { I18nKey, Lang, LanguageSetting } from './strings';
export { translate } from './translate';
export { localeTag, resolveLang } from './resolve';
export {
  alwaysTagAs,
  categorizedAs,
  createsRuleAndRetags,
  createsRuleForFuture,
  displayNameLengthError,
  greeting,
  matchesRuleFor,
  periodLimitLabel,
  periodPickerLabel,
  rulesExplainer,
  spentThisMonth,
  taggedCount,
} from './messages';
export { detectSystemLocale } from './systemLocale';
export { useLang, useT } from './useT';
