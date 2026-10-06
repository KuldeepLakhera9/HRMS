import { describe, it, expect } from 'vitest';
import { computePayslip, PayslipCalculationInput } from './payslip.js';
import { Decimal } from 'decimal.js';

describe('Pure computePayslip Engine & Property Tests (Steps 1 to 11)', () => {
  const sampleInput: PayslipCalculationInput = {
    employee: {
      id: 'emp-101',
      empCode: 'EMP-101',
      state: 'KA',
      gender: 'male',
      bankAccountNumber: '98765432101234',
    },
    settings: {
      paidDaysBasis: 'calendar',
      prorationMode: 'prorate_earnings',
      negativeNetPolicy: 'block',
      pfEnabled: true,
      esiEnabled: true,
      ptEnabled: true,
      lwfEnabled: false,
    },
    attendance: {
      calendarDays: 30,
      paidDays: 30,
      lopDays: 0,
    },
    salary: {
      ctcAnnual: '1200000.00',
      components: [
        { code: 'BASIC', name: 'Basic Salary', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.50', pfWage: true, esiWage: true, gratuityWage: true, statutoryWage: true },
        { code: 'HRA', name: 'House Rent Allowance', kind: 'earning', calc: 'formula', formula: 'BASIC * 0.40', pfWage: false, esiWage: true, gratuityWage: false, statutoryWage: false },
        { code: 'SPECIAL', name: 'Special Allowance', kind: 'earning', calc: 'fixed', isBalancing: true, pfWage: false, esiWage: true, gratuityWage: false, statutoryWage: false },
      ],
    },
    inputs: [
      { type: 'bonus', amount: '20000.00', taxable: true },
      { type: 'reimbursement', amount: '5000.00', taxable: false },
    ],
    loansDue: [
      { loanId: 'loan-1', installmentId: 'inst-1', amount: '5000.00' },
    ],
    rules: {
      PF_IN: {
        employeeRatePct: 12,
        employerEpsRatePct: 8.33,
        employerEpfRatePct: 3.67,
        edliRatePct: 0.5,
        adminChargeRatePct: 0.5,
        wageCeilingMonthly: 15000,
        allowContributeOnActual: false,
        allowVpf: true,
        roundingMode: 'half_up',
        ecrFileFormatVersion: '2.0',
        ncpDaysRule: 'lop_only',
      },
      PT: {
        stateCode: 'KA',
        slabs: [
          { minMonthlyGross: 0, maxMonthlyGross: 15000, taxAmount: 0 },
          { minMonthlyGross: 15000, maxMonthlyGross: null, taxAmount: 200 },
        ],
      },
      TDS_IN: {
        financialYear: '2026-2027',
        regimes: {
          new: {
            standardDeduction: 75000,
            taxSlabs: [
              { minIncome: 0, maxIncome: 300000, ratePct: 0 },
              { minIncome: 300000, maxIncome: 700000, ratePct: 5 },
              { minIncome: 700000, maxIncome: 1000000, ratePct: 10 },
              { minIncome: 1000000, maxIncome: null, ratePct: 15 },
            ],
            rebate: { thresholdTaxableIncome: 700000, maxRebateAmount: 20000, marginalReliefEnabled: true },
            surchargeSlabs: [],
            healthAndEducationCessPct: 4,
            allowedDeductions: [],
          },
          old: {
            standardDeduction: 50000,
            taxSlabs: [],
            rebate: { thresholdTaxableIncome: 500000, maxRebateAmount: 12500, marginalReliefEnabled: false },
            surchargeSlabs: [],
            healthAndEducationCessPct: 4,
            allowedDeductions: [],
          },
        },
      },
      GRATUITY_IN: {
        formulaBasisDays: 15,
        divisorDays: 26,
        eligibilityYearsPermanent: 5,
        eligibilityYearsFixedTerm: 1,
        maxCeilingAmount: 2000000,
      },
    },
    taxDeclaration: {
      regime: 'new',
      remainingMonths: 11,
    },
  };

  it('Property 1: Exact balance equation holds: net = gross + reimbursements - deductions', () => {
    const result = computePayslip(sampleInput);

    const gross = new Decimal(result.gross);
    const reimbursements = new Decimal(result.reimbursements);
    const deductions = new Decimal(result.deductions);
    const net = new Decimal(result.net);

    expect(net.toFixed(2)).toBe(gross.plus(reimbursements).minus(deductions).toFixed(2));
  });

  it('Property 2: Deterministic calculation and byte-identical input hash', () => {
    const run1 = computePayslip(sampleInput);
    const run2 = computePayslip(sampleInput);

    expect(run1.inputHash).toBe(run2.inputHash);
    expect(run1.net).toBe(run2.net);
    expect(run1.gross).toBe(run2.gross);
    expect(run1.lines).toEqual(run2.lines);
  });

  it('Property 3: Proration is monotonic (less days worked => less gross earnings)', () => {
    const fullMonth = computePayslip(sampleInput);
    const halfMonth = computePayslip({
      ...sampleInput,
      attendance: { calendarDays: 30, paidDays: 15, lopDays: 0 },
    });

    expect(Number(halfMonth.gross)).toBeLessThan(Number(fullMonth.gross));
    expect(halfMonth.payableRatio).toBe('0.500000');
  });

  it('Property 4: Loan EMI net pay safeguard partially recovers when net pay is insufficient', () => {
    // If huge loan EMI is demanded, safeguard recovers only up to available net
    const highLoanInput: PayslipCalculationInput = {
      ...sampleInput,
      loansDue: [
        { loanId: 'loan-1', installmentId: 'inst-1', amount: '200000.00' },
      ],
    };

    const result = computePayslip(highLoanInput);
    expect(Number(result.net)).toBeGreaterThanOrEqual(0);
    expect(result.warnings.some(w => w.includes('partially recovered'))).toBe(true);
  });

  it('Property 5: Statutory caps respected (PF does not exceed 15,000 ceiling when cap is enabled)', () => {
    const result = computePayslip(sampleInput);
    const pfLine = result.lines.find(l => l.code === 'PF_EE');

    // 15,000 * 12% = 1800
    expect(pfLine?.amount).toBe('1800.00');
  });

  it('Property 6: TDS computed is non-negative and properly integrated', () => {
    const result = computePayslip(sampleInput);
    const tdsLine = result.lines.find(l => l.code === 'TDS');

    expect(tdsLine).toBeDefined();
    expect(Number(tdsLine?.amount)).toBeGreaterThanOrEqual(0);
  });
});
