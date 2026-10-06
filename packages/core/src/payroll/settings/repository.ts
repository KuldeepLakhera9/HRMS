import { and, eq } from 'drizzle-orm';
import {
  Database,
  payrollSettings,
  PayrollSetting,
  NewPayrollSetting,
  legalEntities,
  LegalEntity,
  NewLegalEntity,
} from '@hrms/db';

export class PayrollSettingsRepository {
  async getSettings(db: Database, companyId: string): Promise<PayrollSetting | null> {
    const [row] = await db
      .select()
      .from(payrollSettings)
      .where(eq(payrollSettings.companyId, companyId))
      .limit(1);
    return row || null;
  }

  async createSettings(db: Database, data: NewPayrollSetting): Promise<PayrollSetting> {
    const [inserted] = await db.insert(payrollSettings).values(data).returning();
    if (!inserted) throw new Error('Failed to create payroll settings');
    return inserted;
  }

  async updateSettings(
    db: Database,
    companyId: string,
    id: string,
    data: Partial<NewPayrollSetting>,
  ): Promise<PayrollSetting> {
    const [updated] = await db
      .update(payrollSettings)
      .set(data)
      .where(and(eq(payrollSettings.companyId, companyId), eq(payrollSettings.id, id)))
      .returning();
    if (!updated) throw new Error('Failed to update payroll settings');
    return updated;
  }

  async listLegalEntities(db: Database, companyId: string): Promise<LegalEntity[]> {
    return db
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.companyId, companyId));
  }

  async createLegalEntity(db: Database, data: NewLegalEntity): Promise<LegalEntity> {
    const [inserted] = await db.insert(legalEntities).values(data).returning();
    if (!inserted) throw new Error('Failed to create legal entity');
    return inserted;
  }
}
