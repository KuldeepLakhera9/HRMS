import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';

export interface DepartmentRow {
  id: string;
  companyId: string;
  name: string;
  code: string;
  parentId: string | null;
  headEmployeeId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export interface DesignationRow {
  id: string;
  companyId: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export interface GradeRow {
  id: string;
  companyId: string;
  name: string;
  code: string;
  level: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export interface CostCenterRow {
  id: string;
  companyId: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export interface CompanyRow {
  id: string;
  name: string;
  legalName: string;
  domain: string;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OrgRepository {
  // --------------------------------------------------------------------------
  // Departments
  // --------------------------------------------------------------------------
  async createDepartment(
    params: {
      companyId: string;
      name: string;
      code: string;
      parentId?: string | null | undefined;
      headEmployeeId?: string | null | undefined;
      active?: boolean | undefined;
      userId?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<DepartmentRow> {
    const id = generateUuidV7();
    return withTenant(
      {
        companyId: params.companyId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
      async (_tx, client) => {
        const res = await client.query<DepartmentRow>(
          `INSERT INTO departments (
             id, company_id, name, code, parent_id, head_employee_id, active, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           RETURNING id, company_id as "companyId", name, code, parent_id as "parentId",
                     head_employee_id as "headEmployeeId", active, created_at as "createdAt",
                     updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.name,
            params.code.toUpperCase(),
            params.parentId || null,
            params.headEmployeeId || null,
            params.active ?? true,
            params.userId || null,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  async findDepartmentById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<DepartmentRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<DepartmentRow>(
          `SELECT id, company_id as "companyId", name, code, parent_id as "parentId",
                  head_employee_id as "headEmployeeId", active, created_at as "createdAt",
                  updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"
           FROM departments
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  async listDepartments(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<DepartmentRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<DepartmentRow>(
          `SELECT id, company_id as "companyId", name, code, parent_id as "parentId",
                  head_employee_id as "headEmployeeId", active, created_at as "createdAt",
                  updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"
           FROM departments
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY name ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  async getDepartmentAncestors(
    companyId: string,
    departmentId: string,
    poolOverride?: pg.Pool,
  ): Promise<string[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{ id: string }>(
          `WITH RECURSIVE dept_ancestors AS (
             SELECT id, parent_id
             FROM departments
             WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
             UNION ALL
             SELECT d.id, d.parent_id
             FROM departments d
             INNER JOIN dept_ancestors a ON d.id = a.parent_id
             WHERE d.company_id = $1 AND d.deleted_at IS NULL
           )
           SELECT id FROM dept_ancestors`,
          [companyId, departmentId],
        );
        return res.rows.map(r => r.id);
      },
      poolOverride,
    );
  }

  async updateDepartment(
    params: {
      companyId: string;
      id: string;
      name?: string | undefined;
      code?: string | undefined;
      parentId?: string | null | undefined;
      headEmployeeId?: string | null | undefined;
      active?: boolean | undefined;
      userId?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<DepartmentRow | null> {
    return withTenant(
      {
        companyId: params.companyId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
      async (_tx, client) => {
        const sets: string[] = ['updated_at = now()', 'row_version = row_version + 1'];
        const values: unknown[] = [params.companyId, params.id];
        let pIdx = 3;

        if (params.name !== undefined) {
          sets.push(`name = $${pIdx++}`);
          values.push(params.name);
        }
        if (params.code !== undefined) {
          sets.push(`code = $${pIdx++}`);
          values.push(params.code.toUpperCase());
        }
        if (params.parentId !== undefined) {
          sets.push(`parent_id = $${pIdx++}`);
          values.push(params.parentId);
        }
        if (params.headEmployeeId !== undefined) {
          sets.push(`head_employee_id = $${pIdx++}`);
          values.push(params.headEmployeeId);
        }
        if (params.active !== undefined) {
          sets.push(`active = $${pIdx++}`);
          values.push(params.active);
        }
        if (params.userId !== undefined) {
          sets.push(`updated_by = $${pIdx++}`);
          values.push(params.userId);
        }

        const res = await client.query<DepartmentRow>(
          `UPDATE departments
           SET ${sets.join(', ')}
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING id, company_id as "companyId", name, code, parent_id as "parentId",
                     head_employee_id as "headEmployeeId", active, created_at as "createdAt",
                     updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"`,
          values,
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  async deleteDepartment(
    companyId: string,
    id: string,
    userId?: string | undefined,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      {
        companyId,
        ...(userId ? { userId } : {}),
      },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE departments
           SET deleted_at = now(), updated_by = $3
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id, userId || null],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }

  // --------------------------------------------------------------------------
  // Designations
  // --------------------------------------------------------------------------
  async createDesignation(
    params: {
      companyId: string;
      name: string;
      code: string;
      active?: boolean | undefined;
      userId?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<DesignationRow> {
    const id = generateUuidV7();
    return withTenant(
      {
        companyId: params.companyId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
      async (_tx, client) => {
        const res = await client.query<DesignationRow>(
          `INSERT INTO designations (id, company_id, name, code, active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING id, company_id as "companyId", name, code, active,
                     created_at as "createdAt", updated_at as "updatedAt",
                     deleted_at as "deletedAt", row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.name,
            params.code.toUpperCase(),
            params.active ?? true,
            params.userId || null,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  async listDesignations(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<DesignationRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<DesignationRow>(
          `SELECT id, company_id as "companyId", name, code, active,
                  created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM designations
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY name ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  // --------------------------------------------------------------------------
  // Grades
  // --------------------------------------------------------------------------
  async createGrade(
    params: {
      companyId: string;
      name: string;
      code: string;
      level?: number | undefined;
      active?: boolean | undefined;
      userId?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<GradeRow> {
    const id = generateUuidV7();
    return withTenant(
      {
        companyId: params.companyId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
      async (_tx, client) => {
        const res = await client.query<GradeRow>(
          `INSERT INTO grades (id, company_id, name, code, level, active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           RETURNING id, company_id as "companyId", name, code, level, active,
                     created_at as "createdAt", updated_at as "updatedAt",
                     deleted_at as "deletedAt", row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.name,
            params.code.toUpperCase(),
            params.level || 1,
            params.active ?? true,
            params.userId || null,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  async listGrades(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<GradeRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<GradeRow>(
          `SELECT id, company_id as "companyId", name, code, level, active,
                  created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM grades
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY level ASC, name ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  // --------------------------------------------------------------------------
  // Cost Centers
  // --------------------------------------------------------------------------
  async createCostCenter(
    params: {
      companyId: string;
      name: string;
      code: string;
      active?: boolean | undefined;
      userId?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<CostCenterRow> {
    const id = generateUuidV7();
    return withTenant(
      {
        companyId: params.companyId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
      async (_tx, client) => {
        const res = await client.query<CostCenterRow>(
          `INSERT INTO cost_centers (id, company_id, name, code, active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING id, company_id as "companyId", name, code, active,
                     created_at as "createdAt", updated_at as "updatedAt",
                     deleted_at as "deletedAt", row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.name,
            params.code.toUpperCase(),
            params.active ?? true,
            params.userId || null,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  async listCostCenters(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<CostCenterRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<CostCenterRow>(
          `SELECT id, company_id as "companyId", name, code, active,
                  created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM cost_centers
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY name ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  // --------------------------------------------------------------------------
  // Company Settings
  // --------------------------------------------------------------------------
  async findCompanyById(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<CompanyRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<CompanyRow>(
          `SELECT id, name, legal_name as "legalName", domain, logo_url as "logoUrl",
                  created_at as "createdAt", updated_at as "updatedAt"
           FROM companies
           WHERE id = $1 AND deleted_at IS NULL`,
          [companyId],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  async updateCompany(
    companyId: string,
    data: {
      name?: string | undefined;
      legalName?: string | undefined;
      logoUrl?: string | null | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<CompanyRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const sets: string[] = ['updated_at = now()'];
        const values: unknown[] = [companyId];
        let pIdx = 2;

        if (data.name !== undefined) {
          sets.push(`name = $${pIdx++}`);
          values.push(data.name);
        }
        if (data.legalName !== undefined) {
          sets.push(`legal_name = $${pIdx++}`);
          values.push(data.legalName);
        }
        if (data.logoUrl !== undefined) {
          sets.push(`logo_url = $${pIdx++}`);
          values.push(data.logoUrl);
        }

        const res = await client.query<CompanyRow>(
          `UPDATE companies
           SET ${sets.join(', ')}
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id, name, legal_name as "legalName", domain, logo_url as "logoUrl",
                     created_at as "createdAt", updated_at as "updatedAt"`,
          values,
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }
}
