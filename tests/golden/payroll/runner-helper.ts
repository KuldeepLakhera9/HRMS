import {
  type PayslipCalculationInput,
  type PayslipComponentDef,
} from '@hrms/core';

export const structures: Record<string, PayslipComponentDef[]> = {
  S1: [
    { code: 'BASIC', name: 'Basic', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.50', pfWage: true, esiWage: true, statutoryWage: true },
    { code: 'HRA', name: 'HRA', kind: 'earning', calc: 'formula', formula: 'BASIC * 0.40', pfWage: false, esiWage: true, statutoryWage: false },
    { code: 'SPECIAL', name: 'Special Allowance', kind: 'earning', calc: 'fixed', isBalancing: true, pfWage: false, esiWage: true, statutoryWage: false },
  ],
  S2: [
    { code: 'BASIC', name: 'Basic', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.60', pfWage: true, esiWage: true, statutoryWage: true },
    { code: 'HRA', name: 'HRA', kind: 'earning', calc: 'formula', formula: 'BASIC * 0.40', pfWage: false, esiWage: true, statutoryWage: false },
  ],
  S3: [
    { code: 'BASIC', name: 'Basic', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.35', pfWage: true, esiWage: true, statutoryWage: true },
    { code: 'HRA', name: 'HRA', kind: 'earning', calc: 'formula', formula: 'BASIC * 0.40', pfWage: false, esiWage: true, statutoryWage: false },
    { code: 'ALLOWANCE', name: 'Other Allowance', kind: 'earning', calc: 'fixed', isBalancing: true, pfWage: false, esiWage: false, statutoryWage: false },
  ],
  S4: [
    { code: 'STIPEND', name: 'Stipend', kind: 'earning', calc: 'fixed', isBalancing: true, pfWage: false, esiWage: false, statutoryWage: false },
  ],
  S5: [
    { code: 'BASIC', name: 'Basic', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.50', pfWage: true, esiWage: true, statutoryWage: true },
    { code: 'HRA', name: 'HRA', kind: 'earning', calc: 'formula', formula: 'BASIC * 0.40', pfWage: false, esiWage: true, statutoryWage: false },
    { code: 'SPECIAL', name: 'Special Allowance', kind: 'earning', calc: 'fixed', isBalancing: true, pfWage: false, esiWage: true, statutoryWage: false },
    { code: 'REIMB_FUEL', name: 'Fuel Reimbursement', kind: 'reimbursement', calc: 'input', taxable: false },
    { code: 'PERQ_CAR', name: 'Car Perquisite', kind: 'earning', calc: 'input', taxable: true },
  ],
};

export const standardPfRule = {
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

export const standardEsiRule = {
  wageThresholdMonthly: 21000,
  employeeRatePct: 0.75,
  employerRatePct: 3.25,
  continuityRule: true,
  roundingMode: 'round_up' as const,
};

export interface GoldenTestCaseInput {
  id?: string;
  description: string;
  ruleSnapshot: Record<string, string>;
  employee: {
    id?: string;
    empCode?: string;
    state?: string;
    gender?: 'male' | 'female' | 'other';
    joinDate?: string;
    exitDate?: string;
    pan?: string;
  };
  salary: {
    structure?: string;
    ctcAnnual: string | number;
    components?: PayslipComponentDef[];
  };
  settings?: Record<string, unknown>;
  attendance: {
    calendarDays: number;
    paidDays: number;
    lopDays: number;
  };
  inputs?: Array<{
    type: string;
    componentCode?: string;
    amount: string | number;
    taxable?: boolean;
  }>;
  loansDue?: Array<{
    loanId: string;
    installmentId: string;
    amount: string | number;
  }>;
  rules?: Record<string, unknown>;
  ytd?: {
    grossEarnings?: string | number;
    tdsDeducted?: string | number;
  };
  taxDeclaration?: {
    regime?: 'new' | 'old';
    verifiedDeductions?: Record<string, string | number>;
    previousEmployer?: {
      grossEarnings?: string | number;
      tdsDeducted?: string | number;
    };
  };
  periodMonth?: number;
}

export const ptRules: Record<
  string,
  {
    stateCode: string;
    slabs: Array<{ minMonthlyGross: number; maxMonthlyGross: number | null; taxAmount: number }>;
    specialMonth?: { month: number; taxAmount: number };
  }
> = {
  KA: {
    stateCode: 'KA',
    slabs: [
      { minMonthlyGross: 0, maxMonthlyGross: 15000, taxAmount: 0 },
      { minMonthlyGross: 15000, maxMonthlyGross: null, taxAmount: 200 },
    ],
  },
  MH: {
    stateCode: 'MH',
    slabs: [
      { minMonthlyGross: 0, maxMonthlyGross: 7500, taxAmount: 0 },
      { minMonthlyGross: 7500, maxMonthlyGross: 10000, taxAmount: 175 },
      { minMonthlyGross: 10000, maxMonthlyGross: null, taxAmount: 200 },
    ],
    specialMonth: { month: 2, taxAmount: 300 },
  },
  TG: {
    stateCode: 'TG',
    slabs: [
      { minMonthlyGross: 0, maxMonthlyGross: 15000, taxAmount: 0 },
      { minMonthlyGross: 15000, maxMonthlyGross: 20000, taxAmount: 150 },
      { minMonthlyGross: 20000, maxMonthlyGross: null, taxAmount: 200 },
    ],
  },
};

export const standardLwfRule = {
  stateCode: 'KA',
  employeeContribution: 20,
  employerContribution: 40,
  deductionMonths: [6, 12],
};

export const standardTdsRule = {
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

export function buildCalculationInputFromCase(tc: GoldenTestCaseInput): PayslipCalculationInput {
  const structureCode = tc.salary.structure || 'S1';
  let components = tc.salary.components && tc.salary.components.length > 0
    ? tc.salary.components
    : (structures[structureCode] || structures['S1']!);

  const isOffCycle = tc.description.toLowerCase().includes('off-cycle') || String(tc.salary.ctcAnnual) === '0.00' || tc.salary.ctcAnnual === 0;
  if (isOffCycle) {
    components = [];
  }

  // Resolve rules
  let rules: Record<string, unknown> | undefined = tc.rules && Object.keys(tc.rules).length > 0 ? { ...tc.rules } : undefined;

  if (!rules) {
    rules = {};
    let pfRule: Record<string, unknown> = standardPfRule;
    if (tc.ruleSnapshot['PF_IN'] === 'PF_IN_ACTUAL_V1' || tc.description.toLowerCase().includes('contribute-on-actual')) {
      pfRule = { ...standardPfRule, allowContributeOnActual: true };
    } else if (tc.ruleSnapshot['PF_IN'] === 'PF_IN_VPF_V1' || tc.description.toLowerCase().includes('vpf')) {
      pfRule = { ...standardPfRule, allowVpf: true };
    }
    rules.PF_IN = pfRule;
    rules.ESI_IN = standardEsiRule;
    const empState = tc.employee.state || 'KA';
    if (empState !== 'XX') rules.PT = ptRules[empState] || ptRules['KA'];
    rules.LWF = standardLwfRule;
    rules.TDS_IN = standardTdsRule;
  }

  const empState = tc.employee.state || 'KA';
  const isIntern = structureCode === 'S4' || tc.description.toLowerCase().includes('intern') || tc.description.toLowerCase().includes('consultant');
  const isLabourCode = structureCode === 'S3' || tc.description.toLowerCase().includes('labour code');

  const settings = tc.settings && Object.keys(tc.settings).length > 0
    ? tc.settings
    : {
        paidDaysBasis: 'calendar',
        prorationMode: 'prorate_earnings',
        negativeNetPolicy: tc.description.toLowerCase().includes('carry_forward') ? 'carry_forward' : 'block',
        pfEnabled: !isIntern && !isOffCycle,
        esiEnabled: !isIntern && !isOffCycle,
        ptEnabled: !isIntern && !isOffCycle && empState !== 'XX',
        lwfEnabled: !isIntern && !isOffCycle,
        labourCodeWages: isLabourCode ? { enabled: true, floorPct: 50 } : undefined,
      };

  const periodMonth = tc.periodMonth ?? 4;
  const loansDue = tc.loansDue || [];

  return {
    employee: {
      id: tc.employee.id || 'emp-test',
      empCode: tc.employee.empCode,
      state: empState,
      gender: tc.employee.gender || 'male',
      joinDate: tc.employee.joinDate,
      exitDate: tc.employee.exitDate,
      pan: tc.employee.pan,
    },
    settings,
    attendance: {
      calendarDays: tc.attendance.calendarDays,
      paidDays: tc.attendance.paidDays,
      lopDays: tc.attendance.lopDays,
    },
    salary: {
      ctcAnnual: tc.salary.ctcAnnual,
      structureId: structureCode,
      components,
    },
    inputs: (tc.inputs || []).map(i => ({
      type: i.type,
      componentCode: i.componentCode,
      amount: i.amount,
      taxable: i.taxable,
    })),
    loansDue,
    rules,
    ytd: tc.ytd,
    taxDeclaration: tc.taxDeclaration,
    periodMonth,
  };
}
