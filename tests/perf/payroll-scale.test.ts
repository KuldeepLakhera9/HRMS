import { describe, it, expect } from 'vitest';
import {
  computePayslip,
  generatePayslipPdf,
  type PayslipCalculationInput,
  type PayslipPdfData,
} from '@hrms/core';

describe('P4-QA-03: Payroll Scale & Performance Benchmarks (5,000 Employees)', () => {
  const standardPfRule = {
    employeeRatePct: 12,
    employerRatePct: 12,
    wageCeilingMonthly: 15000,
    allowContributeOnActual: true,
    employerEpsRatePct: 8.33,
    employerEpfRatePct: 3.67,
    edliRatePct: 0.5,
    adminChargesRatePct: 0.5,
  };

  const kaPtRule = {
    stateCode: 'KA',
    slabs: [
      { minMonthlyGross: 0, maxMonthlyGross: 15000, taxAmount: 0 },
      { minMonthlyGross: 15000, maxMonthlyGross: null, taxAmount: 200 },
    ],
  };

  const standardTdsRule = {
    financialYear: '2026-2027',
    regimes: {
      new: {
        standardDeduction: 75000,
        taxSlabs: [
          { minIncome: 0, maxIncome: 300000, ratePct: 0 },
          { minIncome: 300000, maxIncome: 700000, ratePct: 5 },
          { minIncome: 700000, maxIncome: 1000000, ratePct: 10 },
          { minIncome: 1000000, maxIncome: 1200000, ratePct: 15 },
          { minIncome: 1200000, maxIncome: 1500000, ratePct: 20 },
          { minIncome: 1500000, maxIncome: null, ratePct: 30 },
        ],
        rebate: { thresholdTaxableIncome: 700000, maxRebateAmount: 25000, marginalReliefEnabled: true },
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
  };

  const standardComponents = [
    { code: 'BASIC', name: 'Basic', kind: 'earning' as const, calc: 'formula' as const, formula: 'MONTHLY_CTC * 0.50', pfWage: true, esiWage: true, statutoryWage: true },
    { code: 'HRA', name: 'HRA', kind: 'earning' as const, calc: 'formula' as const, formula: 'BASIC * 0.40', pfWage: false, esiWage: true, statutoryWage: false },
    { code: 'SPECIAL', name: 'Special Allowance', kind: 'earning' as const, calc: 'fixed' as const, isBalancing: true, pfWage: false, esiWage: true, statutoryWage: false },
  ];

  it('should calculate 5,000 employee payslips in under 5 seconds (target SLA: <= 5 min for full batch)', () => {
    const EMPLOYEE_COUNT = 5000;
    const inputs: PayslipCalculationInput[] = [];

    // Synthesize 5,000 diverse employee payroll inputs
    for (let i = 0; i < EMPLOYEE_COUNT; i++) {
      const ctcAnnual = 300000 + (i % 20) * 100000; // 3 LPA to 23 LPA
      const lopDays = i % 10 === 0 ? 2 : 0; // 10% have LOP
      inputs.push({
        employee: {
          id: `emp-${String(i).padStart(5, '0')}`,
          state: 'KA',
          bankAccountNumber: `9876543210${String(i).padStart(4, '0')}`,
          pan: `ABCDE${String(1000 + (i % 8999))}F`,
        },
        settings: {
          paidDaysBasis: 'calendar',
          prorationMode: 'prorate_earnings',
          negativeNetPolicy: 'block',
          pfEnabled: true,
          ptEnabled: true,
        },
        attendance: {
          calendarDays: 30,
          paidDays: 30 - lopDays,
          lopDays,
        },
        salary: {
          ctcAnnual: ctcAnnual.toFixed(2),
          components: standardComponents,
        },
        inputs: [],
        loansDue: [],
        rules: {
          PF_IN: standardPfRule,
          PT: kaPtRule,
          TDS_IN: standardTdsRule,
        },
        taxDeclaration: {
          regime: 'new',
          remainingMonths: 10,
        },
      });
    }

    const startTime = Date.now();
    const results = [];

    for (let i = 0; i < EMPLOYEE_COUNT; i++) {
      const result = computePayslip(inputs[i]!);
      results.push(result);
    }

    const durationMs = Date.now() - startTime;
    const throughputPerSec = Math.round((EMPLOYEE_COUNT / durationMs) * 1000);

    // Assertions
    expect(results.length).toBe(EMPLOYEE_COUNT);
    expect(durationMs).toBeLessThan(5000); // Strict: <= 5,000 ms for 5,000 calculations (1,000+ payslips/sec)
    expect(results[0]?.gross).toBeDefined();
    expect(results[0]?.net).toBeDefined();

    // Verify throughput is documented
    expect(throughputPerSec).toBeGreaterThan(500); // At least 500 payslips/second throughput
  });

  it('should generate a pure-JS payslip PDF in under 200 ms with valid PDF layout', async () => {
    const samplePayslipData: PayslipPdfData = {
      company: {
        name: 'Acme Technologies Private Limited',
        address: 'Tower A, Embassy Tech Village, Outer Ring Road, Bangalore - 560103',
        pan: 'AAACA1234F',
        tan: 'BLRA12345B',
      },
      employee: {
        empCode: 'EMP-001',
        name: 'Aarav Sharma',
        designation: 'Senior Staff Engineer',
        department: 'Core Infrastructure',
        joiningDate: '2022-03-15',
        bankName: 'HDFC Bank',
        bankAccountNumber: '98765432101234',
        pan: 'ABCDE1234F',
        uan: '100912345678',
      },
      period: '2026-05',
      attendance: {
        calendarDays: 31,
        paidDays: 31,
        lopDays: 0,
      },
      earnings: [
        { code: 'BASIC', name: 'Basic Pay', amount: '62500.00' },
        { code: 'HRA', name: 'House Rent Allowance', amount: '25000.00' },
        { code: 'SPECIAL', name: 'Special Allowance', amount: '37500.00' },
      ],
      deductions: [
        { code: 'PF_EE', name: 'Provident Fund (Employee)', amount: '1800.00' },
        { code: 'PT', name: 'Professional Tax', amount: '200.00' },
        { code: 'TDS', name: 'Tax Deducted at Source (TDS)', amount: '12500.00' },
      ],
      summary: {
        gross: '125000.00',
        deductions: '14500.00',
        net: '110500.00',
      },
      integrityHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    };

    const startTime = Date.now();
    const pdfBuffer = await generatePayslipPdf(samplePayslipData);
    const durationMs = Date.now() - startTime;

    expect(durationMs).toBeLessThan(200); // Rendered under 200 ms
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000); // Non-trivial binary document
    expect(pdfBuffer.subarray(0, 4).toString()).toBe('%PDF'); // Valid PDF magic bytes
  });
});
