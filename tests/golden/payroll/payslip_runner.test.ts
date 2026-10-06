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

describe('CA Golden Test Oracle (Payslip Execution)', () => {
  const filePath = path.join(__dirname, 'ca_payslip_cases.json');
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
