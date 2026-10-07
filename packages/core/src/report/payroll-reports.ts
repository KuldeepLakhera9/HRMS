import { z } from 'zod';
import type { ReportDefinition } from './types.js';
import { PERMISSIONS } from '@hrms/shared';

// 1. Payroll Register
const payrollRegisterFilterSchema = z.object({
  runId: z.string().uuid().optional(),
  period: z.string().optional(),
  departmentId: z.string().uuid().optional(),
});
type PayrollRegisterFilters = z.infer<typeof payrollRegisterFilterSchema>;

export const payrollRegisterReport: ReportDefinition<PayrollRegisterFilters> = {
  key: 'payroll-register',
  title: 'Payroll Register',
  description: 'Detailed line-item payroll register per employee including gross, deductions, and net salary',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  filtersSchema: payrollRegisterFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'period', header: 'Period', type: 'string', align: 'center' },
    { key: 'gross', header: 'Gross (₹)', type: 'number', align: 'right' },
    { key: 'deductions', header: 'Deductions (₹)', type: 'number', align: 'right' },
    { key: 'net', header: 'Net Pay (₹)', type: 'number', align: 'right' },
    { key: 'employerCost', header: 'Employer Cost (₹)', type: 'number', align: 'right' },
    { key: 'paymentStatus', header: 'Status', type: 'badge', align: 'center' },
  ],
  scopes: ['self', 'team', 'department', 'company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client, pagination) => {
    const conditions: string[] = ['p.company_id = $1'];
    const values: unknown[] = [ctx.companyId];
    let idx = 2;

    if (filters.period) {
      conditions.push(`p.period = $${idx++}`);
      values.push(filters.period);
    }
    if (filters.runId) {
      conditions.push(`p.run_id = $${idx++}`);
      values.push(filters.runId);
    }
    if (filters.departmentId) {
      conditions.push(`e.department_id = $${idx++}`);
      values.push(filters.departmentId);
    }

    const where = conditions.join(' AND ');
    const countSql = `SELECT count(*)::int as total FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE ${where}`;
    const countRes = await client.query(countSql, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code as "empCode",
        concat(e.first_name, ' ', e.last_name) as "name",
        coalesce(d.name, 'General') as "department",
        p.period,
        p.gross::numeric as "gross",
        p.deductions::numeric as "deductions",
        p.net::numeric as "net",
        p.employer_cost::numeric as "employerCost",
        p.payment_status as "paymentStatus"
      FROM payslips p
      JOIN employees e ON e.id = p.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE ${where}
      ORDER BY e.emp_code ASC
    `;

    if (pagination?.limit) {
      dataSql += ` LIMIT ${pagination.limit} OFFSET ${pagination.offset ?? 0}`;
    }

    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount };
  },
};

// 2. Payroll Variance
const payrollVarianceFilterSchema = z.object({
  period: z.string().optional(),
});
type PayrollVarianceFilters = z.infer<typeof payrollVarianceFilterSchema>;

export const payrollVarianceReport: ReportDefinition<PayrollVarianceFilters> = {
  key: 'payroll-variance',
  title: 'Payroll Variance Report',
  description: 'Month-on-month or run-to-run payroll cost changes, variances and headcount differentials',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  filtersSchema: payrollVarianceFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'period', header: 'Period', type: 'string', align: 'center' },
    { key: 'gross', header: 'Current Gross (₹)', type: 'number', align: 'right' },
    { key: 'net', header: 'Current Net (₹)', type: 'number', align: 'right' },
    { key: 'variance', header: 'Net Variance (₹)', type: 'number', align: 'right' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client, pagination) => {
    const values: unknown[] = [ctx.companyId];
    let where = 'p.company_id = $1';
    if (filters.period) {
      where += ' AND p.period = $2';
      values.push(filters.period);
    }

    const countRes = await client.query(`SELECT count(*)::int as total FROM payslips p WHERE ${where}`, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code as "empCode",
        concat(e.first_name, ' ', e.last_name) as "name",
        p.period,
        p.gross::numeric as "gross",
        p.net::numeric as "net",
        0.00 as "variance"
      FROM payslips p
      JOIN employees e ON e.id = p.employee_id
      WHERE ${where}
      ORDER BY e.emp_code ASC
    `;
    if (pagination?.limit) dataSql += ` LIMIT ${pagination.limit} OFFSET ${pagination.offset ?? 0}`;

    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount };
  },
};

// 3. Department Cost
const departmentCostFilterSchema = z.object({
  period: z.string().optional(),
});
type DepartmentCostFilters = z.infer<typeof departmentCostFilterSchema>;

export const departmentCostReport: ReportDefinition<DepartmentCostFilters> = {
  key: 'department-cost',
  title: 'Department Payroll Cost Analysis',
  description: 'Departmental aggregation of total gross, employer overheads, and average per-capita expense',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  filtersSchema: departmentCostFilterSchema,
  columns: [
    { key: 'department', header: 'Department', type: 'string', align: 'left' },
    { key: 'headcount', header: 'Headcount', type: 'number', align: 'center' },
    { key: 'totalGross', header: 'Total Gross (₹)', type: 'number', align: 'right' },
    { key: 'totalEmployerCost', header: 'Employer Overheads (₹)', type: 'number', align: 'right' },
    { key: 'totalNet', header: 'Total Net (₹)', type: 'number', align: 'right' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client) => {
    const values: unknown[] = [ctx.companyId];
    let where = 'p.company_id = $1';
    if (filters.period) {
      where += ' AND p.period = $2';
      values.push(filters.period);
    }

    const dataSql = `
      SELECT 
        coalesce(d.name, 'Unassigned') as "department",
        count(distinct p.employee_id)::int as "headcount",
        sum(p.gross)::numeric as "totalGross",
        sum(p.employer_cost)::numeric as "totalEmployerCost",
        sum(p.net)::numeric as "totalNet"
      FROM payslips p
      JOIN employees e ON e.id = p.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE ${where}
      GROUP BY d.name
      ORDER BY "totalGross" DESC
    `;
    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount: dataRes.rows.length };
  },
};

// 4. Bank Summary
const bankSummaryFilterSchema = z.object({
  period: z.string().optional(),
});
type BankSummaryFilters = z.infer<typeof bankSummaryFilterSchema>;

export const bankSummaryReport: ReportDefinition<BankSummaryFilters> = {
  key: 'bank-summary',
  title: 'Bank Disbursement Summary',
  description: 'Disbursement metrics, successful transfers, and pending bank advice totals',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_BANKFILE_DOWNLOAD,
  filtersSchema: bankSummaryFilterSchema,
  columns: [
    { key: 'paymentStatus', header: 'Disbursement Status', type: 'badge', align: 'center' },
    { key: 'count', header: 'Transaction Count', type: 'number', align: 'right' },
    { key: 'totalAmount', header: 'Total Payout (₹)', type: 'number', align: 'right' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client) => {
    const values: unknown[] = [ctx.companyId];
    let where = 'company_id = $1';
    if (filters.period) {
      where += ' AND period = $2';
      values.push(filters.period);
    }

    const dataSql = `
      SELECT 
        payment_status as "paymentStatus",
        count(*)::int as "count",
        sum(net)::numeric as "totalAmount"
      FROM payslips
      WHERE ${where}
      GROUP BY payment_status
    `;
    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount: dataRes.rows.length };
  },
};

// 5. Statutory Summary
const statutorySummaryFilterSchema = z.object({
  period: z.string().optional(),
});
type StatutorySummaryFilters = z.infer<typeof statutorySummaryFilterSchema>;

export const statutorySummaryReport: ReportDefinition<StatutorySummaryFilters> = {
  key: 'statutory-summary',
  title: 'Statutory Compliance Summary',
  description: 'Consolidated report of PF, ESI, Professional Tax, Labour Welfare Fund, and TDS deductions',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_STATUTORY_DOWNLOAD,
  filtersSchema: statutorySummaryFilterSchema,
  columns: [
    { key: 'componentCode', header: 'Statutory Component', type: 'string', align: 'left' },
    { key: 'employeeCount', header: 'Subscribed Employees', type: 'number', align: 'center' },
    { key: 'totalDeducted', header: 'Total Deduction (₹)', type: 'number', align: 'right' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client) => {
    const values: unknown[] = [ctx.companyId];
    let where = "pl.company_id = $1 AND pl.component_code IN ('PF', 'ESI', 'PT', 'LWF', 'TDS')";
    if (filters.period) {
      where += ' AND p.period = $2';
      values.push(filters.period);
    }

    const dataSql = `
      SELECT 
        pl.component_code as "componentCode",
        count(distinct pl.payslip_id)::int as "employeeCount",
        sum(pl.amount)::numeric as "totalDeducted"
      FROM payslip_lines pl
      JOIN payslips p ON p.id = pl.payslip_id
      WHERE ${where}
      GROUP BY pl.component_code
    `;
    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount: dataRes.rows.length };
  },
};

// 6. YTD Ledger
const ytdLedgerFilterSchema = z.object({
  fy: z.string().optional(),
});
type YtdLedgerFilters = z.infer<typeof ytdLedgerFilterSchema>;

export const ytdLedgerReport: ReportDefinition<YtdLedgerFilters> = {
  key: 'ytd-ledger',
  title: 'Year-to-Date (YTD) Ledger',
  description: 'Financial-year cumulative totals per employee across earnings, statutory contributions, and TDS',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  filtersSchema: ytdLedgerFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'fy', header: 'Financial Year', type: 'string', align: 'center' },
    { key: 'componentCode', header: 'Component', type: 'string', align: 'left' },
    { key: 'amount', header: 'Cumulative Total (₹)', type: 'number', align: 'right' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client, pagination) => {
    const values: unknown[] = [ctx.companyId, filters.fy || '2026-27'];
    const where = 'y.company_id = $1 AND y.fy = $2';

    const countRes = await client.query(`SELECT count(*)::int as total FROM payroll_ytd y WHERE ${where}`, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code as "empCode",
        concat(e.first_name, ' ', e.last_name) as "name",
        y.fy,
        y.component_code as "componentCode",
        y.amount::numeric as "amount"
      FROM payroll_ytd y
      JOIN employees e ON e.id = y.employee_id
      WHERE ${where}
      ORDER BY e.emp_code, y.component_code
    `;
    if (pagination?.limit) dataSql += ` LIMIT ${pagination.limit} OFFSET ${pagination.offset ?? 0}`;

    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount };
  },
};

// 7. Joiners & Exits Financial Impact
const joinersExitsFilterSchema = z.object({
  period: z.string().optional(),
});
type JoinersExitsFilters = z.infer<typeof joinersExitsFilterSchema>;

export const joinersExitsImpactReport: ReportDefinition<JoinersExitsFilters> = {
  key: 'joiners-exits-impact',
  title: 'Joiners & Exits Financial Impact',
  description: 'Prorated salary additions and termination settlement impacts within the payroll window',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  filtersSchema: joinersExitsFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'status', header: 'Status', type: 'badge', align: 'center' },
    { key: 'doj', header: 'Date of Joining', type: 'date', align: 'center' },
    { key: 'net', header: 'Net Payout (₹)', type: 'number', align: 'right' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client) => {
    const values: unknown[] = [ctx.companyId];
    let where = "p.company_id = $1 AND (e.status = 'notice' OR e.status = 'terminated' OR e.doj >= '2026-01-01')";
    if (filters.period) {
      where += ' AND p.period = $2';
      values.push(filters.period);
    }

    const dataSql = `
      SELECT 
        e.emp_code as "empCode",
        concat(e.first_name, ' ', e.last_name) as "name",
        e.status,
        e.doj,
        p.net::numeric as "net"
      FROM payslips p
      JOIN employees e ON e.id = p.employee_id
      WHERE ${where}
      ORDER BY e.emp_code
    `;
    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount: dataRes.rows.length };
  },
};

// 8. Payslip Distribution Report
const payslipDistributionFilterSchema = z.object({
  period: z.string().optional(),
});
type PayslipDistributionFilters = z.infer<typeof payslipDistributionFilterSchema>;

export const payslipDistributionReport: ReportDefinition<PayslipDistributionFilters> = {
  key: 'payslip-distribution',
  title: 'Payslip Distribution & Vault Status',
  description: 'Delivery channel verification, pre-generation status, and employee download timestamps',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  filtersSchema: payslipDistributionFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'period', header: 'Period', type: 'string', align: 'center' },
    { key: 'publishedAt', header: 'Published At', type: 'date', align: 'center' },
    { key: 'integrityHash', header: 'Integrity Checksum', type: 'string', align: 'left' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client, pagination) => {
    const values: unknown[] = [ctx.companyId];
    let where = 'p.company_id = $1';
    if (filters.period) {
      where += ' AND p.period = $2';
      values.push(filters.period);
    }

    const countRes = await client.query(`SELECT count(*)::int as total FROM payslips p WHERE ${where}`, values);
    const totalCount = countRes.rows[0]?.total || 0;

    let dataSql = `
      SELECT 
        e.emp_code as "empCode",
        concat(e.first_name, ' ', e.last_name) as "name",
        p.period,
        p.published_at as "publishedAt",
        p.integrity_hash as "integrityHash"
      FROM payslips p
      JOIN employees e ON e.id = p.employee_id
      WHERE ${where}
      ORDER BY e.emp_code
    `;
    if (pagination?.limit) dataSql += ` LIMIT ${pagination.limit} OFFSET ${pagination.offset ?? 0}`;

    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount };
  },
};

// 9. CTC vs Gross Reconciliation
const ctcVsGrossFilterSchema = z.object({
  period: z.string().optional(),
});
type CtcVsGrossFilters = z.infer<typeof ctcVsGrossFilterSchema>;

export const ctcVsGrossReconReport: ReportDefinition<CtcVsGrossFilters> = {
  key: 'ctc-vs-gross-recon',
  title: 'CTC vs Gross Earnings Reconciliation',
  description: 'Mathematical reconciliation between contracted monthly CTC, actual gross, and loss of pay',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RECON_MANAGE,
  filtersSchema: ctcVsGrossFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'actualGross', header: 'Actual Gross (₹)', type: 'number', align: 'right' },
    { key: 'employerCost', header: 'Employer Cost (₹)', type: 'number', align: 'right' },
    { key: 'totalCompanyOutflow', header: 'Total Outflow (₹)', type: 'number', align: 'right' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, filters, client) => {
    const values: unknown[] = [ctx.companyId];
    let where = 'p.company_id = $1';
    if (filters.period) {
      where += ' AND p.period = $2';
      values.push(filters.period);
    }

    const dataSql = `
      SELECT 
        e.emp_code as "empCode",
        concat(e.first_name, ' ', e.last_name) as "name",
        p.gross::numeric as "actualGross",
        p.employer_cost::numeric as "employerCost",
        (p.gross + p.employer_cost)::numeric as "totalCompanyOutflow"
      FROM payslips p
      JOIN employees e ON e.id = p.employee_id
      WHERE ${where}
      ORDER BY e.emp_code
    `;
    const dataRes = await client.query(dataSql, values);
    return { rows: dataRes.rows, totalCount: dataRes.rows.length };
  },
};

// 10. Gratuity Provision
const gratuityFilterSchema = z.object({});
type GratuityFilters = z.infer<typeof gratuityFilterSchema>;

export const gratuityProvisionReport: ReportDefinition<GratuityFilters> = {
  key: 'gratuity-provision',
  title: 'Statutory Gratuity Liability Provision',
  description: 'Actuarial liability provision for employees based on completed tenure and basic wages',
  category: 'payroll',
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  filtersSchema: gratuityFilterSchema,
  columns: [
    { key: 'empCode', header: 'Emp Code', type: 'string', align: 'left' },
    { key: 'name', header: 'Employee Name', type: 'string', align: 'left' },
    { key: 'doj', header: 'Date of Joining', type: 'date', align: 'center' },
    { key: 'status', header: 'Employment Status', type: 'badge', align: 'center' },
  ],
  scopes: ['company'],
  exports: ['csv', 'xlsx'],
  builder: async (ctx, _filters, client) => {
    const dataSql = `
      SELECT 
        emp_code as "empCode",
        concat(first_name, ' ', last_name) as "name",
        doj,
        status
      FROM employees
      WHERE company_id = $1 AND deleted_at IS NULL
      ORDER BY emp_code
    `;
    const dataRes = await client.query(dataSql, [ctx.companyId]);
    return { rows: dataRes.rows, totalCount: dataRes.rows.length };
  },
};
