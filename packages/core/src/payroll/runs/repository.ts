import { and, eq, desc } from 'drizzle-orm';
import {
  Database,
  payrollPeriods,
  payrollRuns,
  payrollRunEvents,
  PayrollPeriod,
  NewPayrollPeriod,
  PayrollRun,
  NewPayrollRun,
  PayrollRunEvent,
} from '@hrms/db';

export class PayrollRunRepository {
  // --- Periods ---
  async createPeriod(db: Database, data: NewPayrollPeriod): Promise<PayrollPeriod> {
    const [inserted] = await db.insert(payrollPeriods).values(data).returning();
    if (!inserted) throw new Error('Failed to create payroll period');
    return inserted;
  }

  async getPeriodById(db: Database, companyId: string, id: string): Promise<PayrollPeriod | null> {
    const [row] = await db
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.companyId, companyId), eq(payrollPeriods.id, id)));
    return row || null;
  }

  async getPeriodByEntityAndMonth(
    db: Database,
    companyId: string,
    legalEntityId: string,
    period: string,
  ): Promise<PayrollPeriod | null> {
    const [row] = await db
      .select()
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.companyId, companyId),
          eq(payrollPeriods.legalEntityId, legalEntityId),
          eq(payrollPeriods.period, period),
        ),
      );
    return row || null;
  }

  async listPeriods(db: Database, companyId: string, legalEntityId?: string): Promise<PayrollPeriod[]> {
    const conditions = [eq(payrollPeriods.companyId, companyId)];
    if (legalEntityId) {
      conditions.push(eq(payrollPeriods.legalEntityId, legalEntityId));
    }
    return db
      .select()
      .from(payrollPeriods)
      .where(and(...conditions))
      .orderBy(desc(payrollPeriods.period));
  }

  // --- Runs ---
  async createRun(db: Database, data: NewPayrollRun): Promise<PayrollRun> {
    const [inserted] = await db.insert(payrollRuns).values(data).returning();
    if (!inserted) throw new Error('Failed to create payroll run');
    return inserted;
  }

  async getRunById(db: Database, companyId: string, id: string): Promise<PayrollRun | null> {
    const [row] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.id, id)));
    return row || null;
  }

  async listRunsByPeriod(db: Database, companyId: string, periodId: string): Promise<PayrollRun[]> {
    return db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.periodId, periodId)))
      .orderBy(payrollRuns.sequence);
  }

  async listRunEvents(db: Database, companyId: string, runId: string): Promise<PayrollRunEvent[]> {
    return db
      .select()
      .from(payrollRunEvents)
      .where(and(eq(payrollRunEvents.companyId, companyId), eq(payrollRunEvents.runId, runId)))
      .orderBy(desc(payrollRunEvents.ts));
  }
}
