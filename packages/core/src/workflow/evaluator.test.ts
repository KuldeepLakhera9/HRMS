import { describe, it, expect } from 'vitest';
import { evaluateCondition, resolveJsonField } from './evaluator.js';

describe('Workflow JSON Condition Evaluator Unit Tests (P2-WF-01)', () => {
  const payload = {
    amount: 15000,
    department: 'engineering',
    applicant: {
      level: 4,
      isProbation: true,
      tags: ['lead', 'core'],
    },
    remarks: 'Urgent hardware purchase',
  };

  it('resolves nested dot-delimited field paths', () => {
    expect(resolveJsonField(payload, 'amount')).toBe(15000);
    expect(resolveJsonField(payload, 'applicant.level')).toBe(4);
    expect(resolveJsonField(payload, 'applicant.isProbation')).toBe(true);
    expect(resolveJsonField(payload, 'applicant.nonexistent.field')).toBeUndefined();
  });

  it('evaluates equality == and inequality != operators', () => {
    expect(evaluateCondition({ field: 'department', op: '==', value: 'engineering' }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'department', op: '==', value: 'sales' }, payload)).toBe(false);
    expect(evaluateCondition({ field: 'department', op: '!=', value: 'sales' }, payload)).toBe(true);
  });

  it('evaluates comparison operators: >, <, >=, <=', () => {
    expect(evaluateCondition({ field: 'amount', op: '>', value: 10000 }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'amount', op: '>', value: 20000 }, payload)).toBe(false);
    expect(evaluateCondition({ field: 'amount', op: '<=', value: 15000 }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'applicant.level', op: '>=', value: 4 }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'applicant.level', op: '<', value: 4 }, payload)).toBe(false);
  });

  it('evaluates "in" operator for array inclusion', () => {
    expect(
      evaluateCondition(
        { field: 'department', op: 'in', value: ['engineering', 'product', 'design'] },
        payload,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        { field: 'department', op: 'in', value: ['hr', 'finance'] },
        payload,
      ),
    ).toBe(false);
  });

  it('evaluates "contains" operator for substrings and array items', () => {
    expect(
      evaluateCondition(
        { field: 'applicant.tags', op: 'contains', value: 'lead' },
        payload,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        { field: 'remarks', op: 'contains', value: 'hardware' },
        payload,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        { field: 'remarks', op: 'contains', value: 'software' },
        payload,
      ),
    ).toBe(false);
  });

  it('evaluates compound boolean expressions: and, or, not', () => {
    expect(
      evaluateCondition(
        {
          op: 'and',
          rules: [
            { field: 'amount', op: '>', value: 10000 },
            { field: 'department', op: '==', value: 'engineering' },
          ],
        },
        payload,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          op: 'or',
          rules: [
            { field: 'amount', op: '>', value: 50000 },
            { field: 'applicant.isProbation', op: '==', value: true },
          ],
        },
        payload,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          op: 'not',
          rules: [{ field: 'applicant.level', op: '==', value: 1 }],
        },
        payload,
      ),
    ).toBe(true);
  });

  it('defaults to true when condition is null or undefined (unconditional step)', () => {
    expect(evaluateCondition(null, payload)).toBe(true);
    expect(evaluateCondition(undefined, payload)).toBe(true);
  });
});
