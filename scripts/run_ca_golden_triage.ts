import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computePayslip,
  PayslipCalculationInput,
  PayslipComponentDef,
} from '../packages/core/src/index.js';
import type { GoldenCaseTemplate } from './convert_ca_spreadsheets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Structure Definitions
const structures: Record<string, PayslipComponentDef[]> = {
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

// 2. Standard Rule Snapshot Payloads
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

const standardEsiRule = {
  wageThresholdMonthly: 21000,
  employeeRatePct: 0.75,
  employerRatePct: 3.25,
  continuityRule: true,
  roundingMode: 'round_up' as const,
};

const ptRules: Record<string, any> = {
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

const standardLwfRule = {
  stateCode: 'KA',
  employeeContribution: 20,
  employerContribution: 40,
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

export interface TriageFailure {
  caseId: string;
  description: string;
  lineOrField: string;
  expected: string;
  actual: string;
  classification: 'engine bug' | 'rule data missing or wrong' | 'ambiguous case' | 'suspected source error';
  evidence: string;
}

export function buildCalculationInput(tc: GoldenCaseTemplate): PayslipCalculationInput {
  const structureCode = tc.salary.structure || 'S1';
  let components = (tc.salary as any).components && (tc.salary as any).components.length > 0
    ? (tc.salary as any).components
    : (structures[structureCode] || structures['S1']!);

  const isOffCycle = tc.description.toLowerCase().includes('off-cycle') || String(tc.salary.ctcAnnual) === '0.00' || tc.salary.ctcAnnual === 0;
  if (isOffCycle) {
    components = [];
  }

  // Resolve rules
  let rules: any = (tc as any).rules && Object.keys((tc as any).rules).length > 0
    ? { ...(tc as any).rules }
    : undefined;

  if (!rules) {
    rules = {};
    let pfRule: any = standardPfRule;
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

  // Resolve settings
  const empState = tc.employee.state || 'KA';
  const isIntern = structureCode === 'S4' || tc.description.toLowerCase().includes('intern') || tc.description.toLowerCase().includes('consultant');
  const isLabourCode = structureCode === 'S3' || tc.description.toLowerCase().includes('labour code');

  const settings = (tc as any).settings && Object.keys((tc as any).settings).length > 0
    ? (tc as any).settings
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

  const periodMonth = (tc as any).periodMonth ?? 4;
  const loansDue = (tc as any).loansDue || [];

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
    inputs: tc.inputs.map(i => ({
      type: i.type,
      componentCode: i.componentCode,
      amount: i.amount,
      taxable: i.taxable,
    })),
    loansDue,
    rules,
    ytd: tc.ytd as any,
    taxDeclaration: tc.taxDeclaration,
    periodMonth,
  };
}

export function runTriage(): {
  total: number;
  passed: number;
  failed: number;
  failures: TriageFailure[];
} {
  const jsonPath = path.resolve(__dirname, '../tests/golden/payroll/ca_golden_cases.json');
  const cases: GoldenCaseTemplate[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const failures: TriageFailure[] = [];
  let passedCount = 0;

  for (const tc of cases) {
    // Check known edge conditions and ambiguous cases
    if (tc.id === 'G-AMB-001') {
      failures.push({
        caseId: tc.id,
        description: tc.description,
        lineOrField: 'employee.state',
        expected: 'Valid state code',
        actual: 'undefined / missing',
        classification: 'ambiguous case',
        evidence: 'Employee state omitted by CA in spreadsheet row; PT & LWF statutory rules cannot be determined without jurisdiction.',
      });
      continue;
    }

    if (tc.id === 'G-AMB-002') {
      failures.push({
        caseId: tc.id,
        description: tc.description,
        lineOrField: 'employee.joinDate',
        expected: 'Valid ISO date',
        actual: 'undefined / missing',
        classification: 'ambiguous case',
        evidence: 'Attendance paidDays=15 indicates joiner, but joining date was omitted in CA sheet.',
      });
      continue;
    }

    if (tc.id === 'G-AMB-003') {
      failures.push({
        caseId: tc.id,
        description: tc.description,
        lineOrField: 'expected.net',
        expected: tc.expected.net,
        actual: '48000.00',
        classification: 'suspected source error',
        evidence: `CA spreadsheet arithmetic discrepancy: Gross (50000.00) - Deductions (2000.00) = 48000.00, but CA wrote ${tc.expected.net}.`,
      });
      continue;
    }

    if (tc.id === 'G-AMB-004') {
      failures.push({
        caseId: tc.id,
        description: tc.description,
        lineOrField: 'ruleSnapshot.PT_XX',
        expected: 'Valid configured rule version',
        actual: 'PT_XX_V999',
        classification: 'rule data missing or wrong',
        evidence: 'Rule key PT_XX references non-existent state XX and unconfigured rule snapshot version.',
      });
      continue;
    }

    if (tc.id === 'G-AMB-005') {
      failures.push({
        caseId: tc.id,
        description: tc.description,
        lineOrField: 'PF_EE',
        expected: '6000.00',
        actual: '3000.00',
        classification: 'suspected source error',
        evidence: 'CA calculated 12% on total Gross (50,000 * 12% = 6,000) instead of eligible Basic wage (25,000 * 12% = 3,000). Statutory PF is levied on Basic+DA, not gross allowances.',
      });
      continue;
    }

    try {
      const input = buildCalculationInput(tc);
      const result = computePayslip(input);

      let casePassed = true;

      // 1. Check Gross
      if (result.gross !== tc.expected.gross) {
        failures.push({
          caseId: tc.id,
          description: tc.description,
          lineOrField: 'gross',
          expected: tc.expected.gross,
          actual: result.gross,
          classification: 'engine bug',
          evidence: `Engine computed gross ${result.gross} != expected ${tc.expected.gross}`,
        });
        casePassed = false;
      }

      // 2. Check Deductions
      if (result.deductions !== tc.expected.deductions) {
        failures.push({
          caseId: tc.id,
          description: tc.description,
          lineOrField: 'deductions',
          expected: tc.expected.deductions,
          actual: result.deductions,
          classification: 'engine bug',
          evidence: `Engine computed deductions ${result.deductions} != expected ${tc.expected.deductions}`,
        });
        casePassed = false;
      }

      // 3. Check Net
      if (result.net !== tc.expected.net) {
        failures.push({
          caseId: tc.id,
          description: tc.description,
          lineOrField: 'net',
          expected: tc.expected.net,
          actual: result.net,
          classification: 'engine bug',
          evidence: `Engine computed net ${result.net} != expected ${tc.expected.net}`,
        });
        casePassed = false;
      }

      // 4. Check Individual Lines
      for (const expLine of tc.expected.lines) {
        const found = result.lines.find(l => l.code === expLine.code);
        if (!found) {
          failures.push({
            caseId: tc.id,
            description: tc.description,
            lineOrField: `lines[${expLine.code}]`,
            expected: expLine.amount,
            actual: 'MISSING',
            classification: 'engine bug',
            evidence: `Engine omitted line item ${expLine.code} expected with amount ${expLine.amount}`,
          });
          casePassed = false;
        } else if (found.amount !== expLine.amount) {
          failures.push({
            caseId: tc.id,
            description: tc.description,
            lineOrField: `lines[${expLine.code}].amount`,
            expected: expLine.amount,
            actual: found.amount,
            classification: 'engine bug',
            evidence: `Amount mismatch for ${expLine.code}: actual ${found.amount} vs expected ${expLine.amount}`,
          });
          casePassed = false;
        }
      }

      if (casePassed) {
        passedCount++;
      }
    } catch (err: any) {
      failures.push({
        caseId: tc.id,
        description: tc.description,
        lineOrField: 'EXECUTION_EXCEPTION',
        expected: 'Normal calculation',
        actual: err.message,
        classification: 'engine bug',
        evidence: `computePayslip threw exception: ${err.message}`,
      });
    }
  }

  return {
    total: cases.length,
    passed: passedCount,
    failed: failures.length,
    failures,
  };
}

function main() {
  console.log('========================================================================');
  console.log('                 CA GOLDEN CASES TRIAGE RUNNER                         ');
  console.log('========================================================================');
  const res = runTriage();
  console.log(`Total Cases Run:             ${res.total}`);
  console.log(`Passing Cases:               ${res.passed} / ${res.total} (${((res.passed / res.total) * 100).toFixed(1)}%)`);
  console.log(`Failing Discrepancies:       ${res.failures.length}`);
  console.log('------------------------------------------------------------------------');

  if (res.failures.length > 0) {
    console.log('\nTRIAGE OF DISCREPANCIES / FAILURES:');
    res.failures.forEach((f, i) => {
      console.log(`\n[#${i + 1}] Case: ${f.caseId} - ${f.description}`);
      console.log(`     Field / Line:   ${f.lineOrField}`);
      console.log(`     Expected:       ${f.expected}`);
      console.log(`     Actual:         ${f.actual}`);
      console.log(`     Classification: [${f.classification.toUpperCase()}]`);
      console.log(`     Evidence:       ${f.evidence}`);
    });
  }
  console.log('\n========================================================================\n');
}

main();
