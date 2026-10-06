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

function validateGoldenCase(c: unknown, index: number, file: string): GoldenCase {
  if (typeof c !== 'object' || c === null) {
    throw new Error(`Malformed test case at index ${index} in ${file}: expected object`);
  }
  const obj = c as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) {
    throw new Error(`Malformed test case at index ${index} in ${file}: missing valid id`);
  }
  if (typeof obj.description !== 'string' || !obj.description) {
    throw new Error(`Malformed test case at index ${index} in ${file}: missing valid description`);
  }
  const salary = obj.salary as Record<string, unknown> | undefined;
  if (!salary || typeof salary.ctcAnnual !== 'number' || typeof salary.structure !== 'string') {
    throw new Error(`Malformed test case at index ${index} in ${file}: missing valid salary definition`);
  }
  const expected = obj.expected as Record<string, unknown> | undefined;
  if (
    !expected ||
    typeof expected.ctcMonthly !== 'string' ||
    typeof expected.grossMonthly !== 'string' ||
    !Array.isArray(expected.lines)
  ) {
    throw new Error(`Malformed test case at index ${index} in ${file}: missing valid expected output block`);
  }
  return obj as unknown as GoldenCase;
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

  it('fails loudly if any golden JSON file is malformed or missing required schema keys', () => {
    for (const file of jsonFiles) {
      const filePath = path.join(__dirname, file);
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        throw new Error(`Failed to read golden file ${file}: ${String(err)}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Malformed JSON in golden file ${file}: ${String(err)}`);
      }

      if (!Array.isArray(parsed)) {
        throw new Error(`Golden file ${file} must contain a top-level JSON array of cases`);
      }

      for (let i = 0; i < parsed.length; i++) {
        validateGoldenCase(parsed[i], i, file);
      }
    }
  });

  const allCases: GoldenCase[] = [];
  for (const file of jsonFiles) {
    const raw = fs.readFileSync(path.join(__dirname, file), 'utf-8');
    const cases = JSON.parse(raw) as unknown[];
    for (let i = 0; i < cases.length; i++) {
      allCases.push(validateGoldenCase(cases[i], i, file));
    }
  }

  it('verifies test cases exist in golden directory', () => {
    expect(allCases.length).toBeGreaterThan(0);
  });

  allCases.forEach(tc => {
    it(`[${tc.id}] ${tc.description}`, () => {
      const structure = mockStructures[tc.salary.structure];
      expect(structure).toBeDefined();

      const breakup = calculateCtcBreakup(tc.salary.ctcAnnual, structure!);

      expect(breakup.ctcAnnual).toBe(tc.salary.ctcAnnual.toFixed(2));
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
