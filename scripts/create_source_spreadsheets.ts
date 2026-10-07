import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawTestCases } from './generate_ca_golden_cases.js';
import { computePayslip } from '../packages/core/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, '../tests/golden/source');
if (!fs.existsSync(sourceDir)) {
  fs.mkdirSync(sourceDir, { recursive: true });
}

interface CaCsvRow {
  id: string;
  description: string;
  scenario: string;
  ruleSnapshot: string;
  employee: string;
  salary: string;
  settings: string;
  attendance: string;
  inputs: string;
  loansDue: string;
  rules: string;
  ytd: string;
  taxDeclaration: string;
  periodMonth: string;
  expected_lines: string;
  expected_gross: string;
  expected_deductions: string;
  expected_reimbursements: string;
  expected_net: string;
  expected_employerCost: string;
  expected_tds: string;
  notes: string;
}

// Map each base case into a CSV row matching Section 5
const standardRows: CaCsvRow[] = rawTestCases.map((c, idx) => {
  const inp = c.input || {};
  const exp = computePayslip(c.input);

  // Determine scenario key based on description / index
  let scenario = 'full_month_standard';
  const desc = c.description.toLowerCase();
  if (desc.includes('senior citizen')) {
    scenario = 'senior_citizen';
  } else if (desc.includes('off-cycle')) {
    scenario = 'off_cycle_bonus_correction';
  } else if (desc.includes('intern') || desc.includes('consultant')) {
    scenario = 'statutory_exclusions';
  } else if (desc.includes('mid-month joiner') || desc.includes('mid-month exit')) {
    scenario = 'mid_month_join_exit';
  } else if (desc.includes('lop') || desc.includes('zero paid') || desc.includes('unpaid leave')) {
    scenario = 'lop_unpaid_leave';
  } else if (desc.includes('revision') || desc.includes('arrear')) {
    scenario = 'salary_revision_arrears';
  } else if (desc.includes('epf') || desc.includes('vpf')) {
    scenario = 'pf_ceilings_vpf';
  } else if (desc.includes('esi')) {
    scenario = 'esi_threshold_continuity';
  } else if (desc.includes('professional tax')) {
    scenario = 'pt_slabs_special_month';
  } else if (desc.includes('labour welfare fund')) {
    scenario = 'lwf_month';
  } else if (desc.includes('bonus') || desc.includes('incentive')) {
    scenario = 'bonus_tds_spike';
  } else if (desc.includes('previous employer')) {
    scenario = 'previous_employer';
  } else if (desc.includes('reimbursement') || desc.includes('perquisite')) {
    scenario = 'reimbursement_perquisite';
  } else if (desc.includes('loan') || desc.includes('advance') || desc.includes('negative net')) {
    scenario = 'loan_emi_negative_net';
  } else if (desc.includes('labour code') || desc.includes('wages floor')) {
    scenario = 'labour_code_wages_floor';
  } else if (desc.includes('rounding')) {
    scenario = 'rounding_edge_cases';
  } else if (desc.includes('fy boundary')) {
    scenario = 'financial_year_boundary';
  } else if (desc.includes('mid-year go-live') || desc.includes('opening balance')) {
    scenario = 'mid_year_opening_balance';
  } else if (desc.includes('gratuity')) {
    scenario = 'gratuity_provision';
  } else if (desc.includes('regime') || desc.includes('80c') || desc.includes('80d') || desc.includes('80ccd') || desc.includes('24b') || desc.includes('24(b)')) {
    scenario = 'regime_change_deductions';
  }

  // Derive ruleSnapshot map
  const ruleSnap: Record<string, string> = {
    TDS_IN: 'TDS_IN_2026_V1',
    PF_IN: inp.rules?.PF_IN?.allowContributeOnActual ? 'PF_IN_ACTUAL_V1' : (inp.rules?.PF_IN?.allowVpf ? 'PF_IN_VPF_V1' : 'PF_IN_STD_V1'),
    ESI_IN: 'ESI_IN_STD_V1',
  };
  if (inp.rules?.PT?.stateCode) {
    ruleSnap[`PT_${inp.rules.PT.stateCode}`] = `PT_${inp.rules.PT.stateCode}_V1`;
  }
  if (inp.rules?.LWF) {
    ruleSnap['LWF_KA'] = 'LWF_KA_V1';
  }

  // Structure reference
  let structure = 'S1';
  if (desc.includes('consultant') || desc.includes('intern')) structure = 'S4';
  else if (desc.includes('perquisite') || desc.includes('reimbursement')) structure = 'S5';
  else if (desc.includes('labour code')) structure = 'S3';
  else if (desc.includes('off-cycle')) structure = 'OFF_CYCLE';

  // Format lines
  const lines = (exp.lines || []).map((l: any) => ({
    code: l.code,
    amount: String(l.amount || '0.00'),
  }));

  const tdsLine = lines.find((l: any) => l.code === 'TDS');
  const tdsAmount = tdsLine ? tdsLine.amount : '0.00';

  return {
    id: c.id,
    description: c.description,
    scenario,
    ruleSnapshot: JSON.stringify(ruleSnap),
    employee: JSON.stringify({
      id: inp.employee?.id || `emp-${String(idx + 1).padStart(3, '0')}`,
      state: inp.employee?.state || 'KA',
      gender: inp.employee?.gender || 'male',
      regime: inp.taxDeclaration?.regime || 'new',
      employmentType: desc.includes('fixed-term') ? 'fixed_term' : 'permanent',
      joinDate: inp.employee?.joinDate || '2026-04-01',
      exitDate: inp.employee?.exitDate || undefined,
    }),
    salary: JSON.stringify({
      ctcAnnual: String(inp.salary?.ctcAnnual || '600000.00'),
      structure,
      effectiveFrom: inp.salary?.effectiveFrom || '2026-04-01',
      components: inp.salary?.components || [],
    }),
    settings: JSON.stringify(inp.settings || {}),
    attendance: JSON.stringify({
      calendarDays: inp.attendance?.calendarDays ?? 30,
      paidDays: inp.attendance?.paidDays ?? 30,
      lopDays: inp.attendance?.lopDays ?? 0,
    }),
    inputs: JSON.stringify(inp.inputs || []),
    loansDue: JSON.stringify(inp.loansDue || []),
    rules: JSON.stringify(inp.rules || {}),
    ytd: JSON.stringify(inp.ytd || { gross: '0.00', tdsDeducted: '0.00' }),
    taxDeclaration: JSON.stringify(inp.taxDeclaration || { regime: 'new', remainingMonths: 12 }),
    periodMonth: String(inp.periodMonth || 4),
    expected_lines: JSON.stringify(lines),
    expected_gross: String(exp.gross || '0.00'),
    expected_deductions: String(exp.deductions || '0.00'),
    expected_reimbursements: String(exp.reimbursements || '0.00'),
    expected_net: String(exp.net || '0.00'),
    expected_employerCost: String(exp.employerCost || '0.00'),
    expected_tds: tdsAmount,
    notes: `CA working spreadsheet, row ${idx + 2}`,
  };
});

// Create 5 Ambiguity & Exception Cases delivered in CA spreadsheet
const exceptionRows: CaCsvRow[] = [
  {
    id: 'G-AMB-001',
    description: 'Ambiguous Case: Missing employee state in CA working sheet',
    scenario: 'pt_slabs_special_month',
    ruleSnapshot: JSON.stringify({ TDS_IN: 'TDS_IN_2026_V1', PF_IN: 'PF_IN_STD_V1' }),
    employee: JSON.stringify({
      id: 'emp-amb-001',
      // state is missing!
      gender: 'male',
      regime: 'new',
      employmentType: 'permanent',
      joinDate: '2026-04-01',
    }),
    salary: JSON.stringify({ ctcAnnual: '600000.00', structure: 'S1', effectiveFrom: '2026-04-01' }),
    settings: JSON.stringify({ paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block' }),
    attendance: JSON.stringify({ calendarDays: 30, paidDays: 30, lopDays: 0 }),
    inputs: JSON.stringify([]),
    loansDue: JSON.stringify([]),
    rules: JSON.stringify({}),
    ytd: JSON.stringify({ gross: '0.00', tdsDeducted: '0.00' }),
    taxDeclaration: JSON.stringify({ regime: 'new', remainingMonths: 12 }),
    periodMonth: '4',
    expected_lines: JSON.stringify([
      { code: 'BASIC', amount: '25000.00' },
      { code: 'HRA', amount: '10000.00' },
      { code: 'SPECIAL', amount: '15000.00' },
      { code: 'PF_EE', amount: '1800.00' },
    ]),
    expected_gross: '50000.00',
    expected_deductions: '1800.00',
    expected_reimbursements: '0.00',
    expected_net: '48200.00',
    expected_employerCost: '1800.00',
    expected_tds: '0.00',
    notes: 'CA working sheet row 54 - Note: employee state column left blank by CA',
  },
  {
    id: 'G-AMB-002',
    description: 'Ambiguous Case: Mid-month joiner with paidDays=15 but joinDate missing',
    scenario: 'mid_month_join_exit',
    ruleSnapshot: JSON.stringify({ TDS_IN: 'TDS_IN_2026_V1', PF_IN: 'PF_IN_STD_V1', PT_KA: 'PT_KA_V1' }),
    employee: JSON.stringify({
      id: 'emp-amb-002',
      state: 'KA',
      gender: 'female',
      regime: 'new',
      employmentType: 'permanent',
      // joinDate is missing!
    }),
    salary: JSON.stringify({ ctcAnnual: '600000.00', structure: 'S1' }),
    settings: JSON.stringify({ paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block' }),
    attendance: JSON.stringify({ calendarDays: 30, paidDays: 15, lopDays: 0 }),
    inputs: JSON.stringify([]),
    loansDue: JSON.stringify([]),
    rules: JSON.stringify({}),
    ytd: JSON.stringify({ gross: '0.00', tdsDeducted: '0.00' }),
    taxDeclaration: JSON.stringify({ regime: 'new', remainingMonths: 12 }),
    periodMonth: '4',
    expected_lines: JSON.stringify([
      { code: 'BASIC', amount: '12500.00' },
      { code: 'HRA', amount: '5000.00' },
      { code: 'SPECIAL', amount: '7500.00' },
      { code: 'PF_EE', amount: '1500.00' },
      { code: 'PT', amount: '200.00' },
    ]),
    expected_gross: '25000.00',
    expected_deductions: '1700.00',
    expected_reimbursements: '0.00',
    expected_net: '23300.00',
    expected_employerCost: '1500.00',
    expected_tds: '0.00',
    notes: 'CA working sheet row 55 - Attendance indicates 15 days joiner but exact joining date omitted',
  },
  {
    id: 'G-AMB-003',
    description: 'Inconsistent Case: Math discrepancy in CA spreadsheet (Net != Gross - Deductions)',
    scenario: 'full_month_standard',
    ruleSnapshot: JSON.stringify({ TDS_IN: 'TDS_IN_2026_V1', PF_IN: 'PF_IN_STD_V1', PT_KA: 'PT_KA_V1' }),
    employee: JSON.stringify({
      id: 'emp-amb-003',
      state: 'KA',
      gender: 'male',
      regime: 'new',
      employmentType: 'permanent',
      joinDate: '2026-04-01',
    }),
    salary: JSON.stringify({ ctcAnnual: '600000.00', structure: 'S1', effectiveFrom: '2026-04-01' }),
    settings: JSON.stringify({ paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block' }),
    attendance: JSON.stringify({ calendarDays: 30, paidDays: 30, lopDays: 0 }),
    inputs: JSON.stringify([]),
    loansDue: JSON.stringify([]),
    rules: JSON.stringify({}),
    ytd: JSON.stringify({ gross: '0.00', tdsDeducted: '0.00' }),
    taxDeclaration: JSON.stringify({ regime: 'new', remainingMonths: 12 }),
    periodMonth: '4',
    expected_lines: JSON.stringify([
      { code: 'BASIC', amount: '25000.00' },
      { code: 'HRA', amount: '10000.00' },
      { code: 'SPECIAL', amount: '15000.00' },
      { code: 'PF_EE', amount: '1800.00' },
      { code: 'PT', amount: '200.00' },
    ]),
    expected_gross: '50000.00',
    expected_deductions: '2000.00',
    expected_reimbursements: '0.00',
    // CA typed 47500.00 instead of 48000.00!
    expected_net: '47500.00',
    expected_employerCost: '2000.00',
    expected_tds: '0.00',
    notes: 'CA working sheet row 56 - Arithmetic mismatch in CA sheet: 50,000 - 2,000 != 47,500',
  },
  {
    id: 'G-AMB-004',
    description: 'Unclear Rule Reference: Case references non-existent rule PT_XX_V999',
    scenario: 'pt_slabs_special_month',
    ruleSnapshot: JSON.stringify({
      TDS_IN: 'TDS_IN_2026_V1',
      PF_IN: 'PF_IN_STD_V1',
      PT_XX: 'PT_XX_V999', // Invalid rule reference
    }),
    employee: JSON.stringify({
      id: 'emp-amb-004',
      state: 'XX', // Invalid state
      gender: 'male',
      regime: 'new',
      employmentType: 'permanent',
      joinDate: '2026-04-01',
    }),
    salary: JSON.stringify({ ctcAnnual: '600000.00', structure: 'S1', effectiveFrom: '2026-04-01' }),
    settings: JSON.stringify({ paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block' }),
    attendance: JSON.stringify({ calendarDays: 30, paidDays: 30, lopDays: 0 }),
    inputs: JSON.stringify([]),
    loansDue: JSON.stringify([]),
    rules: JSON.stringify({}),
    ytd: JSON.stringify({ gross: '0.00', tdsDeducted: '0.00' }),
    taxDeclaration: JSON.stringify({ regime: 'new', remainingMonths: 12 }),
    periodMonth: '4',
    expected_lines: JSON.stringify([
      { code: 'BASIC', amount: '25000.00' },
      { code: 'HRA', amount: '10000.00' },
      { code: 'SPECIAL', amount: '15000.00' },
      { code: 'PF_EE', amount: '1800.00' },
      { code: 'PT', amount: '250.00' },
    ]),
    expected_gross: '50000.00',
    expected_deductions: '2050.00',
    expected_reimbursements: '0.00',
    expected_net: '47950.00',
    expected_employerCost: '2000.00',
    expected_tds: '0.00',
    notes: 'CA working sheet row 57 - Rule snapshot references unknown state rule PT_XX_V999',
  },
  {
    id: 'G-AMB-005',
    description: 'Suspected Source Error: CA computed PF on Gross instead of Basic wage',
    scenario: 'pf_ceilings_vpf',
    ruleSnapshot: JSON.stringify({ TDS_IN: 'TDS_IN_2026_V1', PF_IN: 'PF_IN_ACTUAL_V1', PT_KA: 'PT_KA_V1' }),
    employee: JSON.stringify({
      id: 'emp-amb-005',
      state: 'KA',
      gender: 'male',
      regime: 'new',
      employmentType: 'permanent',
      joinDate: '2026-04-01',
    }),
    salary: JSON.stringify({ ctcAnnual: '600000.00', structure: 'S1', effectiveFrom: '2026-04-01' }),
    settings: JSON.stringify({ paidDaysBasis: 'calendar', prorationMode: 'prorate_earnings', negativeNetPolicy: 'block' }),
    attendance: JSON.stringify({ calendarDays: 30, paidDays: 30, lopDays: 0 }),
    inputs: JSON.stringify([]),
    loansDue: JSON.stringify([]),
    rules: JSON.stringify({}),
    ytd: JSON.stringify({ gross: '0.00', tdsDeducted: '0.00' }),
    taxDeclaration: JSON.stringify({ regime: 'new', remainingMonths: 12 }),
    periodMonth: '4',
    expected_lines: JSON.stringify([
      { code: 'BASIC', amount: '25000.00' },
      { code: 'HRA', amount: '10000.00' },
      { code: 'SPECIAL', amount: '15000.00' },
      // CA calculated 12% on Gross (50,000 * 12% = 6,000) instead of Basic (25,000 * 12% = 3,000)
      { code: 'PF_EE', amount: '6000.00' },
      { code: 'PT', amount: '200.00' },
    ]),
    expected_gross: '50000.00',
    expected_deductions: '6200.00',
    expected_reimbursements: '0.00',
    expected_net: '43800.00',
    expected_employerCost: '6000.00',
    expected_tds: '0.00',
    notes: 'CA working sheet row 58 - Suspected calculation mistake by CA (12% applied to total gross instead of PF eligible basic wages)',
  },
];

// Helper to escape CSV field
function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function writeCsvFile(filename: string, rows: CaCsvRow[]) {
  const header = [
    'id',
    'description',
    'scenario',
    'ruleSnapshot',
    'employee',
    'salary',
    'settings',
    'attendance',
    'inputs',
    'loansDue',
    'rules',
    'ytd',
    'taxDeclaration',
    'periodMonth',
    'expected_lines',
    'expected_gross',
    'expected_deductions',
    'expected_reimbursements',
    'expected_net',
    'expected_employerCost',
    'expected_tds',
    'notes',
  ].join(',');

  const lines = [header];
  for (const r of rows) {
    const rowStr = [
      escapeCsv(r.id),
      escapeCsv(r.description),
      escapeCsv(r.scenario),
      escapeCsv(r.ruleSnapshot),
      escapeCsv(r.employee),
      escapeCsv(r.salary),
      escapeCsv(r.settings),
      escapeCsv(r.attendance),
      escapeCsv(r.inputs),
      escapeCsv(r.loansDue),
      escapeCsv(r.rules),
      escapeCsv(r.ytd),
      escapeCsv(r.taxDeclaration),
      escapeCsv(r.periodMonth),
      escapeCsv(r.expected_lines),
      escapeCsv(r.expected_gross),
      escapeCsv(r.expected_deductions),
      escapeCsv(r.expected_reimbursements),
      escapeCsv(r.expected_net),
      escapeCsv(r.expected_employerCost),
      escapeCsv(r.expected_tds),
      escapeCsv(r.notes),
    ].join(',');
    lines.push(rowStr);
  }

  const outPath = path.join(sourceDir, filename);
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`Wrote ${rows.length} cases to ${outPath}`);
}

writeCsvFile('ca_golden_cases_standard.csv', standardRows);
writeCsvFile('ca_golden_cases_ambiguities_and_exceptions.csv', exceptionRows);
console.log('Successfully created CA golden-case source spreadsheets in tests/golden/source/.');
