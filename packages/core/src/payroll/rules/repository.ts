import { and, eq, lte, gte, or, isNull, desc } from 'drizzle-orm';
import { Database, statutoryRuleSets, StatutoryRuleSet, NewStatutoryRuleSet } from '@hrms/db';

export class StatutoryRulesRepository {
  async createRuleSet(
    db: Database,
    data: NewStatutoryRuleSet,
  ): Promise<StatutoryRuleSet> {
    const [inserted] = await db.insert(statutoryRuleSets).values(data).returning();
    if (!inserted) throw new Error('Failed to create statutory rule set');
    return inserted;
  }

  async updateRuleSet(
    db: Database,
    companyId: string,
    id: string,
    data: Partial<NewStatutoryRuleSet>,
  ): Promise<StatutoryRuleSet | null> {
    const [updated] = await db
      .update(statutoryRuleSets)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(statutoryRuleSets.companyId, companyId), eq(statutoryRuleSets.id, id)))
      .returning();
    return updated || null;
  }

  async getRuleSetById(
    db: Database,
    companyId: string,
    id: string,
  ): Promise<StatutoryRuleSet | null> {
    const [row] = await db
      .select()
      .from(statutoryRuleSets)
      .where(and(eq(statutoryRuleSets.companyId, companyId), eq(statutoryRuleSets.id, id)));
    return row || null;
  }

  async getActiveRuleSet(
    db: Database,
    companyId: string,
    key: string,
    jurisdiction: string,
    asOfDate: string, // YYYY-MM-DD
  ): Promise<StatutoryRuleSet | null> {
    const [row] = await db
      .select()
      .from(statutoryRuleSets)
      .where(
        and(
          eq(statutoryRuleSets.companyId, companyId),
          eq(statutoryRuleSets.key, key),
          eq(statutoryRuleSets.jurisdiction, jurisdiction),
          eq(statutoryRuleSets.status, 'active'),
          isNull(statutoryRuleSets.deletedAt),
          lte(statutoryRuleSets.effectiveFrom, asOfDate),
          or(
            isNull(statutoryRuleSets.effectiveTo),
            gte(statutoryRuleSets.effectiveTo, asOfDate),
          ),
        ),
      )
      .orderBy(desc(statutoryRuleSets.version))
      .limit(1);
    return row || null;
  }

  async getLatestVersionNumber(
    db: Database,
    companyId: string,
    key: string,
    jurisdiction: string,
  ): Promise<number> {
    const [latest] = await db
      .select({ version: statutoryRuleSets.version })
      .from(statutoryRuleSets)
      .where(
        and(
          eq(statutoryRuleSets.companyId, companyId),
          eq(statutoryRuleSets.key, key),
          eq(statutoryRuleSets.jurisdiction, jurisdiction),
        ),
      )
      .orderBy(desc(statutoryRuleSets.version))
      .limit(1);
    return latest?.version || 0;
  }

  async listRuleSetVersions(
    db: Database,
    companyId: string,
    key: string,
    jurisdiction: string,
  ): Promise<StatutoryRuleSet[]> {
    return db
      .select()
      .from(statutoryRuleSets)
      .where(
        and(
          eq(statutoryRuleSets.companyId, companyId),
          eq(statutoryRuleSets.key, key),
          eq(statutoryRuleSets.jurisdiction, jurisdiction),
          isNull(statutoryRuleSets.deletedAt),
        ),
      )
      .orderBy(desc(statutoryRuleSets.version));
  }

  async listAllRuleSets(
    db: Database,
    companyId: string,
  ): Promise<StatutoryRuleSet[]> {
    return db
      .select()
      .from(statutoryRuleSets)
      .where(
        and(
          eq(statutoryRuleSets.companyId, companyId),
          isNull(statutoryRuleSets.deletedAt),
        ),
      )
      .orderBy(statutoryRuleSets.key, desc(statutoryRuleSets.version));
  }
}
