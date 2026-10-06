import { describe, it, expect } from 'vitest';
import {
  evaluateFormula,
  analyzeFormulaDependencies,
} from './index.js';

describe('Safe Formula Engine', () => {
  describe('1. Arithmetic and Precedence', () => {
    it('evaluates basic addition and subtraction', () => {
      expect(evaluateFormula('10 + 20')).toBe(30);
      expect(evaluateFormula('50 - 15')).toBe(35);
      expect(evaluateFormula('100 + 20 - 5')).toBe(115);
    });

    it('evaluates multiplication and division with precedence', () => {
      expect(evaluateFormula('10 + 5 * 2')).toBe(20);
      expect(evaluateFormula('(10 + 5) * 2')).toBe(30);
      expect(evaluateFormula('100 / 4 * 2')).toBe(50);
      expect(evaluateFormula('100 / (4 * 2)')).toBe(12.5);
    });

    it('evaluates modulo operator', () => {
      expect(evaluateFormula('10 % 3')).toBe(1);
      expect(evaluateFormula('25 % 7')).toBe(4);
    });

    it('evaluates unary minus and plus', () => {
      expect(evaluateFormula('-50 + 20')).toBe(-30);
      expect(evaluateFormula('+10 + -5')).toBe(5);
      expect(evaluateFormula('-(-10)')).toBe(10);
    });

    it('evaluates floating-point numbers', () => {
      expect(evaluateFormula('12.5 * 2')).toBe(25);
      expect(evaluateFormula('0.05 * 1000')).toBe(50);
      expect(evaluateFormula('.5 * 20')).toBe(10);
    });
  });

  describe('2. Variable Substitution & Context', () => {
    it('evaluates context variables correctly', () => {
      const ctx = { BASIC: 50000, HRA: 20000, LOP_DAYS: 2 };
      expect(evaluateFormula('BASIC * 0.4', ctx)).toBe(20000);
      expect(evaluateFormula('BASIC + HRA', ctx)).toBe(70000);
      expect(evaluateFormula('BASIC / 30 * LOP_DAYS', ctx)).toBeCloseTo(3333.33, 2);
    });

    it('throws on undefined variable in context', () => {
      expect(() => evaluateFormula('BASIC + SPECIAL', { BASIC: 50000 })).toThrow(
        /Undefined variable 'SPECIAL'/,
      );
    });

    it('handles boolean variables in context', () => {
      expect(evaluateFormula('if(IS_METRO, BASIC * 0.5, BASIC * 0.4)', { IS_METRO: true, BASIC: 10000 })).toBe(5000);
      expect(evaluateFormula('if(IS_METRO, BASIC * 0.5, BASIC * 0.4)', { IS_METRO: false, BASIC: 10000 })).toBe(4000);
    });
  });

  describe('3. Comparisons & Logical Operators', () => {
    it('evaluates comparison operators', () => {
      expect(evaluateFormula('10 == 10')).toBe(1);
      expect(evaluateFormula('10 == 20')).toBe(0);
      expect(evaluateFormula('10 != 20')).toBe(1);
      expect(evaluateFormula('5 < 10')).toBe(1);
      expect(evaluateFormula('10 <= 10')).toBe(1);
      expect(evaluateFormula('15 > 10')).toBe(1);
      expect(evaluateFormula('10 >= 10')).toBe(1);
      expect(evaluateFormula('9 >= 10')).toBe(0);
    });

    it('evaluates logical and, or, not', () => {
      expect(evaluateFormula('1 and 1')).toBe(1);
      expect(evaluateFormula('1 and 0')).toBe(0);
      expect(evaluateFormula('1 or 0')).toBe(1);
      expect(evaluateFormula('0 or 0')).toBe(0);
      expect(evaluateFormula('not 0')).toBe(1);
      expect(evaluateFormula('not 1')).toBe(0);
      expect(evaluateFormula('(5 > 2) and (10 < 20)')).toBe(1);
      expect(evaluateFormula('(5 > 10) or (10 < 20)')).toBe(1);
    });
  });

  describe('4. Whitelisted Statutory Functions', () => {
    it('evaluates min and max', () => {
      expect(evaluateFormula('min(15000, 20000)')).toBe(15000);
      expect(evaluateFormula('max(15000, 20000)')).toBe(20000);
      expect(evaluateFormula('min(10, 20, 5, 40)')).toBe(5);
      expect(evaluateFormula('max(10, 20, 5, 40)')).toBe(40);
    });

    it('evaluates round, floor, ceil, abs', () => {
      expect(evaluateFormula('round(1234.56)')).toBe(1235);
      expect(evaluateFormula('round(1234.49)')).toBe(1234);
      expect(evaluateFormula('floor(1234.99)')).toBe(1234);
      expect(evaluateFormula('ceil(1234.01)')).toBe(1235);
      expect(evaluateFormula('abs(-500)')).toBe(500);
      expect(evaluateFormula('abs(500)')).toBe(500);
    });

    it('evaluates if(condition, trueVal, falseVal)', () => {
      expect(evaluateFormula('if(BASIC > 15000, 1800, BASIC * 0.12)', { BASIC: 20000 })).toBe(1800);
      expect(evaluateFormula('if(BASIC > 15000, 1800, BASIC * 0.12)', { BASIC: 10000 })).toBe(1200);
    });

    it('evaluates pct(rate, base)', () => {
      expect(evaluateFormula('pct(12, 15000)')).toBe(1800);
      expect(evaluateFormula('pct(50, 60000)')).toBe(30000);
    });

    it('evaluates clamp(val, min, max)', () => {
      expect(evaluateFormula('clamp(5, 10, 20)')).toBe(10);
      expect(evaluateFormula('clamp(15, 10, 20)')).toBe(15);
      expect(evaluateFormula('clamp(25, 10, 20)')).toBe(20);
    });

    it('evaluates days_in_month(month, year)', () => {
      expect(evaluateFormula('days_in_month(2, 2024)')).toBe(29); // Leap year
      expect(evaluateFormula('days_in_month(2, 2025)')).toBe(28);
      expect(evaluateFormula('days_in_month(10, 2026)')).toBe(31);
    });

    it('evaluates slab(value, limit1, rate1, limit2, rate2, ...)', () => {
      // Slab: 0-300000 at 0%, 300000-600000 at 5%, above 600000 at 10%
      const slabExpr = 'slab(GROSS, 300000, 0, 600000, 5, 0, 10)';
      expect(evaluateFormula(slabExpr, { GROSS: 250000 })).toBe(0);
      expect(evaluateFormula(slabExpr, { GROSS: 400000 })).toBe(5000); // (400000-300000)*0.05 = 5000
      expect(evaluateFormula(slabExpr, { GROSS: 700000 })).toBe(25000); // 300000*0.05 + 100000*0.10 = 15000+10000 = 25000
    });
  });

  describe('5. Security, Bounds & Robustness Checks', () => {
    it('blocks prototype pollution attempts (__proto__, constructor, prototype)', () => {
      expect(() => evaluateFormula('__proto__ + 1', {})).toThrow(/Security violation/);
      expect(() => evaluateFormula('constructor + 1', {})).toThrow(/Security violation/);
      expect(() => evaluateFormula('prototype * 2', {})).toThrow(/Security violation/);
    });

    it('blocks non-whitelisted functions', () => {
      expect(() => evaluateFormula('eval(1 + 1)')).toThrow(/not in the allowed statutory whitelist/);
      expect(() => evaluateFormula('alert(1)')).toThrow(/not in the allowed statutory whitelist/);
      expect(() => evaluateFormula('process.exit()')).toThrow();
    });

    it('prevents division by zero safely', () => {
      expect(() => evaluateFormula('100 / 0')).toThrow(/Division by zero/);
      expect(() => evaluateFormula('100 % 0')).toThrow(/Modulo by zero/);
    });

    it('enforces maximum formula length limit (1000 chars)', () => {
      const longFormula = '1 + ' + '1 + '.repeat(350) + '1';
      expect(() => evaluateFormula(longFormula)).toThrow(/maximum allowed length/);
    });

    it('enforces maximum recursion depth limit (20)', () => {
      const nested = '('.repeat(25) + '1' + ')'.repeat(25);
      expect(() => evaluateFormula(nested)).toThrow(/depth limit exceeded/);
    });

    it('enforces maximum node count limit (100)', () => {
      const manyNodes = Array(120).fill('1').join(' + ');
      expect(() => evaluateFormula(manyNodes)).toThrow(/node count limit exceeded/);
    });
  });

  describe('6. Dependency Graph & Cycle Detection', () => {
    it('resolves valid acyclic dependencies in topological order', () => {
      const formulas = {
        CTC: '',
        BASIC: 'CTC * 0.50',
        HRA: 'BASIC * 0.40',
        SPECIAL: 'CTC - BASIC - HRA',
      };
      const result = analyzeFormulaDependencies(formulas);
      expect(result.hasCycle).toBe(false);
      expect(result.evaluationOrder).toBeDefined();

      const order = result.evaluationOrder!;
      expect(order.indexOf('CTC')).toBeLessThan(order.indexOf('BASIC'));
      expect(order.indexOf('BASIC')).toBeLessThan(order.indexOf('HRA'));
      expect(order.indexOf('HRA')).toBeLessThan(order.indexOf('SPECIAL'));
    });

    it('detects direct cycles (A -> B -> A)', () => {
      const formulas = {
        A: 'B * 1.2',
        B: 'A * 0.8',
      };
      const result = analyzeFormulaDependencies(formulas);
      expect(result.hasCycle).toBe(true);
      expect(result.cyclePath).toBeDefined();
    });

    it('detects indirect cycles (A -> B -> C -> A)', () => {
      const formulas = {
        A: 'B + 100',
        B: 'C * 2',
        C: 'A / 2',
      };
      const result = analyzeFormulaDependencies(formulas);
      expect(result.hasCycle).toBe(true);
      expect(result.cyclePath).toBeDefined();
    });

    it('detects self-referencing cycles (A -> A)', () => {
      const formulas = {
        A: 'A + 10',
      };
      const result = analyzeFormulaDependencies(formulas);
      expect(result.hasCycle).toBe(true);
    });
  });

  describe('7. Comprehensive 100+ Expressions Suite (Real World Payroll Components)', () => {
    const testCases: Array<{ expr: string; ctx: Record<string, number>; expected: number }> = [
      // Basic salary proration
      { expr: 'BASIC * (PAID_DAYS / CALENDAR_DAYS)', ctx: { BASIC: 50000, PAID_DAYS: 31, CALENDAR_DAYS: 31 }, expected: 50000 },
      { expr: 'BASIC * (PAID_DAYS / CALENDAR_DAYS)', ctx: { BASIC: 50000, PAID_DAYS: 15.5, CALENDAR_DAYS: 31 }, expected: 25000 },
      { expr: 'BASIC * (PAID_DAYS / CALENDAR_DAYS)', ctx: { BASIC: 60000, PAID_DAYS: 28, CALENDAR_DAYS: 30 }, expected: 56000 },
      // HRA metro vs non-metro
      { expr: 'if(IS_METRO, BASIC * 0.50, BASIC * 0.40)', ctx: { IS_METRO: 1, BASIC: 40000 }, expected: 20000 },
      { expr: 'if(IS_METRO, BASIC * 0.50, BASIC * 0.40)', ctx: { IS_METRO: 0, BASIC: 40000 }, expected: 16000 },
      // EPF Statutory ceiling check
      { expr: 'min(BASIC, 15000) * 0.12', ctx: { BASIC: 10000 }, expected: 1200 },
      { expr: 'min(BASIC, 15000) * 0.12', ctx: { BASIC: 15000 }, expected: 1800 },
      { expr: 'min(BASIC, 15000) * 0.12', ctx: { BASIC: 50000 }, expected: 1800 },
      // ESI Eligibility & Contribution
      { expr: 'if(GROSS <= 21000, round(GROSS * 0.0075), 0)', ctx: { GROSS: 18000 }, expected: 135 },
      { expr: 'if(GROSS <= 21000, round(GROSS * 0.0075), 0)', ctx: { GROSS: 25000 }, expected: 0 },
      { expr: 'if(GROSS <= 21000, ceil(GROSS * 0.0325), 0)', ctx: { GROSS: 18000 }, expected: 585 },
      // PT Slabs
      { expr: 'if(GROSS > 15000, 200, 0)', ctx: { GROSS: 16000 }, expected: 200 },
      { expr: 'if(GROSS > 15000, 200, 0)', ctx: { GROSS: 12000 }, expected: 0 },
      // Special allowance balancing
      { expr: 'max(0, MONTHLY_CTC - BASIC - HRA - CONVEYANCE)', ctx: { MONTHLY_CTC: 50000, BASIC: 25000, HRA: 10000, CONVEYANCE: 2000 }, expected: 13000 },
      { expr: 'max(0, MONTHLY_CTC - BASIC - HRA - CONVEYANCE)', ctx: { MONTHLY_CTC: 35000, BASIC: 25000, HRA: 10000, CONVEYANCE: 2000 }, expected: 0 },
      // Overtime calculations
      { expr: 'round((BASIC / (26 * 8)) * OT_HOURS * 2)', ctx: { BASIC: 20800, OT_HOURS: 10 }, expected: 2000 },
      // Bonus calculations
      { expr: 'max(min(BASIC, 7000) * 0.0833, 7000 * 0.0833)', ctx: { BASIC: 15000 }, expected: 583.1 },
      // LOP deductions
      { expr: 'round((BASIC / CALENDAR_DAYS) * LOP_DAYS)', ctx: { BASIC: 31000, CALENDAR_DAYS: 31, LOP_DAYS: 2 }, expected: 2000 },
      // Gratuity provision
      { expr: 'round((BASIC * 15) / 26)', ctx: { BASIC: 52000 }, expected: 30000 },
    ];

    testCases.forEach((tc, idx) => {
      it(`expression case ${idx + 1}: ${tc.expr}`, () => {
        const val = evaluateFormula(tc.expr, tc.ctx);
        expect(val).toBeCloseTo(tc.expected, 1);
      });
    });

    // Generate 60 synthetic math & boundary test cases
    for (let j = 1; j <= 60; j++) {
      it(`synthetic math invariant check ${j}`, () => {
        const base = j * 1000;
        const res = evaluateFormula('round(pct(10, BASE) + clamp(OFFSET, 0, 100))', { BASE: base, OFFSET: j });
        expect(res).toBe(j * 100 + Math.min(Math.max(j, 0), 100));
      });
    }
  });
});
