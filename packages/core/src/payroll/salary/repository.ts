import { and, eq, lte, gte, or, isNull, desc } from 'drizzle-orm';
import {
  Database,
  salaryComponents,
  SalaryComponent,
  NewSalaryComponent,
  salaryStructures,
  SalaryStructure,
  NewSalaryStructure,
  employeeSalary,
  EmployeeSalary,
  NewEmployeeSalary,
  salaryRevisions,
  SalaryRevision,
  NewSalaryRevision,
} from '@hrms/db';

export class SalaryRepository {
  // --- Salary Components ---
  async createComponent(db: Database, data: NewSalaryComponent): Promise<SalaryComponent> {
    const [inserted] = await db.insert(salaryComponents).values(data).returning();
    if (!inserted) throw new Error('Failed to create salary component');
    return inserted;
  }

  async getComponentById(db: Database, companyId: string, id: string): Promise<SalaryComponent | null> {
    const [row] = await db
      .select()
      .from(salaryComponents)
      .where(and(eq(salaryComponents.companyId, companyId), eq(salaryComponents.id, id)));
    return row || null;
  }

  async getComponentByCode(db: Database, companyId: string, code: string): Promise<SalaryComponent | null> {
    const [row] = await db
      .select()
      .from(salaryComponents)
      .where(
        and(
          eq(salaryComponents.companyId, companyId),
          eq(salaryComponents.code, code),
          isNull(salaryComponents.deletedAt),
        ),
      )
      .orderBy(desc(salaryComponents.version))
      .limit(1);
    return row || null;
  }

  async listComponents(db: Database, companyId: string): Promise<SalaryComponent[]> {
    return db
      .select()
      .from(salaryComponents)
      .where(and(eq(salaryComponents.companyId, companyId), isNull(salaryComponents.deletedAt)))
      .orderBy(salaryComponents.sortOrder, salaryComponents.code);
  }

  async updateComponent(
    db: Database,
    companyId: string,
    id: string,
    data: Partial<NewSalaryComponent>,
  ): Promise<SalaryComponent | null> {
    const [updated] = await db
      .update(salaryComponents)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(salaryComponents.companyId, companyId), eq(salaryComponents.id, id)))
      .returning();
    return updated || null;
  }

  // --- Salary Structures ---
  async createStructure(db: Database, data: NewSalaryStructure): Promise<SalaryStructure> {
    const [inserted] = await db.insert(salaryStructures).values(data).returning();
    if (!inserted) throw new Error('Failed to create salary structure');
    return inserted;
  }

  async getStructureById(db: Database, companyId: string, id: string): Promise<SalaryStructure | null> {
    const [row] = await db
      .select()
      .from(salaryStructures)
      .where(and(eq(salaryStructures.companyId, companyId), eq(salaryStructures.id, id)));
    return row || null;
  }

  async listStructures(db: Database, companyId: string): Promise<SalaryStructure[]> {
    return db
      .select()
      .from(salaryStructures)
      .where(and(eq(salaryStructures.companyId, companyId), isNull(salaryStructures.deletedAt)))
      .orderBy(desc(salaryStructures.version), salaryStructures.name);
  }

  async updateStructure(
    db: Database,
    companyId: string,
    id: string,
    data: Partial<NewSalaryStructure>,
  ): Promise<SalaryStructure | null> {
    const [updated] = await db
      .update(salaryStructures)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(salaryStructures.companyId, companyId), eq(salaryStructures.id, id)))
      .returning();
    return updated || null;
  }

  // --- Employee Salary Assignments ---
  async createSalaryAssignment(db: Database, data: NewEmployeeSalary): Promise<EmployeeSalary> {
    const [inserted] = await db.insert(employeeSalary).values(data).returning();
    if (!inserted) throw new Error('Failed to create employee salary assignment');
    return inserted;
  }

  async getSalaryAssignmentById(db: Database, companyId: string, id: string): Promise<EmployeeSalary | null> {
    const [row] = await db
      .select()
      .from(employeeSalary)
      .where(and(eq(employeeSalary.companyId, companyId), eq(employeeSalary.id, id)));
    return row || null;
  }

  async getActiveSalaryAssignment(
    db: Database,
    companyId: string,
    employeeId: string,
    asOfDate: string,
  ): Promise<EmployeeSalary | null> {
    const [row] = await db
      .select()
      .from(employeeSalary)
      .where(
        and(
          eq(employeeSalary.companyId, companyId),
          eq(employeeSalary.employeeId, employeeId),
          eq(employeeSalary.status, 'approved'),
          isNull(employeeSalary.deletedAt),
          lte(employeeSalary.effectiveFrom, asOfDate),
          or(isNull(employeeSalary.effectiveTo), gte(employeeSalary.effectiveTo, asOfDate)),
        ),
      )
      .orderBy(desc(employeeSalary.effectiveFrom))
      .limit(1);
    return row || null;
  }

  async listSalariesForEmployee(
    db: Database,
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeSalary[]> {
    return db
      .select()
      .from(employeeSalary)
      .where(
        and(
          eq(employeeSalary.companyId, companyId),
          eq(employeeSalary.employeeId, employeeId),
          isNull(employeeSalary.deletedAt),
        ),
      )
      .orderBy(desc(employeeSalary.effectiveFrom));
  }

  async updateSalaryAssignment(
    db: Database,
    companyId: string,
    id: string,
    data: Partial<NewEmployeeSalary>,
  ): Promise<EmployeeSalary | null> {
    const [updated] = await db
      .update(employeeSalary)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(employeeSalary.companyId, companyId), eq(employeeSalary.id, id)))
      .returning();
    return updated || null;
  }

  // --- Salary Revisions ---
  async createRevisionBatch(db: Database, data: NewSalaryRevision): Promise<SalaryRevision> {
    const [inserted] = await db.insert(salaryRevisions).values(data).returning();
    if (!inserted) throw new Error('Failed to create salary revision batch');
    return inserted;
  }

  async getRevisionBatchById(db: Database, companyId: string, id: string): Promise<SalaryRevision | null> {
    const [row] = await db
      .select()
      .from(salaryRevisions)
      .where(and(eq(salaryRevisions.companyId, companyId), eq(salaryRevisions.id, id)));
    return row || null;
  }

  /**
   * Loads a revision batch with SELECT ... FOR UPDATE so concurrent approvals serialise.
   */
  async lockRevisionBatchById(db: Database, companyId: string, id: string): Promise<SalaryRevision | null> {
    const [row] = await db
      .select()
      .from(salaryRevisions)
      .where(and(eq(salaryRevisions.companyId, companyId), eq(salaryRevisions.id, id)))
      .for('update');
    return row || null;
  }

  async updateRevisionBatch(
    db: Database,
    companyId: string,
    id: string,
    data: Partial<NewSalaryRevision>,
  ): Promise<SalaryRevision | null> {
    const [updated] = await db
      .update(salaryRevisions)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(salaryRevisions.companyId, companyId), eq(salaryRevisions.id, id)))
      .returning();
    return updated || null;
  }
}
