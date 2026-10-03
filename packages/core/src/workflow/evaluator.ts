/**
 * JSON Condition Evaluator for Data-Driven Workflows.
 *
 * Rules:
 * - Deterministic, pure TypeScript evaluation.
 * - ZERO eval() or Function() calls to ensure strict security and prevent code injection.
 * - Operators: '==', '!=', '>', '<', '>=', '<=', 'in', 'contains', 'and', 'or', 'not'.
 */

export type JsonPrimitive = string | number | boolean | null;

export interface ConditionRule {
  field?: string;
  op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'contains' | 'and' | 'or' | 'not';
  value?: unknown;
  rules?: ConditionRule[];
}

/**
 * Resolves a dot-delimited field path from a nested JSON payload.
 * e.g., 'employee.departmentId' -> payload.employee.departmentId
 */
export function resolveJsonField(payload: Record<string, unknown>, path: string): unknown {
  if (!path || !payload) return undefined;
  const parts = path.split('.');
  let current: unknown = payload;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluates a condition rule or compound rules against a request payload.
 */
export function evaluateCondition(
  rule: ConditionRule | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!rule) return true; // If no condition is defined, step unconditionally executes

  switch (rule.op) {
    case 'and': {
      if (!rule.rules || rule.rules.length === 0) return true;
      return rule.rules.every(r => evaluateCondition(r, payload));
    }

    case 'or': {
      if (!rule.rules || rule.rules.length === 0) return true;
      return rule.rules.some(r => evaluateCondition(r, payload));
    }

    case 'not': {
      if (!rule.rules || rule.rules.length === 0) return false;
      return !evaluateCondition(rule.rules[0], payload);
    }

    case '==': {
      const actual = rule.field ? resolveJsonField(payload, rule.field) : undefined;
      return actual === rule.value;
    }

    case '!=': {
      const actual = rule.field ? resolveJsonField(payload, rule.field) : undefined;
      return actual !== rule.value;
    }

    case '>': {
      const actual = Number(rule.field ? resolveJsonField(payload, rule.field) : NaN);
      const expected = Number(rule.value);
      return !Number.isNaN(actual) && !Number.isNaN(expected) && actual > expected;
    }

    case '<': {
      const actual = Number(rule.field ? resolveJsonField(payload, rule.field) : NaN);
      const expected = Number(rule.value);
      return !Number.isNaN(actual) && !Number.isNaN(expected) && actual < expected;
    }

    case '>=': {
      const actual = Number(rule.field ? resolveJsonField(payload, rule.field) : NaN);
      const expected = Number(rule.value);
      return !Number.isNaN(actual) && !Number.isNaN(expected) && actual >= expected;
    }

    case '<=': {
      const actual = Number(rule.field ? resolveJsonField(payload, rule.field) : NaN);
      const expected = Number(rule.value);
      return !Number.isNaN(actual) && !Number.isNaN(expected) && actual <= expected;
    }

    case 'in': {
      const actual = rule.field ? resolveJsonField(payload, rule.field) : undefined;
      if (!Array.isArray(rule.value)) return false;
      return (rule.value as unknown[]).includes(actual);
    }

    case 'contains': {
      const actual = rule.field ? resolveJsonField(payload, rule.field) : undefined;
      if (Array.isArray(actual)) {
        return actual.includes(rule.value);
      }
      if (typeof actual === 'string') {
        return actual.includes(String(rule.value ?? ''));
      }
      return false;
    }

    default:
      return false;
  }
}
