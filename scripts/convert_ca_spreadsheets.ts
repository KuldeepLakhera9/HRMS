import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, '../tests/golden/source');
const targetDir = path.resolve(__dirname, '../tests/golden/payroll');
const casesDir = path.join(targetDir, 'cases');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}
if (!fs.existsSync(casesDir)) {
  fs.mkdirSync(casesDir, { recursive: true });
}

// Simple RFC 4180 CSV parser
function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        // Skip CR
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map(h => h.trim());
  const result: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === '') continue; // skip blank line
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      record[headers[c]] = row[c] !== undefined ? row[c] : '';
    }
    result.push(record);
  }

  return result;
}

export interface GoldenCaseTemplate {
  id: string;
  description: string;
  scenario?: string;
  ruleSnapshot: Record<string, string>;
  employee: {
    id?: string;
    empCode?: string;
    joinDate?: string;
    exitDate?: string;
    state?: string;
    regime?: 'new' | 'old';
    employmentType?: string;
    gender?: string;
    pan?: string;
  };
  salary: {
    ctcAnnual: string | number;
    structure: string;
    effectiveFrom?: string;
  };
  settings?: any;
  attendance: {
    calendarDays: number;
    paidDays: number;
    lopDays: number;
  };
  inputs: Array<{
    type: string;
    componentCode?: string;
    amount: string | number;
    taxable?: boolean;
  }>;
  loansDue?: any[];
  rules?: any;
  periodMonth?: number;
  ytd?: {
    gross: string | number;
    tdsDeducted: string | number;
    openingBalanceEarnings?: string | number;
    openingBalanceTds?: string | number;
  };
  taxDeclaration?: {
    regime: 'new' | 'old';
    verifiedDeductions?: Record<string, string | number>;
    remainingMonths: number;
    previousEmployerEarnings?: string | number;
    previousEmployerTds?: string | number;
  };
  expected: {
    lines: Array<{
      code: string;
      amount: string;
    }>;
    gross: string;
    deductions: string;
    reimbursements?: string;
    net: string;
    employerCost?: string;
    tds?: string;
  };
  notes: string;
}

function convertCsvRowToCase(row: Record<string, string>): GoldenCaseTemplate {
  // Parse JSON columns or fallback safely
  let ruleSnapshot: Record<string, string> = {};
  try {
    ruleSnapshot = JSON.parse(row.ruleSnapshot || '{}');
  } catch {
    ruleSnapshot = {};
  }

  let employee: any = {};
  try {
    employee = JSON.parse(row.employee || '{}');
  } catch {
    employee = {};
  }

  let salary: any = {};
  try {
    salary = JSON.parse(row.salary || '{}');
  } catch {
    salary = { ctcAnnual: '0.00', structure: 'S1' };
  }

  let attendance: any = {};
  try {
    attendance = JSON.parse(row.attendance || '{}');
  } catch {
    attendance = { calendarDays: 30, paidDays: 30, lopDays: 0 };
  }

  let inputs: any[] = [];
  try {
    inputs = JSON.parse(row.inputs || '[]');
  } catch {
    inputs = [];
  }

  let ytd: any = undefined;
  if (row.ytd && row.ytd.trim() !== '') {
    try {
      ytd = JSON.parse(row.ytd);
    } catch {
      ytd = undefined;
    }
  }

  let taxDeclaration: any = undefined;
  if (row.taxDeclaration && row.taxDeclaration.trim() !== '') {
    try {
      taxDeclaration = JSON.parse(row.taxDeclaration);
    } catch {
      taxDeclaration = undefined;
    }
  }

  let lines: Array<{ code: string; amount: string }> = [];
  try {
    lines = JSON.parse(row.expected_lines || '[]');
  } catch {
    lines = [];
  }

  // Preserve every number as provided (strings with 2 decimals). Do NOT recompute, round, correct or "fix" any value.
  const expected: GoldenCaseTemplate['expected'] = {
    lines: lines.map(l => ({
      code: l.code,
      amount: String(l.amount), // EXACT as provided
    })),
    gross: String(row.expected_gross || '0.00'),
    deductions: String(row.expected_deductions || '0.00'),
    reimbursements: String(row.expected_reimbursements || '0.00'),
    net: String(row.expected_net || '0.00'),
    employerCost: row.expected_employerCost ? String(row.expected_employerCost) : undefined,
    tds: row.expected_tds ? String(row.expected_tds) : undefined,
  };

  let settings: any = undefined;
  if (row.settings && row.settings.trim() !== '') {
    try {
      settings = JSON.parse(row.settings);
    } catch {
      settings = undefined;
    }
  }

  let loansDue: any = [];
  if (row.loansDue && row.loansDue.trim() !== '') {
    try {
      loansDue = JSON.parse(row.loansDue);
    } catch {
      loansDue = [];
    }
  }

  let rules: any = undefined;
  if (row.rules && row.rules.trim() !== '') {
    try {
      rules = JSON.parse(row.rules);
    } catch {
      rules = undefined;
    }
  }

  const periodMonth = row.periodMonth ? Number(row.periodMonth) : undefined;

  return {
    id: row.id,
    description: row.description,
    scenario: row.scenario || undefined,
    ruleSnapshot,
    employee,
    salary,
    settings,
    attendance,
    inputs,
    loansDue,
    rules,
    ytd,
    taxDeclaration,
    periodMonth,
    expected,
    notes: row.notes || '',
  };
}

function runConversion() {
  const sourceFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.csv') || f.endsWith('.tsv'));
  console.log(`Found ${sourceFiles.length} spreadsheet files in ${sourceDir}`);

  const allCases: GoldenCaseTemplate[] = [];

  for (const file of sourceFiles) {
    const fullPath = path.join(sourceDir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const rows = parseCsv(content);
    console.log(`Parsed ${rows.length} rows from ${file}`);

    for (const row of rows) {
      if (!row.id) continue;
      const goldenCase = convertCsvRowToCase(row);
      allCases.push(goldenCase);

      // Save individual case JSON in tests/golden/payroll/cases/<id>.json
      const individualPath = path.join(casesDir, `${goldenCase.id}.json`);
      fs.writeFileSync(individualPath, JSON.stringify(goldenCase, null, 2), 'utf-8');
    }
  }

  // Save the master cases array to tests/golden/payroll/ca_golden_cases.json
  const masterPath = path.join(targetDir, 'ca_golden_cases.json');
  fs.writeFileSync(masterPath, JSON.stringify(allCases, null, 2), 'utf-8');
  console.log(`Successfully converted ${allCases.length} golden cases to ${masterPath} and ${casesDir}/.`);
}

runConversion();
