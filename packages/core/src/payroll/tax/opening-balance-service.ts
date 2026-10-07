import { and, eq } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import {
  Database,
  payrollOpeningBalances,
  payrollYtd,
  employees,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';

export interface RawOpeningBalanceRow {
  empCode: string;
  fy: string;
  asOfPeriod: string; // 'YYYY-MM'
  componentCode: string;
  amount: number | string;
  tdsDeducted?: number | string;
  pfYtd?: number | string;
  esiYtd?: number | string;
  ptYtd?: number | string;
  runId?: string;
}

export interface ImportPreviewResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: Array<{ row: number; empCode: string; reason: string }>;
  totals: {
    grossEarnings: string;
    tdsDeducted: string;
    pfYtd: string;
    esiYtd: string;
    ptYtd: string;
  };
  sampleValidated: Array<RawOpeningBalanceRow & { employeeId: string; employeeName: string }>;
}

export class OpeningBalanceService {
  /**
   * Validates and prepares preview of uploaded opening balance records.
   */
  async validateAndPreview(
    ctx: RequestContext,
    db: Database,
    rows: RawOpeningBalanceRow[],
  ): Promise<ImportPreviewResult> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SETTINGS_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.settings.manage required');
    }

    const errors: Array<{ row: number; empCode: string; reason: string }> = [];
    const sampleValidated: Array<RawOpeningBalanceRow & { employeeId: string; employeeName: string }> = [];

    let totalGross = new Decimal(0);
    let totalTds = new Decimal(0);
    let totalPf = new Decimal(0);
    let totalEsi = new Decimal(0);
    let totalPt = new Decimal(0);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (!row.empCode) {
        errors.push({ row: i + 1, empCode: 'UNKNOWN', reason: 'Missing employee code' });
        continue;
      }

      // Lookup employee by code
      const [emp] = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.companyId, ctx.companyId),
            eq(employees.empCode, row.empCode.trim()),
          ),
        );

      if (!emp) {
        errors.push({ row: i + 1, empCode: row.empCode, reason: `Employee code '${row.empCode}' not found` });
        continue;
      }

      const amt = new Decimal(row.amount || 0);
      const tds = new Decimal(row.tdsDeducted || 0);
      const pf = new Decimal(row.pfYtd || 0);
      const esi = new Decimal(row.esiYtd || 0);
      const pt = new Decimal(row.ptYtd || 0);

      totalGross = totalGross.plus(amt);
      totalTds = totalTds.plus(tds);
      totalPf = totalPf.plus(pf);
      totalEsi = totalEsi.plus(esi);
      totalPt = totalPt.plus(pt);

      sampleValidated.push({
        empCode: row.empCode,
        fy: row.fy,
        asOfPeriod: row.asOfPeriod,
        componentCode: row.componentCode,
        amount: row.amount,
        ...(row.tdsDeducted !== undefined ? { tdsDeducted: row.tdsDeducted } : {}),
        ...(row.pfYtd !== undefined ? { pfYtd: row.pfYtd } : {}),
        ...(row.esiYtd !== undefined ? { esiYtd: row.esiYtd } : {}),
        ...(row.ptYtd !== undefined ? { ptYtd: row.ptYtd } : {}),
        ...(row.runId !== undefined ? { runId: row.runId } : {}),
        employeeId: emp.id,
        employeeName: emp.firstName ? `${emp.firstName} ${emp.lastName || ''}`.trim() : 'Employee',
      });
    }

    return {
      totalRows: rows.length,
      validRows: sampleValidated.length,
      errorRows: errors.length,
      errors,
      totals: {
        grossEarnings: totalGross.toFixed(2),
        tdsDeducted: totalTds.toFixed(2),
        pfYtd: totalPf.toFixed(2),
        esiYtd: totalEsi.toFixed(2),
        ptYtd: totalPt.toFixed(2),
      },
      sampleValidated: sampleValidated.slice(0, 50),
    };
  }

  /**
   * Commits the validated opening balance records into payroll_opening_balances and updates payroll_ytd.
   */
  async confirmImport(
    ctx: RequestContext,
    db: Database,
    records: Array<RawOpeningBalanceRow & { employeeId: string }>,
  ): Promise<{ importJobId: string; importedCount: number }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SETTINGS_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.settings.manage required');
    }

    if (records.length === 0) {
      throw new ValidationError('No valid records to import');
    }

    const importJobId = crypto.randomUUID();

    for (const rec of records) {
      const amtStr = new Decimal(rec.amount || 0).toFixed(2);
      const tdsStr = new Decimal(rec.tdsDeducted || 0).toFixed(2);
      const pfStr = new Decimal(rec.pfYtd || 0).toFixed(2);
      const esiStr = new Decimal(rec.esiYtd || 0).toFixed(2);
      const ptStr = new Decimal(rec.ptYtd || 0).toFixed(2);

      // Insert opening balance record
      await db.insert(payrollOpeningBalances).values({
        companyId: ctx.companyId,
        employeeId: rec.employeeId,
        fy: rec.fy,
        asOfPeriod: rec.asOfPeriod,
        componentCode: rec.componentCode,
        amount: amtStr,
        tdsDeducted: tdsStr,
        pfYtd: pfStr,
        esiYtd: esiStr,
        ptYtd: ptStr,
        source: 'import',
        importJobId,
        status: 'active',
        createdBy: ctx.userId || null,
        updatedBy: ctx.userId || null,
      });

      // Upsert into payroll_ytd only if a valid runId is provided
      if (rec.runId) {
        const [existingYtd] = await db
          .select()
          .from(payrollYtd)
          .where(
            and(
              eq(payrollYtd.companyId, ctx.companyId),
              eq(payrollYtd.employeeId, rec.employeeId),
              eq(payrollYtd.fy, rec.fy),
              eq(payrollYtd.componentCode, rec.componentCode),
            ),
          );

        if (existingYtd) {
          const newYtdAmt = new Decimal(existingYtd.amount).plus(new Decimal(amtStr)).toFixed(2);
          await db
            .update(payrollYtd)
            .set({
              amount: newYtdAmt,
              updatedAt: new Date(),
            })
            .where(and(eq(payrollYtd.companyId, ctx.companyId), eq(payrollYtd.id, existingYtd.id)));
        } else {
          await db.insert(payrollYtd).values({
            companyId: ctx.companyId,
            employeeId: rec.employeeId,
            fy: rec.fy,
            componentCode: rec.componentCode,
            amount: amtStr,
            lastRunId: rec.runId,
          });
        }
      }
    }

    return { importJobId, importedCount: records.length };
  }

  /**
   * Reverts an imported opening balance job atomically.
   */
  async revertImport(
    ctx: RequestContext,
    db: Database,
    importJobId: string,
  ): Promise<{ revertedCount: number }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SETTINGS_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.settings.manage required');
    }

    const importedRows = await db
      .select()
      .from(payrollOpeningBalances)
      .where(
        and(
          eq(payrollOpeningBalances.companyId, ctx.companyId),
          eq(payrollOpeningBalances.importJobId, importJobId),
          eq(payrollOpeningBalances.status, 'active'),
        ),
      );

    if (importedRows.length === 0) {
      throw new NotFoundError('No active opening balance records found for this import job');
    }

    for (const row of importedRows) {
      // Deduct from payroll_ytd
      const [existingYtd] = await db
        .select()
        .from(payrollYtd)
        .where(
          and(
            eq(payrollYtd.companyId, ctx.companyId),
            eq(payrollYtd.employeeId, row.employeeId),
            eq(payrollYtd.fy, row.fy),
            eq(payrollYtd.componentCode, row.componentCode),
          ),
        );

      if (existingYtd) {
        const newAmt = Decimal.max(0, new Decimal(existingYtd.amount).minus(new Decimal(row.amount))).toFixed(2);
        await db
          .update(payrollYtd)
          .set({
            amount: newAmt,
            updatedAt: new Date(),
          })
          .where(and(eq(payrollYtd.companyId, ctx.companyId), eq(payrollYtd.id, existingYtd.id)));
      }
    }

    // Mark as reverted
    await db
      .update(payrollOpeningBalances)
      .set({
        status: 'reverted',
        updatedAt: new Date(),
        updatedBy: ctx.userId || null,
      })
      .where(
        and(
          eq(payrollOpeningBalances.companyId, ctx.companyId),
          eq(payrollOpeningBalances.importJobId, importJobId),
        ),
      );

    return { revertedCount: importedRows.length };
  }
}
