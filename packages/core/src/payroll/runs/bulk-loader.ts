import { and, eq, inArray, isNull, desc } from 'drizzle-orm';
import {
  Database,
  employees,
  employeeSalary,
  salaryStructures,
  attendancePeriodSummary,
  payrollInputs,
  employeeLoans,
  loanInstallments,
  payrollYtd,
  Employee,
  EmployeeSalary,
  SalaryStructure,
  AttendancePeriodSummary,
  PayrollInput,
  PayrollYtd,
} from '@hrms/db';
import type { PayslipCalculationInput, PayslipComponentDef } from '../engines/payslip.js';

export interface LoadedLoanInstallment {
  id: string;
  loanId: string;
  totalAmount: string;
}

export interface TaxDeclarationInfo {
  declaration: { regime?: string };
  items: Array<{
    proofStatus?: string;
    amountVerified?: string | number;
    deductionCode: string;
  }>;
}

export interface BulkLoaderData {
  employeeMap: Map<string, Employee>;
  salaryMap: Map<string, EmployeeSalary>;
  structureMap: Map<string, SalaryStructure>;
  attendanceMap: Map<string, AttendancePeriodSummary>;
  inputsMap: Map<string, PayrollInput[]>;
  loanInstallmentsMap: Map<string, LoadedLoanInstallment[]>;
  ytdMap: Map<string, PayrollYtd[]>;
  taxDeclarationsMap: Map<string, TaxDeclarationInfo>;
}

export class PayrollBulkLoader {
  /**
   * Bulk loads all domain inputs for a chunk of up to 100 employees in <= 8 queries.
   */
  async loadChunkData(
    db: Database,
    companyId: string,
    _legalEntityId: string,
    period: string, // 'YYYY-MM'
    fy: string, // 'YYYY-YYYY'
    employeeIds: string[],
  ): Promise<BulkLoaderData> {
    if (employeeIds.length === 0) {
      return {
        employeeMap: new Map(),
        salaryMap: new Map(),
        structureMap: new Map(),
        attendanceMap: new Map(),
        inputsMap: new Map(),
        loanInstallmentsMap: new Map(),
        ytdMap: new Map(),
        taxDeclarationsMap: new Map(),
      };
    }

    // Query 1: Employees
    const empRows = await db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.companyId, companyId),
          inArray(employees.id, employeeIds),
          isNull(employees.deletedAt),
        ),
      );

    // Query 2: Active Employee Salaries as of period
    const salaryRows = await db
      .select()
      .from(employeeSalary)
      .where(
        and(
          eq(employeeSalary.companyId, companyId),
          inArray(employeeSalary.employeeId, employeeIds),
          eq(employeeSalary.status, 'approved'),
          isNull(employeeSalary.deletedAt),
        ),
      )
      .orderBy(desc(employeeSalary.effectiveFrom));

    // Query 3: Pinned/Active Salary Structures
    const structureIds = Array.from(new Set(salaryRows.map(s => s.structureId)));
    let structureRows: SalaryStructure[] = [];
    if (structureIds.length > 0) {
      structureRows = await db
        .select()
        .from(salaryStructures)
        .where(
          and(
            eq(salaryStructures.companyId, companyId),
            inArray(salaryStructures.id, structureIds),
            isNull(salaryStructures.deletedAt),
          ),
        );
    }

    // Query 4: Attendance Period Summaries for the period
    const attendanceRows = await db
      .select()
      .from(attendancePeriodSummary)
      .where(
        and(
          eq(attendancePeriodSummary.companyId, companyId),
          inArray(attendancePeriodSummary.employeeId, employeeIds),
          eq(attendancePeriodSummary.period, period),
        ),
      );

    // Query 5: Approved Payroll Inputs for the period
    const inputRows = await db
      .select()
      .from(payrollInputs)
      .where(
        and(
          eq(payrollInputs.companyId, companyId),
          inArray(payrollInputs.employeeId, employeeIds),
          eq(payrollInputs.forPeriod, period),
          eq(payrollInputs.status, 'approved'),
          isNull(payrollInputs.deletedAt),
        ),
      );

    // Query 6: Loan Installments due in this period
    const loanInstRows = await db
      .select({
        id: loanInstallments.id,
        loanId: loanInstallments.loanId,
        totalAmount: loanInstallments.totalAmount,
        employeeId: employeeLoans.employeeId,
      })
      .from(loanInstallments)
      .innerJoin(
        employeeLoans,
        and(
          eq(loanInstallments.companyId, employeeLoans.companyId),
          eq(loanInstallments.loanId, employeeLoans.id),
        ),
      )
      .where(
        and(
          eq(loanInstallments.companyId, companyId),
          inArray(employeeLoans.employeeId, employeeIds),
          eq(loanInstallments.duePeriod, period),
          eq(loanInstallments.status, 'due'),
          eq(employeeLoans.status, 'active'),
          isNull(loanInstallments.deletedAt),
          isNull(employeeLoans.deletedAt),
        ),
      );

    // Query 7: Payroll YTD & Opening Balances for the FY
    const ytdRows = await db
      .select()
      .from(payrollYtd)
      .where(
        and(
          eq(payrollYtd.companyId, companyId),
          inArray(payrollYtd.employeeId, employeeIds),
          eq(payrollYtd.fy, fy),
        ),
      );

    // Tax declarations are reserved for future regime management
    const taxDeclarationsMap = new Map<string, TaxDeclarationInfo>();

    // Assemble hash maps
    const employeeMap = new Map<string, Employee>();
    for (const e of empRows) employeeMap.set(e.id, e);

    // Latest active salary per employee
    const salaryMap = new Map<string, EmployeeSalary>();
    for (const s of salaryRows) {
      if (!salaryMap.has(s.employeeId)) {
        salaryMap.set(s.employeeId, s);
      }
    }

    const structureMap = new Map<string, SalaryStructure>();
    for (const st of structureRows) structureMap.set(st.id, st);

    const attendanceMap = new Map<string, AttendancePeriodSummary>();
    for (const a of attendanceRows) attendanceMap.set(a.employeeId, a);

    const inputsMap = new Map<string, PayrollInput[]>();
    for (const inp of inputRows) {
      const list = inputsMap.get(inp.employeeId) || [];
      list.push(inp);
      inputsMap.set(inp.employeeId, list);
    }

    const loanInstallmentsMap = new Map<string, LoadedLoanInstallment[]>();
    for (const row of loanInstRows) {
      const list = loanInstallmentsMap.get(row.employeeId) || [];
      list.push({
        id: row.id,
        loanId: row.loanId,
        totalAmount: row.totalAmount,
      });
      loanInstallmentsMap.set(row.employeeId, list);
    }

    const ytdMap = new Map<string, PayrollYtd[]>();
    for (const y of ytdRows) {
      const list = ytdMap.get(y.employeeId) || [];
      list.push(y);
      ytdMap.set(y.employeeId, list);
    }

    return {
      employeeMap,
      salaryMap,
      structureMap,
      attendanceMap,
      inputsMap,
      loanInstallmentsMap,
      ytdMap,
      taxDeclarationsMap,
    };
  }

  /**
   * Converts bulk loaded data into a typed PayslipInput for a specific employee.
   */
  assemblePayslipInput(
    employeeId: string,
    period: string, // 'YYYY-MM'
    bulkData: BulkLoaderData,
    cachedRules: Record<string, unknown>,
    calendarDays = 30,
  ): PayslipCalculationInput | null {
    const emp = bulkData.employeeMap.get(employeeId);
    if (!emp) return null;

    const sal = bulkData.salaryMap.get(employeeId);
    if (!sal) return null;

    const structure = bulkData.structureMap.get(sal.structureId);
    if (!structure) return null;

    const att = bulkData.attendanceMap.get(employeeId);
    const payableDays = att
      ? Number(att.present) +
        Number(att.weeklyOff) +
        Number(att.holidays) +
        Number(att.leaveDays) +
        Number(att.odDays) +
        Number(att.wfhDays)
      : calendarDays;
    const lopDays = att ? Number(att.lopDays) : 0;

    const empInputs = bulkData.inputsMap.get(employeeId) || [];
    const loanInsts = bulkData.loanInstallmentsMap.get(employeeId) || [];
    const empYtd = bulkData.ytdMap.get(employeeId) || [];
    const taxInfo = bulkData.taxDeclarationsMap.get(employeeId);

    const components = (structure.components || []) as unknown as PayslipComponentDef[];

    // YTD gross & TDS map
    let ytdGross = '0.00';
    let ytdTds = '0.00';
    for (const y of empYtd) {
      if (y.componentCode === 'GROSS' || y.componentCode === 'BASIC') {
        ytdGross = y.amount;
      }
      if (y.componentCode === 'TDS') {
        ytdTds = y.amount;
      }
    }

    // Tax declaration details
    const regime = (taxInfo?.declaration.regime as 'new' | 'old') || 'new';
    const verifiedDeductions: Record<string, string | number> = {};
    if (taxInfo) {
      for (const item of taxInfo.items) {
        if (item.proofStatus === 'verified' && item.amountVerified) {
          verifiedDeductions[item.deductionCode] = item.amountVerified;
        }
      }
    }

    const monthNum = parseInt(period.split('-')[1] || '1', 10);
    // Fiscal month index (April = 12 remaining, March = 1 remaining)
    const remainingMonths = monthNum >= 4 ? 16 - monthNum : 4 - monthNum;

    return {
      employee: {
        id: emp.id,
        empCode: emp.empCode,
        state: 'MH',
        gender: undefined,
        joinDate: emp.doj,
        exitDate: undefined,
        pan: (emp.panEnc || (emp as Record<string, unknown>).pan) as string | undefined,
        bankAccountNumber: (emp.bankEnc || (emp as Record<string, unknown>).bankAccount) as string | undefined,
      },
      settings: {
        paidDaysBasis: 'calendar',
        prorationMode: 'prorate_earnings',
        negativeNetPolicy: 'hold',
        pfEnabled: true,
        esiEnabled: true,
        ptEnabled: true,
        lwfEnabled: true,
        labourCodeWages: {
          enabled: true,
          floorPct: 0.50,
        },
      },
      attendance: {
        calendarDays,
        paidDays: payableDays,
        lopDays,
      },
      salary: {
        ctcAnnual: sal.ctcAnnual,
        structureId: sal.structureId,
        structureVersion: sal.structureVersion,
        components,
      },
      inputs: empInputs.map(i => ({
        type: i.type,
        componentCode: i.componentCode,
        amount: i.amount,
        taxable: i.taxable,
      })),
      loansDue: loanInsts.map(l => ({
        loanId: l.loanId,
        installmentId: l.id,
        amount: l.totalAmount,
      })),
      rules: cachedRules as PayslipCalculationInput['rules'],
      ytd: {
        gross: ytdGross,
        tdsDeducted: ytdTds,
      },
      taxDeclaration: {
        regime,
        verifiedDeductions,
        remainingMonths: Math.max(1, remainingMonths),
      },
      periodMonth: monthNum,
    };
  }
}

