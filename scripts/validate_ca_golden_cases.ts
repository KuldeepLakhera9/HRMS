import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Decimal } from 'decimal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Zod Schema matching CA_VALIDATION_KIT.md Section 5
const decimalStringRegex = /^-?\d+(\.\d{2})$/;

export const caGoldenCaseSchema = z.object({
  id: z.string().min(1, 'Case ID is required'),
  description: z.string().min(1, 'Description is required'),
  scenario: z.string().optional(),
  ruleSnapshot: z.record(z.string()),
  employee: z.object({
    id: z.string().optional(),
    empCode: z.string().optional(),
    joinDate: z.string().optional(),
    exitDate: z.string().optional(),
    state: z.string().optional(),
    regime: z.enum(['new', 'old']).optional(),
    employmentType: z.string().optional(),
    gender: z.string().optional(),
    pan: z.string().optional(),
  }),
  salary: z.object({
    ctcAnnual: z.union([z.number(), z.string()]),
    structure: z.string(),
    effectiveFrom: z.string().optional(),
  }),
  attendance: z.object({
    calendarDays: z.number(),
    paidDays: z.number(),
    lopDays: z.number(),
  }),
  inputs: z.array(
    z.object({
      type: z.string(),
      componentCode: z.string().optional(),
      amount: z.union([z.number(), z.string()]),
      taxable: z.boolean().optional(),
    })
  ),
  ytd: z
    .object({
      gross: z.union([z.number(), z.string()]).optional(),
      tdsDeducted: z.union([z.number(), z.string()]).optional(),
      openingBalanceEarnings: z.union([z.number(), z.string()]).optional(),
      openingBalanceTds: z.union([z.number(), z.string()]).optional(),
    })
    .optional(),
  taxDeclaration: z
    .object({
      regime: z.enum(['new', 'old']),
      verifiedDeductions: z.record(z.union([z.string(), z.number()])).optional(),
      remainingMonths: z.number(),
      previousEmployerEarnings: z.union([z.string(), z.number()]).optional(),
      previousEmployerTds: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  expected: z.object({
    lines: z.array(
      z.object({
        code: z.string(),
        amount: z.string().regex(decimalStringRegex, 'Line amount must be string with exactly 2 decimal places'),
      })
    ),
    gross: z.string().regex(decimalStringRegex, 'Gross must be string with exactly 2 decimal places'),
    deductions: z.string().regex(decimalStringRegex, 'Deductions must be string with exactly 2 decimal places'),
    reimbursements: z
      .string()
      .regex(decimalStringRegex, 'Reimbursements must be string with exactly 2 decimal places')
      .optional(),
    net: z.string().regex(decimalStringRegex, 'Net must be string with exactly 2 decimal places'),
    employerCost: z
      .string()
      .regex(decimalStringRegex, 'EmployerCost must be string with exactly 2 decimal places')
      .optional(),
    tds: z
      .string()
      .regex(decimalStringRegex, 'TDS must be string with exactly 2 decimal places')
      .optional(),
  }),
  notes: z.string(),
});

// 2. Required Scenarios from CA_VALIDATION_KIT.md Section 5
export const REQUIRED_SCENARIOS = [
  { key: 'full_month_standard', label: 'Full month, standard structure, each regime' },
  { key: 'mid_month_join_exit', label: 'Mid-month joiner and mid-month exit' },
  { key: 'lop_unpaid_leave', label: 'LOP days (various counts), zero paid days, unpaid leave across month end' },
  { key: 'salary_revision_arrears', label: 'Salary revision effective mid-month; revision with arrears for previous months' },
  { key: 'pf_ceilings_vpf', label: 'PF: wage below, at and above the ceiling; contribute-on-actual option; VPF' },
  { key: 'esi_threshold_continuity', label: 'ESI: below threshold, crossing threshold mid-period, continuity within contribution period' },
  { key: 'pt_slabs_special_month', label: 'Professional Tax: normal month, special month, women/men differences, each state in use' },
  { key: 'lwf_month', label: 'Labour Welfare Fund month' },
  { key: 'bonus_tds_spike', label: 'Bonus month with TDS spike; one-time incentive; arrears payout' },
  { key: 'regime_change_deductions', label: 'Regime change at declaration; declared deductions verified vs unverified' },
  { key: 'previous_employer', label: 'Previous employer income and tax deducted' },
  { key: 'reimbursement_perquisite', label: 'Reimbursement (non-taxable) and taxable perquisite' },
  { key: 'loan_emi_negative_net', label: 'Loan EMI recovery; advance recovery limit; negative net situation' },
  { key: 'labour_code_wages_floor', label: 'Labour Code wages floor: structure below 50% (add-back) and above' },
  { key: 'rounding_edge_cases', label: 'Rounding edge cases (half paise, per-component rounding)' },
  { key: 'financial_year_boundary', label: 'Financial-year boundary (March to April under the new Act, YTD reset)' },
  { key: 'mid_year_opening_balance', label: 'Mid-year go-live with opening balances (YTD import) and TDS projection' },
  { key: 'gratuity_provision', label: 'Gratuity provision for permanent and fixed-term employee' },
  { key: 'off_cycle_bonus_correction', label: 'Off-cycle bonus run; correction run after an error' },
  { key: 'senior_citizen', label: 'Senior citizen/other age-based rules if employees are affected' },
  { key: 'statutory_exclusions', label: 'Employees excluded from PF/ESI by policy; international worker or non-resident' },
];

// 3. Recognized Rule Catalog Keys
const VALID_RULE_FAMILIES = [
  'TDS_IN',
  'PF_IN',
  'ESI_IN',
  'PT_KA',
  'PT_MH',
  'PT_TG',
  'PT_DL',
  'PT_TN',
  'PT_WB',
  'PT_GJ',
  'PT_AP',
  'PT_KL',
  'LWF_KA',
  'LWF_MH',
  'LWF_TG',
  'GRATUITY_IN',
  'LABOUR_CODE_WAGES',
  'BONUS_IN',
  'FORM_LABELS',
];

export interface ValidationReport {
  totalCases: number;
  schemaValidCount: number;
  schemaErrors: Array<{ caseId: string; errors: string[] }>;
  ruleSnapshotErrors: Array<{ caseId: string; invalidKeys: string[] }>;
  scenarioCoverage: {
    covered: Array<{ key: string; label: string; count: number }>;
    missing: Array<{ key: string; label: string }>;
  };
  ambiguities: Array<{
    caseId: string;
    type: 'missing_input' | 'inconsistent_totals' | 'unclear_rule_reference';
    description: string;
    questionForCa: string;
  }>;
}

export function validateCases(cases: any[]): ValidationReport {
  const schemaErrors: Array<{ caseId: string; errors: string[] }> = [];
  const ruleSnapshotErrors: Array<{ caseId: string; invalidKeys: string[] }> = [];
  const ambiguities: ValidationReport['ambiguities'] = [];
  const scenarioCounts = new Map<string, number>();

  let schemaValidCount = 0;

  for (const c of cases) {
    const caseId = c.id || 'UNKNOWN';

    // 1. Zod Schema Check
    const parseRes = caGoldenCaseSchema.safeParse(c);
    if (!parseRes.success) {
      const issues = parseRes.error.issues || (parseRes.error as any).errors || [];
      const errMsgs = issues.map((e: any) => `${e.path.join('.')}: ${e.message}`);
      schemaErrors.push({ caseId, errors: errMsgs });
    } else {
      schemaValidCount++;
    }

    // 2. Rule Snapshot Check
    if (c.ruleSnapshot && typeof c.ruleSnapshot === 'object') {
      const invalidKeys = Object.keys(c.ruleSnapshot).filter(k => !VALID_RULE_FAMILIES.includes(k));
      if (invalidKeys.length > 0) {
        ruleSnapshotErrors.push({ caseId, invalidKeys });
        ambiguities.push({
          caseId,
          type: 'unclear_rule_reference',
          description: `Rule snapshot references unrecognized or unversioned rule family: [${invalidKeys.join(', ')}]`,
          questionForCa: `Case ${caseId} references rule key(s) '${invalidKeys.join(', ')}' which do not match configured rule catalog keys. Please confirm the applicable statutory rule set and effective version.`,
        });
      }
    }

    // 3. Scenario Coverage Tracking
    if (c.scenario) {
      scenarioCounts.set(c.scenario, (scenarioCounts.get(c.scenario) || 0) + 1);
    }

    // 4. Ambiguity / Integrity Checks (Missing Inputs, Inconsistent Totals)
    // Check 4a: Missing Employee State
    if (!c.employee?.state) {
      ambiguities.push({
        caseId,
        type: 'missing_input',
        description: 'Employee state code is missing, preventing Professional Tax and Labour Welfare Fund determination.',
        questionForCa: `In Case ${caseId} (${c.description}), employee state is omitted. Which state PT and LWF rules should be applied for this employee?`,
      });
    }

    // Check 4b: Mid-month Joiner missing joinDate
    if (
      c.attendance?.paidDays !== undefined &&
      c.attendance?.calendarDays !== undefined &&
      c.attendance.paidDays < c.attendance.calendarDays &&
      (c.attendance.lopDays === 0 || c.attendance.lopDays === undefined) &&
      !c.employee?.joinDate &&
      !c.employee?.exitDate
    ) {
      ambiguities.push({
        caseId,
        type: 'missing_input',
        description: `Prorated attendance (${c.attendance.paidDays}/${c.attendance.calendarDays} paid days) without joinDate or exitDate.`,
        questionForCa: `In Case ${caseId}, attendance indicates proration (${c.attendance.paidDays} paid days), but employee joining date or exit date is missing. Please supply the exact date of joining/exit to verify effective dating.`,
      });
    }

    // Check 4c: Inconsistent Totals (Math mismatch in CA spreadsheet)
    if (c.expected) {
      const expGross = new Decimal(c.expected.gross || '0');
      const expDed = new Decimal(c.expected.deductions || '0');
      const expReimb = new Decimal(c.expected.reimbursements || '0');
      const expNet = new Decimal(c.expected.net || '0');

      const computedNet = expGross.minus(expDed).plus(expReimb);
      if (!computedNet.equals(expNet)) {
        ambiguities.push({
          caseId,
          type: 'inconsistent_totals',
          description: `Mathematical mismatch in CA spreadsheet: Expected Net (${expNet.toFixed(2)}) != Gross (${expGross.toFixed(2)}) - Deductions (${expDed.toFixed(2)}) + Reimbursements (${expReimb.toFixed(2)}) = ${computedNet.toFixed(2)}`,
          questionForCa: `In Case ${caseId}, the spreadsheet specifies Gross=${expGross.toFixed(2)}, Deductions=${expDed.toFixed(2)}, Reimbursements=${expReimb.toFixed(2)}, but expected Net=${expNet.toFixed(2)} (diff of ${expNet.minus(computedNet).toFixed(2)}). Please clarify the intended net pay or explain any unaccounted adjustment.`,
        });
      }
    }
  }

  // Compile Scenario Coverage
  const covered: Array<{ key: string; label: string; count: number }> = [];
  const missing: Array<{ key: string; label: string }> = [];

  for (const req of REQUIRED_SCENARIOS) {
    const count = scenarioCounts.get(req.key) || 0;
    if (count > 0) {
      covered.push({ key: req.key, label: req.label, count });
    } else {
      missing.push({ key: req.key, label: req.label });
    }
  }

  return {
    totalCases: cases.length,
    schemaValidCount,
    schemaErrors,
    ruleSnapshotErrors,
    scenarioCoverage: { covered, missing },
    ambiguities,
  };
}

function main() {
  const jsonPath = path.resolve(__dirname, '../tests/golden/payroll/ca_golden_cases.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`Error: ca_golden_cases.json not found at ${jsonPath}`);
    process.exit(1);
  }

  const cases = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const report = validateCases(cases);

  console.log('========================================================================');
  console.log('          CA GOLDEN CASES VALIDATION & COVERAGE REPORT                  ');
  console.log('========================================================================');
  console.log(`Total Cases Evaluated:       ${report.totalCases}`);
  console.log(`Schema Conforming Cases:     ${report.schemaValidCount} / ${report.totalCases}`);
  console.log(`Schema Errors Found:         ${report.schemaErrors.length}`);
  console.log(`Rule Snapshot Errors:        ${report.ruleSnapshotErrors.length}`);
  console.log(`Ambiguities / Inconsistencies Detected: ${report.ambiguities.length}`);
  console.log('------------------------------------------------------------------------');

  console.log('\n[1] REQUIRED SCENARIO COVERAGE (docs/CA_VALIDATION_KIT.md Section 5):');
  console.log(`Covered Scenarios: ${report.scenarioCoverage.covered.length} / ${REQUIRED_SCENARIOS.length}`);
  report.scenarioCoverage.covered.forEach(s => {
    console.log(`  ✓ [${s.count.toString().padStart(2, ' ')} cases] ${s.key.padEnd(28, ' ')} : ${s.label}`);
  });

  if (report.scenarioCoverage.missing.length > 0) {
    console.log('\nMISSING SCENARIOS FROM CA VALIDATION KIT:');
    report.scenarioCoverage.missing.forEach(m => {
      console.log(`  ✗ [MISSING] ${m.key.padEnd(28, ' ')} : ${m.label}`);
    });
  } else {
    console.log('\nAll 21 required statutory scenarios from CA Validation Kit Section 5 are COVERED!');
  }

  if (report.ambiguities.length > 0) {
    console.log('\n------------------------------------------------------------------------');
    console.log('[2] IDENTIFIED AMBIGUITIES & QUESTIONS FOR THE CA:');
    report.ambiguities.forEach((amb, idx) => {
      console.log(`\n  Q${idx + 1}. [${amb.caseId}] (${amb.type})`);
      console.log(`      Issue:    ${amb.description}`);
      console.log(`      Question: ${amb.questionForCa}`);
    });
  }
  console.log('========================================================================\n');
}

main();
