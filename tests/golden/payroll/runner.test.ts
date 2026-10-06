import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateCtcBreakup, StructureComponentDef } from '@hrms/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GoldenCase {
  id: string;
  description: string;
  ruleSnapshot: Record<string, string>;
  employee: { empCode: string; state: string; regime: string };
  salary: { ctcAnnual: number; structure: string };
  attendance: { calendarDays: number; paidDays: number; lopDays: number };
  inputs: unknown[];
  expected: {
    lines: Array<{ code: string; monthly: string }>;
    grossMonthly: string;
    ctcMonthly: string;
  };
  notes?: string;
}

const mockStructures: Record<string, StructureComponentDef[]> = {
  TEST_STD_ENG: [
    { code: 'BASIC', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.50' },
    { code: 'HRA', kind: 'earning', calc: 'formula', formula: 'BASIC * 0.40' },
    { code: 'SPECIAL_ALLOWANCE', kind: 'earning', calc: 'fixed', isBalancing: true },
  ],
};

describe('Golden Payroll Test Harness (External CA Test Oracle Runner)', () => {
  const jsonFiles = fs
    .readdirSync(__dirname)
    .filter(file => file.endsWith('.json'));

  const allCases: GoldenCase[] = [];
  for (const file of jsonFiles) {
    const raw = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    const cases = JSON.parse(raw) as GoldenCase[];
    allCases.push(...cases);
  }

  it('verifies test cases exist in golden directory', () => {
    expect(allCases.length).toBeGreaterThan(0);
  });

  allCases.forEach(tc => {
    it(`[${tc.id}] ${tc.description}`, () => {
      const structure = mockStructures[tc.salary.structure];
      expect(structure).toBeDefined();

      const breakup = calculateCtcBreakup(tc.salary.ctcAnnual, structure!);

      expect(breakup.ctcAnnual).toBe((tc.salary.ctcAnnual).toFixed(2));
      expect(breakup.monthlyCtc).toBe(tc.expected.ctcMonthly);
      expect(breakup.grossMonthlyEarnings).toBe(tc.expected.grossMonthly);

      for (const expectedLine of tc.expected.lines) {
        const line = breakup.lines.find(l => l.code === expectedLine.code);
        expect(line).toBeDefined();
        expect(line!.monthlyAmount).toBe(expectedLine.monthly);
      }
    });
  });
});
