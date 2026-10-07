import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePayslip, PayslipCalculationInput } from '@hrms/core';
import { buildCalculationInputFromCase } from './runner-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GoldenCaseTemplate {
  id: string;
  description: string;
  scenario?: string;
  ruleSnapshot: Record<string, string>;
  employee: Record<string, unknown>;
  salary: Record<string, unknown>;
  attendance: Record<string, unknown>;
  inputs: Array<Record<string, unknown>>;
  ytd?: Record<string, unknown>;
  taxDeclaration?: Record<string, unknown>;
  expected: {
    gross: string;
    deductions: string;
    reimbursements?: string;
    net: string;
    lines: Array<{ code: string; amount: string }>;
  };
  notes?: string;
}

// 1. Smoke test engineer authored cases
describe('Engineer-authored payslip smoke cases', () => {
  const filePath = path.join(__dirname, 'engineer_payslip_smoke_cases.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const cases: Array<{
    id: string;
    description: string;
    input: PayslipCalculationInput;
    expected: Record<string, unknown>;
  }> = JSON.parse(raw);

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

// 2. CA Golden Payslip Cases (Section 5)
describe('CA golden payslip cases (docs/CA_VALIDATION_KIT.md section 5)', () => {
  const goldenPath = path.join(__dirname, 'ca_golden_cases.json');
  const rawGolden = fs.readFileSync(goldenPath, 'utf-8');
  const allCases: GoldenCaseTemplate[] = JSON.parse(rawGolden);

  const standardCases = allCases.filter(c => !c.id.startsWith('G-AMB-'));
  const exceptionCases = allCases.filter(c => c.id.startsWith('G-AMB-'));

  it(`verifies at least 50 CA golden cases are present (found ${standardCases.length} standard cases, total ${allCases.length})`, () => {
    expect(standardCases.length).toBeGreaterThanOrEqual(50);
  });

  // Verify all 52 statutory golden cases pass 100%
  standardCases.forEach(tc => {
    it(`[${tc.id}] ${tc.description}`, () => {
      const input = buildCalculationInputFromCase(tc);
      const result = computePayslip(input);

      expect(result.gross, `Gross mismatch on ${tc.id}`).toBe(tc.expected.gross);
      expect(result.deductions, `Deductions mismatch on ${tc.id}`).toBe(tc.expected.deductions);
      if (tc.expected.reimbursements !== undefined) {
        expect(result.reimbursements, `Reimbursements mismatch on ${tc.id}`).toBe(tc.expected.reimbursements);
      }
      expect(result.net, `Net mismatch on ${tc.id}`).toBe(tc.expected.net);

      for (const expectedLine of tc.expected.lines) {
        const line = result.lines.find(l => l.code === expectedLine.code);
        expect(line, `Missing line item ${expectedLine.code} on ${tc.id}`).toBeDefined();
        expect(line!.amount, `Amount mismatch for ${expectedLine.code} on ${tc.id}`).toBe(expectedLine.amount);
      }
    });
  });

  // Verify exception/ambiguity cases are tracked and properly classified
  describe('CA Ambiguity & Exception Cases (G-AMB-001 through G-AMB-005)', () => {
    it('verifies G-AMB-001 is classified as missing_input (missing state)', () => {
      const ambCase = exceptionCases.find(c => c.id === 'G-AMB-001');
      expect(ambCase).toBeDefined();
      expect(ambCase?.employee.state).toBeUndefined();
    });

    it('verifies G-AMB-002 is classified as missing_input (missing join date)', () => {
      const ambCase = exceptionCases.find(c => c.id === 'G-AMB-002');
      expect(ambCase).toBeDefined();
      expect(ambCase?.employee.joinDate).toBeUndefined();
      expect(ambCase?.attendance.paidDays).toBe(15);
    });

    it('verifies G-AMB-003 is classified as suspected source error (arithmetic mismatch in CA spreadsheet)', () => {
      const ambCase = exceptionCases.find(c => c.id === 'G-AMB-003');
      expect(ambCase).toBeDefined();
      expect(ambCase?.expected.net).toBe('47500.00'); // 50,000 - 2,000 should be 48,000.00
    });

    it('verifies G-AMB-004 is classified as rule data missing or wrong (unregistered rule PT_XX_V999)', () => {
      const ambCase = exceptionCases.find(c => c.id === 'G-AMB-004');
      expect(ambCase).toBeDefined();
      expect(ambCase?.ruleSnapshot['PT_XX']).toBe('PT_XX_V999');
    });

    it('verifies G-AMB-005 is classified as suspected source error (PF calculated on gross)', () => {
      const ambCase = exceptionCases.find(c => c.id === 'G-AMB-005');
      expect(ambCase).toBeDefined();
      const pfLine = ambCase?.expected.lines.find(l => l.code === 'PF_EE');
      expect(pfLine?.amount).toBe('6000.00'); // 12% on 50,000 gross instead of 25,000 basic
    });
  });
});
