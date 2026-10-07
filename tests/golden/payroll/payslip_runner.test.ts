import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePayslip, PayslipCalculationInput } from '@hrms/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CaPayslipCase {
  id: string;
  description: string;
  input: PayslipCalculationInput;
  expected: {
    gross: string;
    deductions: string;
    reimbursements: string;
    net: string;
    lines: Array<{ code: string; amount: string }>;
  };
}

// NOTE: these cases were authored by the engineering team to smoke-test wiring and arithmetic.
// They are NOT CA golden cases (PHASE4_SPEC section 0.3: the oracle must come from the CA).
describe('Engineer-authored payslip smoke cases (not CA golden cases)', () => {
  const filePath = path.join(__dirname, 'engineer_payslip_smoke_cases.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const cases: CaPayslipCase[] = JSON.parse(raw);

  cases.forEach(tc => {
    it(`[${tc.id}] ${tc.description}`, () => {
      const result = computePayslip(tc.input);

      expect(result.gross).toBe(tc.expected.gross);
      expect(result.deductions).toBe(tc.expected.deductions);
      expect(result.reimbursements).toBe(tc.expected.reimbursements);
      expect(result.net).toBe(tc.expected.net);

      for (const expectedLine of tc.expected.lines) {
        const line = result.lines.find(l => l.code === expectedLine.code);
        expect(line, `Missing line item ${expectedLine.code}`).toBeDefined();
        expect(line!.amount, `Amount mismatch for ${expectedLine.code}`).toBe(expectedLine.amount);
      }
    });
  });
});

describe('CA golden payslip cases (docs/CA_VALIDATION_KIT.md section 5)', () => {
  const goldenPath = path.join(__dirname, 'ca_golden_cases.json');
  const rawGolden = fs.readFileSync(goldenPath, 'utf-8');
  const goldenCases: CaPayslipCase[] = JSON.parse(rawGolden);

  it(`verifies at least 50 CA golden cases are present (found ${goldenCases.length})`, () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(50);
  });

  goldenCases.forEach(tc => {
    it(`[${tc.id}] ${tc.description}`, () => {
      const result = computePayslip(tc.input);

      expect(result.gross, `Gross mismatch on ${tc.id}`).toBe(tc.expected.gross);
      expect(result.deductions, `Deductions mismatch on ${tc.id}`).toBe(tc.expected.deductions);
      expect(result.reimbursements, `Reimbursements mismatch on ${tc.id}`).toBe(tc.expected.reimbursements);
      expect(result.net, `Net mismatch on ${tc.id}`).toBe(tc.expected.net);

      for (const expectedLine of tc.expected.lines) {
        const line = result.lines.find(l => l.code === expectedLine.code);
        expect(line, `Missing line item ${expectedLine.code} on ${tc.id}`).toBeDefined();
        expect(line!.amount, `Amount mismatch for ${expectedLine.code} on ${tc.id}`).toBe(expectedLine.amount);
      }
    });
  });
});

