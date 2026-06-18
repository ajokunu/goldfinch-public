/**
 * Rule editor form state, validation, and request building (P7-5).
 *
 * House money rules: amount bounds are typed as text, parsed through the
 * shared parseDecimalString at the rule contract's 2-digit base scale (the
 * same scale the server uses), and travel as DecimalStrings in requests.
 * No float is ever created.
 *
 * The stored contract keeps patterns lowercase (the server lowercases on
 * write); validation lowercases here too so the live preview and the saved
 * rule always agree.
 */
import type {
  CreateRuleRequest,
  DecimalString,
  MinorUnits,
  PatchRuleRequest,
  RuleDto,
  RuleMatchType,
} from '@goldfinch/shared/types';
import { parseDecimalString, toDecimalString } from '@goldfinch/shared/money';
import type { RuleSpec } from '@goldfinch/shared/rules';

/** Server default when CreateRuleRequest.priority is omitted. */
export const DEFAULT_RULE_PRIORITY = 100;

/** Placeholder ruleId for previewing a rule that is not saved yet. */
export const DRAFT_RULE_ID = '__draft__';

/** Rule amount bounds live at the contract's fixed 2-digit base scale. */
export const RULE_AMOUNT_DIGITS = 2;

export const MATCH_TYPE_LABELS: Record<RuleMatchType, string> = {
  exact: 'Exact',
  prefix: 'Starts with',
  contains: 'Contains',
};

export interface RuleFormState {
  matchType: RuleMatchType;
  pattern: string;
  /** Raw user input; '' = no bound. */
  amountMinText: string;
  amountMaxText: string;
  categoryId: string | null;
  /** Raw user input; '' = server default. */
  priorityText: string;
  enabled: boolean;
}

export function emptyRuleForm(): RuleFormState {
  return {
    matchType: 'contains',
    pattern: '',
    amountMinText: '',
    amountMaxText: '',
    categoryId: null,
    priorityText: String(DEFAULT_RULE_PRIORITY),
    enabled: true,
  };
}

export function ruleFormFromDto(rule: RuleDto): RuleFormState {
  return {
    matchType: rule.matchType,
    pattern: rule.pattern,
    amountMinText: boundDecimal(rule.amountMin, rule.amountMinMinor) ?? '',
    amountMaxText: boundDecimal(rule.amountMax, rule.amountMaxMinor) ?? '',
    categoryId: rule.categoryId,
    priorityText: String(rule.priority),
    enabled: rule.enabled,
  };
}

/** Prefer the DTO's decimal string; reconstruct from minor units otherwise. */
function boundDecimal(
  decimal: DecimalString | null | undefined,
  minor: MinorUnits | null | undefined,
): DecimalString | null {
  if (decimal !== undefined && decimal !== null) return decimal;
  if (minor !== undefined && minor !== null) {
    return toDecimalString(minor, RULE_AMOUNT_DIGITS);
  }
  return null;
}

export interface ParsedBound {
  decimal: DecimalString;
  minor: MinorUnits;
}

/**
 * Parse a typed amount bound ("$1,250" -> { "1250.00", 125000 }). Returns
 * null for anything that is not a plain non-negative amount with at most two
 * fractional digits. Pure integer/string math via the shared parser.
 */
export function parseBoundText(raw: string): ParsedBound | null {
  let cleaned = raw.trim().replace(/[$,\s]/g, '');
  if (cleaned.length === 0) return null;
  if (cleaned.startsWith('.')) cleaned = `0${cleaned}`;
  let minor: MinorUnits;
  try {
    minor = parseDecimalString(cleaned, RULE_AMOUNT_DIGITS);
  } catch {
    // Invalid input is an expected editor state, not a failure to log.
    return null;
  }
  if (minor < 0) return null;
  return { decimal: toDecimalString(minor, RULE_AMOUNT_DIGITS), minor };
}

const PRIORITY_RE = /^\d{1,6}$/;

/** Parsed priority for previews; falls back to the default while invalid. */
export function parsePriorityOrDefault(priorityText: string): number {
  const trimmed = priorityText.trim();
  if (!PRIORITY_RE.test(trimmed)) return DEFAULT_RULE_PRIORITY;
  return Number.parseInt(trimmed, 10);
}

export interface RuleFormErrors {
  pattern?: string;
  amountMin?: string;
  amountMax?: string;
  category?: string;
  priority?: string;
}

export interface ValidRuleForm {
  matchType: RuleMatchType;
  /** Trimmed + lowercased: the stored contract form. */
  pattern: string;
  amountMin: ParsedBound | null;
  amountMax: ParsedBound | null;
  categoryId: string;
  priority: number;
  enabled: boolean;
}

export type RuleFormValidation =
  | { ok: true; value: ValidRuleForm }
  | { ok: false; errors: RuleFormErrors };

export function validateRuleForm(form: RuleFormState): RuleFormValidation {
  const errors: RuleFormErrors = {};

  const pattern = form.pattern.trim().toLowerCase();
  if (pattern.length === 0) {
    errors.pattern = 'Enter the payee text to match.';
  }

  let amountMin: ParsedBound | null = null;
  if (form.amountMinText.trim().length > 0) {
    amountMin = parseBoundText(form.amountMinText);
    if (!amountMin) {
      errors.amountMin = 'Enter a plain amount, like 12 or 12.50.';
    }
  }

  let amountMax: ParsedBound | null = null;
  if (form.amountMaxText.trim().length > 0) {
    amountMax = parseBoundText(form.amountMaxText);
    if (!amountMax) {
      errors.amountMax = 'Enter a plain amount, like 12 or 12.50.';
    }
  }

  if (amountMin && amountMax && amountMin.minor > amountMax.minor) {
    errors.amountMax = 'Max must be at least the min.';
  }

  if (!form.categoryId) {
    errors.category = 'Choose the category to assign.';
  }

  let priority = DEFAULT_RULE_PRIORITY;
  const priorityText = form.priorityText.trim();
  if (priorityText.length > 0) {
    if (!PRIORITY_RE.test(priorityText)) {
      errors.priority = 'Whole number, 0 or higher. Lower runs first.';
    } else {
      priority = Number.parseInt(priorityText, 10);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      matchType: form.matchType,
      pattern,
      amountMin,
      amountMax,
      // categoryId is non-null here: a missing category produced an error.
      categoryId: form.categoryId as string,
      priority,
      enabled: form.enabled,
    },
  };
}

export function toCreateRequest(value: ValidRuleForm): CreateRuleRequest {
  const body: CreateRuleRequest = {
    matchType: value.matchType,
    pattern: value.pattern,
    categoryId: value.categoryId,
    priority: value.priority,
    enabled: value.enabled,
  };
  if (value.amountMin) body.amountMin = value.amountMin.decimal;
  if (value.amountMax) body.amountMax = value.amountMax.decimal;
  return body;
}

/** Full-state PATCH; explicit nulls clear bounds the user emptied. */
export function toPatchRequest(
  value: ValidRuleForm,
  version: number,
): PatchRuleRequest {
  return {
    matchType: value.matchType,
    pattern: value.pattern,
    amountMin: value.amountMin ? value.amountMin.decimal : null,
    amountMax: value.amountMax ? value.amountMax.decimal : null,
    categoryId: value.categoryId,
    priority: value.priority,
    enabled: value.enabled,
    version,
  };
}

export type PreviewSpecResult =
  | { spec: RuleSpec; issue: null }
  | { spec: null; issue: string };

/**
 * Matcher input for the live preview from in-progress form state. Category
 * and priority problems do not block previewing the pattern + bounds; the
 * preview spec always evaluates as enabled (the editor renders a separate
 * note when the form's enabled switch is off).
 */
export function previewSpecFromForm(
  form: RuleFormState,
  ruleId: string,
): PreviewSpecResult {
  const pattern = form.pattern.trim().toLowerCase();
  if (pattern.length === 0) {
    return { spec: null, issue: 'Enter a pattern to preview matches.' };
  }

  let min: ParsedBound | null = null;
  if (form.amountMinText.trim().length > 0) {
    min = parseBoundText(form.amountMinText);
    if (!min) {
      return { spec: null, issue: 'Fix the min amount to preview matches.' };
    }
  }

  let max: ParsedBound | null = null;
  if (form.amountMaxText.trim().length > 0) {
    max = parseBoundText(form.amountMaxText);
    if (!max) {
      return { spec: null, issue: 'Fix the max amount to preview matches.' };
    }
  }

  if (min && max && min.minor > max.minor) {
    return {
      spec: null,
      issue: 'Min is above max; fix the bounds to preview matches.',
    };
  }

  return {
    spec: {
      ruleId,
      matchType: form.matchType,
      pattern,
      amountMinMinor: min ? min.minor : null,
      amountMaxMinor: max ? max.minor : null,
      categoryId: form.categoryId ?? '',
      priority: parsePriorityOrDefault(form.priorityText),
      enabled: true,
    },
    issue: null,
  };
}

/** "Amount 10.00 to 25.00" style summary for list rows; null = unbounded. */
export function ruleBoundsLabel(rule: RuleDto): string | null {
  const min = boundDecimal(rule.amountMin, rule.amountMinMinor);
  const max = boundDecimal(rule.amountMax, rule.amountMaxMinor);
  if (min !== null && max !== null) return `Amount ${min} to ${max}`;
  if (min !== null) return `Amount at least ${min}`;
  if (max !== null) return `Amount up to ${max}`;
  return null;
}
