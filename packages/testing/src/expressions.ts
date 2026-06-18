/**
 * Minimal DynamoDB expression evaluation for the in-memory table fake.
 *
 * Covers exactly the grammar the GoldFinch Lambdas emit (api routes + sync
 * writer), no more:
 *
 *   Condition / Filter:
 *     attribute_exists(p) | attribute_not_exists(p) | contains(p, :v)
 *     | begins_with(p, :v) | p = :v | p <> :v
 *     combined with AND / OR and parentheses.
 *
 *   Update:
 *     SET p = :v [, ...]            rhs also supports `a + b` where each
 *     REMOVE p [, ...]              operand is :v | path | if_not_exists(p, op)
 *
 * Anything outside this grammar throws, which is the desired behavior: a new
 * expression shape in a Lambda should force a deliberate fake extension, not
 * silently evaluate wrong.
 */

export type Item = Record<string, unknown>;
export type AttributeNames = Record<string, string> | undefined;
export type AttributeValues = Record<string, unknown> | undefined;

export function resolveName(token: string, names: AttributeNames): string {
  const trimmed = token.trim();
  if (trimmed.startsWith('#')) {
    const resolved = names?.[trimmed];
    if (resolved === undefined) {
      throw new Error(`unresolved expression attribute name "${trimmed}"`);
    }
    return resolved;
  }
  return trimmed;
}

export function resolveValue(token: string, values: AttributeValues): unknown {
  const trimmed = token.trim();
  if (!trimmed.startsWith(':')) {
    throw new Error(`expected expression attribute value reference, got "${trimmed}"`);
  }
  if (values === undefined || !(trimmed in values)) {
    throw new Error(`unresolved expression attribute value "${trimmed}"`);
  }
  return values[trimmed];
}

/** Split on a separator character at parenthesis depth zero. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Split on an uppercase keyword (AND / OR) at parenthesis depth zero. */
function splitTopLevelKeyword(input: string, keyword: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    const boundaryBefore = i === 0 || /[\s)]/.test(input[i - 1] as string);
    const after = input[i + keyword.length];
    const boundaryAfter = after === undefined || /[\s(]/.test(after);
    if (
      depth === 0 &&
      boundaryBefore &&
      boundaryAfter &&
      input.startsWith(keyword, i)
    ) {
      parts.push(current);
      current = '';
      i += keyword.length;
      continue;
    }
    current += ch;
    i += 1;
  }
  parts.push(current);
  return parts;
}

/** Strip one pair of outer parentheses if they wrap the whole expression. */
function stripOuterParens(input: string): string {
  let expr = input.trim();
  for (;;) {
    if (!expr.startsWith('(') || !expr.endsWith(')')) return expr;
    let depth = 0;
    for (let i = 0; i < expr.length; i += 1) {
      if (expr[i] === '(') depth += 1;
      if (expr[i] === ')') depth -= 1;
      if (depth === 0 && i < expr.length - 1) return expr; // closes early
    }
    expr = expr.slice(1, -1).trim();
  }
}

function evaluateAtom(
  expr: string,
  item: Item,
  names: AttributeNames,
  values: AttributeValues,
): boolean {
  const existsMatch = /^attribute_exists\(\s*([#\w]+)\s*\)$/.exec(expr);
  if (existsMatch !== null) {
    return resolveName(existsMatch[1] as string, names) in item;
  }
  const notExistsMatch = /^attribute_not_exists\(\s*([#\w]+)\s*\)$/.exec(expr);
  if (notExistsMatch !== null) {
    return !(resolveName(notExistsMatch[1] as string, names) in item);
  }
  const containsMatch = /^contains\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)$/.exec(expr);
  if (containsMatch !== null) {
    const attr = item[resolveName(containsMatch[1] as string, names)];
    const operand = resolveValue(containsMatch[2] as string, values);
    if (typeof attr === 'string' && typeof operand === 'string') {
      return attr.includes(operand);
    }
    if (Array.isArray(attr)) {
      return attr.includes(operand);
    }
    return false;
  }
  const beginsMatch = /^begins_with\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)$/.exec(expr);
  if (beginsMatch !== null) {
    const attr = item[resolveName(beginsMatch[1] as string, names)];
    const operand = resolveValue(beginsMatch[2] as string, values);
    return typeof attr === 'string' && typeof operand === 'string'
      ? attr.startsWith(operand)
      : false;
  }
  const eqMatch = /^([#\w]+)\s*(=|<>)\s*(:\w+)$/.exec(expr);
  if (eqMatch !== null) {
    const attrName = resolveName(eqMatch[1] as string, names);
    const attrPresent = attrName in item;
    const operand = resolveValue(eqMatch[3] as string, values);
    const equal = attrPresent && item[attrName] === operand;
    return eqMatch[2] === '=' ? equal : attrPresent && !equal;
  }
  throw new Error(`unsupported condition atom: "${expr}"`);
}

/** Evaluate a ConditionExpression / FilterExpression against one item. */
export function evaluateCondition(
  expression: string,
  item: Item,
  names: AttributeNames,
  values: AttributeValues,
): boolean {
  const expr = stripOuterParens(expression);
  const orParts = splitTopLevelKeyword(expr, 'OR');
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateCondition(part, item, names, values));
  }
  const andParts = splitTopLevelKeyword(expr, 'AND');
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateCondition(part, item, names, values));
  }
  return evaluateAtom(expr, item, names, values);
}

function evaluateOperand(
  operand: string,
  item: Item,
  names: AttributeNames,
  values: AttributeValues,
): unknown {
  const trimmed = operand.trim();
  if (trimmed.startsWith(':')) {
    return resolveValue(trimmed, values);
  }
  const ifNotExists = /^if_not_exists\(\s*([#\w]+)\s*,\s*(.+)\)$/.exec(trimmed);
  if (ifNotExists !== null) {
    const attr = item[resolveName(ifNotExists[1] as string, names)];
    return attr !== undefined
      ? attr
      : evaluateOperand(ifNotExists[2] as string, item, names, values);
  }
  return item[resolveName(trimmed, names)];
}

function evaluateSetRhs(
  rhs: string,
  item: Item,
  names: AttributeNames,
  values: AttributeValues,
): unknown {
  const addends = splitTopLevel(rhs, '+');
  if (addends.length === 1) {
    return evaluateOperand(addends[0] as string, item, names, values);
  }
  let sum = 0;
  for (const addend of addends) {
    const value = evaluateOperand(addend, item, names, values);
    if (typeof value !== 'number') {
      throw new Error(`arithmetic operand is not a number in "${rhs}"`);
    }
    sum += value;
  }
  return sum;
}

/** Apply an UpdateExpression (SET / REMOVE) and return the new item. */
export function applyUpdateExpression(
  expression: string,
  item: Item,
  names: AttributeNames,
  values: AttributeValues,
): Item {
  const next: Item = { ...item };
  const sections = expression
    .split(/\b(SET|REMOVE|ADD|DELETE)\b/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (let i = 0; i < sections.length; i += 2) {
    const keyword = sections[i];
    const body = sections[i + 1];
    if (body === undefined) {
      throw new Error(`malformed UpdateExpression: "${expression}"`);
    }
    if (keyword === 'SET') {
      for (const assignment of splitTopLevel(body, ',')) {
        const eq = assignment.indexOf('=');
        if (eq < 0) {
          throw new Error(`malformed SET assignment: "${assignment}"`);
        }
        const path = resolveName(assignment.slice(0, eq), names);
        next[path] = evaluateSetRhs(assignment.slice(eq + 1), next, names, values);
      }
    } else if (keyword === 'REMOVE') {
      for (const path of splitTopLevel(body, ',')) {
        delete next[resolveName(path, names)];
      }
    } else {
      throw new Error(`unsupported UpdateExpression clause: "${keyword}"`);
    }
  }
  return next;
}

export interface ParsedSortKeyCondition {
  attr: string;
  op: 'eq' | 'begins_with' | 'between';
  value1: string;
  value2?: string;
}

export interface ParsedKeyCondition {
  pkAttr: string;
  pkValue: unknown;
  sk?: ParsedSortKeyCondition;
}

/**
 * Parse the KeyConditionExpression shapes used across GoldFinch:
 *   "<pk> = :pk"
 *   "<pk> = :pk AND <sk> = :sk"
 *   "<pk> = :pk AND begins_with(<sk>, :prefix)"
 *   "<pk> = :pk AND <sk> BETWEEN :start AND :end"
 */
export function parseKeyCondition(
  expression: string,
  names: AttributeNames,
  values: AttributeValues,
): ParsedKeyCondition {
  const expr = expression.trim();

  const between =
    /^([#\w]+)\s*=\s*(:\w+)\s+AND\s+([#\w]+)\s+BETWEEN\s+(:\w+)\s+AND\s+(:\w+)$/.exec(
      expr,
    );
  if (between !== null) {
    return {
      pkAttr: resolveName(between[1] as string, names),
      pkValue: resolveValue(between[2] as string, values),
      sk: {
        attr: resolveName(between[3] as string, names),
        op: 'between',
        value1: String(resolveValue(between[4] as string, values)),
        value2: String(resolveValue(between[5] as string, values)),
      },
    };
  }

  const beginsWith =
    /^([#\w]+)\s*=\s*(:\w+)\s+AND\s+begins_with\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)$/.exec(
      expr,
    );
  if (beginsWith !== null) {
    return {
      pkAttr: resolveName(beginsWith[1] as string, names),
      pkValue: resolveValue(beginsWith[2] as string, values),
      sk: {
        attr: resolveName(beginsWith[3] as string, names),
        op: 'begins_with',
        value1: String(resolveValue(beginsWith[4] as string, values)),
      },
    };
  }

  const pkAndSk =
    /^([#\w]+)\s*=\s*(:\w+)\s+AND\s+([#\w]+)\s*=\s*(:\w+)$/.exec(expr);
  if (pkAndSk !== null) {
    return {
      pkAttr: resolveName(pkAndSk[1] as string, names),
      pkValue: resolveValue(pkAndSk[2] as string, values),
      sk: {
        attr: resolveName(pkAndSk[3] as string, names),
        op: 'eq',
        value1: String(resolveValue(pkAndSk[4] as string, values)),
      },
    };
  }

  const pkOnly = /^([#\w]+)\s*=\s*(:\w+)$/.exec(expr);
  if (pkOnly !== null) {
    return {
      pkAttr: resolveName(pkOnly[1] as string, names),
      pkValue: resolveValue(pkOnly[2] as string, values),
    };
  }

  throw new Error(`unsupported KeyConditionExpression: "${expression}"`);
}

/** Apply a parsed sort-key condition to one attribute value. */
export function sortKeyMatches(
  condition: ParsedSortKeyCondition,
  value: unknown,
): boolean {
  if (typeof value !== 'string') return false;
  switch (condition.op) {
    case 'eq':
      return value === condition.value1;
    case 'begins_with':
      return value.startsWith(condition.value1);
    case 'between':
      return value >= condition.value1 && value <= (condition.value2 as string);
    default:
      return false;
  }
}
