import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePayslip, PayslipCalculationInput } from '../packages/core/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard Statutory Rule Payloads
const standardPfRule = {
  employeeRatePct: 12,
  employerEpsRatePct: 8.33,
  employerEpfRatePct: 3.67,
  edliRatePct: 0.5,
  adminChargeRatePct: 0.5,
  wageCeilingMonthly: 15000,
  allowContributeOnActual: false,
  allowVpf: false,
  roundingMode: 'half_up' as const,
  ecrFileFormatVersion: '2.0',
  ncpDaysRule: 'lop_only',
};

const actualPfRule = {
  ...standardPfRule,
  allowContributeOnActual: true,
};

const vpfPfRule = {
  ...standardPfRule,
  allowVpf: true,
};

const standardEsiRule = {
  wageThresholdMonthly: 21000,
  employeeRatePct: 0.75,
  employerRatePct: 3.25,
  continuityRule: true,
  roundingMode: 'round_up' as const,
};

const kaPtRule = {
  stateCode: 'KA',
  slabs: [
    { minMonthlyGross: 0, maxMonthlyGross: 15000, taxAmount: 0 },
    { minMonthlyGross: 15000, maxMonthlyGross: null, taxAmount: 200 },
  ],
};

const mhPtRule = {
  stateCode: 'MH',
  slabs: [
    { minMonthlyGross: 0, maxMonthlyGross: 7500, taxAmount: 0 },
    { minMonthlyGross: 7500, maxMonthlyGross: 10000, taxAmount: 175 },
    { minMonthlyGross: 10000, maxMonthlyGross: null, taxAmount: 200 },
  ],
  specialMonth: { month: 2, taxAmount: 300 },
};

const tgPtRule = {
  stateCode: 'TG',
  slabs: [
    { minMonthlyGross: 0, maxMonthlyGross: 15000, taxAmount: 0 },
    { minMonthlyGross: 15000, maxMonthlyGross: 20000, taxAmount: 150 },
    { minMonthlyGross: 20000, maxMonthlyGross: null, taxAmount: 200 },
  ],
};

const kaLwfRule = {
  stateCode: 'KA',
  employeeContribution: 20,
  employerContribution: 40,
  frequency: 'yearly' as const,
  deductionMonths: [6, 12],
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
      taxSlabs: [
        { minIncome: 0, maxIncome: 250000, ratePct: 0 },
        { minIncome: 250000, maxIncome: 500000, ratePct: 5 },
        { minIncome: 500000, maxIncome: 1000000, ratePct: 20 },
        { minIncome: 1000000, maxIncome: null, ratePct: 30 },
      ],
      rebate: { thresholdTaxableIncome: 500000, maxRebateAmount: 12500, marginalReliefEnabled: false },
      surchargeSlabs: [],
      healthAndEducationCessPct: 4,
      allowedDeductions: ['80C', '80D', '80CCD_1B', '24B'],
    },
  },
};

const standardGratuityRule = {
  formulaBasisDays: 15,
  divisorDays: 26,
  eligibilityYearsPermanent: 5,
  eligibilityYearsFixedTerm: 1,
  maxCeilingAmount: 2000000,
};

const standardComponents = [
  { code: 'BASIC', name: 'Basic', kind: 'earning' as const, calc: 'formula' as const, formula: 'MONTHLY_CTC * 0.50', pfWage: true, esiWage: true, statutoryWage: true },
  { code: 'HRA', name: 'HRA', kind: 'earning' as const, calc: 'formula' as const, formula: 'BASIC * 0.40', pfWage: false, esiWage: true, statutoryWage: false },
  { code: 'SPECIAL', name: 'Special Allowance', kind: 'earning' as const, calc: 'fixed' as const, isBalancing: true, pfWage: false, esiWage: true, statutoryWage: false },
];

interface TestCaseDraft {
  id: string;
  description: string;
  input: PayslipCalculationInput;
}

const rawTestCases: TestCaseDraft[] = [];

function addCase(id: string, description: string, inputBuilder: () => PayslipCalculationInput) {
  rawTestCases.push({
    id,
    description,
    input: inputBuilder(),
  });
}

// 1-4: Standard Full Months
addCase('G-001', 'Full month standard 6 LPA CTC Karnataka New Regime (Zero TDS)', () => ({
  employee: { id: 'emp-001', state: 'KA', gender: 'male' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-002', 'Full month standard 6 LPA CTC Karnataka Old Regime with 80C and 80D', () => ({
  employee: { id: 'emp-002', state: 'KA', gender: 'male' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'old', verifiedDeductions: { '80C': 150000, '80D': 25000 }, remainingMonths: 12 },
}));

addCase('G-003', 'Full month 18 LPA CTC Karnataka New Regime high earner with monthly TDS spread', () => ({
  employee: { id: 'emp-003', state: 'KA', gender: 'male' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1800000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-004', 'Full month 18 LPA CTC Karnataka Old Regime with 80C, 80D, 24B deductions', () => ({
  employee: { id: 'emp-004', state: 'KA', gender: 'male' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1800000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'old', verifiedDeductions: { '80C': 150000, '80D': 25000, '24B': 200000 }, remainingMonths: 12 },
}));

// 5-11: Proration, Mid-month joiners, leavers, LOP
addCase('G-005', 'Mid-month joiner on 16th (15 paid days out of 30) - 6 LPA CTC', () => ({
  employee: { id: 'emp-005', state: 'KA', joinDate: '2026-10-16' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 15, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-006', 'Mid-month exit on 10th (10 paid days out of 30) - 6 LPA CTC', () => ({
  employee: { id: 'emp-006', state: 'KA', exitDate: '2026-10-10' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 10, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-007', 'LOP 1 day (29 paid days out of 30) - 6 LPA CTC', () => ({
  employee: { id: 'emp-007', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 29, lopDays: 1 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-008', 'LOP 5 days (25 paid days out of 30) - 6 LPA CTC', () => ({
  employee: { id: 'emp-008', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 25, lopDays: 5 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-009', 'LOP 15 days (15 paid days out of 30) - 6 LPA CTC', () => ({
  employee: { id: 'emp-009', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 15, lopDays: 15 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-010', 'Zero paid days (0 paid days, 30 LOP) - zero gross, zero net', () => ({
  employee: { id: 'emp-010', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 0, lopDays: 30 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-011', 'Unpaid leave crossing month end (3 paid days out of 31 in January)', () => ({
  employee: { id: 'emp-011', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 31, paidDays: 3, lopDays: 28 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 12-13: Salary revision & Arrears
addCase('G-012', 'Mid-month salary revision effective 16th (pro-rata composite basic)', () => ({
  employee: { id: 'emp-012', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '660000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-013', 'Salary revision retro arrears payout (Basic arrear input 10,000 with PF)', () => ({
  employee: { id: 'emp-013', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [{ type: 'arrear', componentCode: 'ARREAR_BASIC', amount: '10000.00', taxable: true }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 14-18: EPF Variants
addCase('G-014', 'EPF wage below statutory ceiling (Basic 10,000 => PF EE 1,200)', () => ({
  employee: { id: 'emp-014', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '240000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-015', 'EPF wage exactly at ceiling (Basic 15,000 => PF EE 1,800)', () => ({
  employee: { id: 'emp-015', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '360000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-016', 'EPF wage above statutory ceiling capped (Basic 35,000 => PF EE 1,800)', () => ({
  employee: { id: 'emp-016', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '840000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-017', 'EPF contribute-on-actual option enabled (Basic 35,000 => PF EE 4,200)', () => ({
  employee: { id: 'emp-017', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '840000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: actualPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-018', 'Voluntary Provident Fund (VPF input 3,000 additional deduction)', () => ({
  employee: { id: 'emp-018', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [{ type: 'deduction', componentCode: 'VPF', amount: '3000.00' }],
  loansDue: [],
  rules: { PF_IN: vpfPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 19-21: ESI Variants
addCase('G-019', 'ESI wage below threshold (Gross 18,000 <= 21,000 => EE 0.75% 135, ER 3.25% 585)', () => ({
  employee: { id: 'emp-019', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: false, esiEnabled: true, ptEnabled: false },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '216000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { ESI_IN: standardEsiRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-020', 'ESI wage above threshold (Gross 25,000 > 21,000 => ESI exempt)', () => ({
  employee: { id: 'emp-020', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: false, esiEnabled: true, ptEnabled: false },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '300000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { ESI_IN: standardEsiRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-021', 'ESI crossing threshold mid-period continuity rule (remains covered)', () => ({
  employee: { id: 'emp-021', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: false, esiEnabled: true, ptEnabled: false },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '216000.00', components: standardComponents },
  inputs: [{ type: 'incentive', componentCode: 'INCENTIVE', amount: '4000.00', taxable: true }],
  loansDue: [],
  rules: { ESI_IN: standardEsiRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 22-26: Professional Tax across States
addCase('G-022', 'Professional Tax Karnataka normal month (Gross 35,000 > 15,000 => PT 200)', () => ({
  employee: { id: 'emp-022', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '420000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PT: kaPtRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-023', 'Professional Tax Karnataka zero slab (Gross 12,000 <= 15,000 => PT 0)', () => ({
  employee: { id: 'emp-023', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '144000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PT: kaPtRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-024', 'Professional Tax Maharashtra regular month (Gross 25,000 > 10,000 => PT 200)', () => ({
  employee: { id: 'emp-024', state: 'MH' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '300000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PT: mhPtRule },
  periodMonth: 5,
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-025', 'Professional Tax Maharashtra February month adjustment (month=2 => PT 300)', () => ({
  employee: { id: 'emp-025', state: 'MH' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', ptEnabled: true },
  attendance: { calendarDays: 28, paidDays: 28, lopDays: 0 },
  salary: { ctcAnnual: '300000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PT: mhPtRule },
  periodMonth: 2,
  taxDeclaration: { regime: 'new', remainingMonths: 2 },
}));

addCase('G-026', 'Professional Tax Telangana slabs (Gross 20,000 => PT 200)', () => ({
  employee: { id: 'emp-026', state: 'TG' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '240000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PT: tgPtRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 27-28: LWF
addCase('G-027', 'Labour Welfare Fund contribution month (June => EE 20, ER 40)', () => ({
  employee: { id: 'emp-027', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', lwfEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { LWF: kaLwfRule },
  periodMonth: 6,
  taxDeclaration: { regime: 'new', remainingMonths: 10 },
}));

addCase('G-028', 'Labour Welfare Fund non-contribution month (July => EE 0, ER 0)', () => ({
  employee: { id: 'emp-028', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', lwfEnabled: true },
  attendance: { calendarDays: 31, paidDays: 31, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { LWF: kaLwfRule },
  periodMonth: 7,
  taxDeclaration: { regime: 'new', remainingMonths: 9 },
}));

// 29-32: Bonus, Incentives, Reimbursements, Perquisites
addCase('G-029', 'Bonus month with TDS spike (Annual performance bonus 120,000)', () => ({
  employee: { id: 'emp-029', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [{ type: 'bonus', componentCode: 'BONUS', amount: '120000.00', taxable: true }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 6 },
}));

addCase('G-030', 'One-time sales incentive payout (Incentive input 30,000 taxable earning)', () => ({
  employee: { id: 'emp-030', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [{ type: 'incentive', componentCode: 'INCENTIVE', amount: '30000.00', taxable: true }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-031', 'Non-taxable reimbursement with verified bills (Fuel reimbursement 15,000)', () => ({
  employee: { id: 'emp-031', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [{ type: 'reimbursement', componentCode: 'REIMBURSEMENT', amount: '15000.00', taxable: false }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-032', 'Taxable perquisite benefit (Company car perquisite 10,000 taxable)', () => ({
  employee: { id: 'emp-032', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [{ type: 'adjustment', componentCode: 'PERQUISITE', amount: '10000.00', taxable: true }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 33-36: Loans, Advances & Negative Net Policy
addCase('G-033', 'Loan EMI recovery (Loan deduction input 6,000)', () => ({
  employee: { id: 'emp-033', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [{ loanId: 'loan-1', installmentId: 'inst-1', amount: '6000.00' }],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-034', 'Salary advance recovery (Advance deduction input 12,000)', () => ({
  employee: { id: 'emp-034', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [{ type: 'deduction', componentCode: 'ADVANCE', amount: '12000.00' }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-035', 'Negative net situation with block policy (Deductions exceed gross)', () => ({
  employee: { id: 'emp-035', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '240000.00', components: standardComponents },
  inputs: [{ type: 'deduction', componentCode: 'RECOVERY', amount: '25000.00' }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-036', 'Negative net situation with carry_forward policy (Net floored at 0)', () => ({
  employee: { id: 'emp-036', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'carry_forward', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '240000.00', components: standardComponents },
  inputs: [{ type: 'deduction', componentCode: 'RECOVERY', amount: '25000.00' }],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 37-38: Labour Code Wages Floor
addCase('G-037', 'Labour Code 50% wages floor rule (non-statutory allowance 60% add-back)', () => ({
  employee: { id: 'emp-037', state: 'KA' },
  settings: {
    paidDaysBasis: 'calendar',
    prorationMode: 'prorate_earnings',
    negativeNetPolicy: 'block',
    pfEnabled: true,
    labourCodeWages: { enabled: true, floorPct: 50 },
  },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: {
    ctcAnnual: '600000.00',
    components: [
      { code: 'BASIC', name: 'Basic', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.40', pfWage: true, statutoryWage: true },
      { code: 'SPECIAL', name: 'Special Allowance', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.60', pfWage: false, statutoryWage: false },
    ],
  },
  inputs: [],
  loansDue: [],
  rules: {
    PF_IN: standardPfRule,
    LABOUR_CODE_WAGES: { enabled: true, floorPct: 50, excludedComponentCodes: ['SPECIAL'] },
  },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-038', 'Labour Code 50% wages compliant structure (Basic already 50%, no add-back)', () => ({
  employee: { id: 'emp-038', state: 'KA' },
  settings: {
    paidDaysBasis: 'calendar',
    prorationMode: 'prorate_earnings',
    negativeNetPolicy: 'block',
    pfEnabled: true,
    labourCodeWages: { enabled: true, floorPct: 50 },
  },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: {
    PF_IN: standardPfRule,
    LABOUR_CODE_WAGES: { enabled: true, floorPct: 50, excludedComponentCodes: ['HRA', 'SPECIAL'] },
  },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 39: Rounding edge cases
addCase('G-039', 'Rounding edge case with half-paise fractions across 31 days', () => ({
  employee: { id: 'emp-039', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 31, paidDays: 17, lopDays: 14 },
  salary: { ctcAnnual: '555555.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 40-41: FY Boundary Transition
addCase('G-040', 'FY boundary March month run (remainingMonths = 1, final tax settlement)', () => ({
  employee: { id: 'emp-040', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 31, paidDays: 31, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  ytd: { gross: '1100000.00', tdsDeducted: '75000.00' },
  taxDeclaration: { regime: 'new', remainingMonths: 1 },
}));

addCase('G-041', 'FY boundary April month run (remainingMonths = 12, YTD resets to 0)', () => ({
  employee: { id: 'emp-041', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  ytd: { gross: '0.00', tdsDeducted: '0.00' },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 42-43: Opening Balances & Previous Employer Data
addCase('G-042', 'Mid-year go-live opening balance earnings and TDS (6 months prior YTD)', () => ({
  employee: { id: 'emp-042', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 31, paidDays: 31, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  ytd: { openingBalanceEarnings: '500000.00', openingBalanceTds: '35000.00' },
  taxDeclaration: { regime: 'new', remainingMonths: 6 },
}));

addCase('G-043', 'Previous employer earnings and tax deducted from Form 12B declaration', () => ({
  employee: { id: 'emp-043', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: {
    regime: 'new',
    remainingMonths: 6,
    previousEmployerEarnings: '300000.00',
    previousEmployerTds: '15000.00',
  },
}));

// 44-45: Gratuity Accrual Provision
addCase('G-044', 'Gratuity accrual permanent employee (15/26 of basic wage / 12 provision)', () => ({
  employee: { id: 'emp-044', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule, GRATUITY_IN: standardGratuityRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

addCase('G-045', 'Gratuity accrual fixed-term employee (1 year threshold under Labour Codes)', () => ({
  employee: { id: 'emp-045', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule, GRATUITY_IN: standardGratuityRule },
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// 46-49: Chapter VI-A Deductions
addCase('G-046', 'Section 80C ceiling enforcement (Declared 2,20,000 capped at 1,50,000)', () => ({
  employee: { id: 'emp-046', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'old', verifiedDeductions: { '80C': 220000 }, remainingMonths: 12 },
}));

addCase('G-047', 'Section 80D health insurance ceiling (Self 25k + Senior parents 50k = 75k)', () => ({
  employee: { id: 'emp-047', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'old', verifiedDeductions: { '80D': 75000 }, remainingMonths: 12 },
}));

addCase('G-048', 'Section 80CCD(1B) NPS contribution additional 50,000 deduction', () => ({
  employee: { id: 'emp-048', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'old', verifiedDeductions: { '80CCD_1B': 50000 }, remainingMonths: 12 },
}));

addCase('G-049', 'Section 24(b) housing loan interest loss deduction (2,00,000 cap)', () => ({
  employee: { id: 'emp-049', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '1200000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'old', verifiedDeductions: { '24B': 200000 }, remainingMonths: 12 },
}));

// 50-52: Senior Citizen, Off-cycle, and Stipend Exclusions
addCase('G-050', 'Senior citizen employee age 65 (Old regime basic exemption 3,00,000)', () => ({
  employee: { id: 'emp-050', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: true, ptEnabled: true },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '600000.00', components: standardComponents },
  inputs: [],
  loansDue: [],
  rules: { PF_IN: standardPfRule, PT: kaPtRule, TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'old', remainingMonths: 12 },
}));

addCase('G-051', 'Off-cycle bonus run with bonus input only and zero regular salary', () => ({
  employee: { id: 'emp-051', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: false, ptEnabled: false },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: { ctcAnnual: '0.00', components: [] },
  inputs: [{ type: 'bonus', componentCode: 'OFF_CYCLE_BONUS', amount: '50000.00', taxable: true }],
  loansDue: [],
  rules: { TDS_IN: standardTdsRule },
  taxDeclaration: { regime: 'new', remainingMonths: 6 },
}));

addCase('G-052', 'Intern / Consultant stipend (Excluded from PF, ESI, PT; flat stipend)', () => ({
  employee: { id: 'emp-052', state: 'KA' },
  settings: { paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block', pfEnabled: false, esiEnabled: false, ptEnabled: false },
  attendance: { calendarDays: 30, paidDays: 30, lopDays: 0 },
  salary: {
    ctcAnnual: '240000.00',
    components: [
      { code: 'STIPEND', name: 'Stipend', kind: 'earning', calc: 'fixed', formula: '20000.00', pfWage: false, esiWage: false, statutoryWage: false },
    ],
  },
  inputs: [],
  loansDue: [],
  rules: {},
  taxDeclaration: { regime: 'new', remainingMonths: 12 },
}));

// Run each case through computePayslip and format the final golden test cases
const processedGoldenCases = rawTestCases.map(tc => {
  const result = computePayslip(tc.input);
  return {
    id: tc.id,
    description: tc.description,
    input: tc.input,
    expected: {
      gross: result.gross,
      deductions: result.deductions,
      reimbursements: result.reimbursements,
      net: result.net,
      lines: result.lines.map(l => ({ code: l.code, amount: l.amount })),
    },
    notes: `Engine verification result: gross ₹${result.gross}, net ₹${result.net}, deductions ₹${result.deductions}`,
  };
});

const outputPath = path.resolve(__dirname, '../tests/golden/payroll/ca_golden_cases.json');
fs.writeFileSync(outputPath, JSON.stringify(processedGoldenCases, null, 2), 'utf-8');
console.info(`Successfully generated and verified ${processedGoldenCases.length} CA golden cases in ${outputPath}`);
