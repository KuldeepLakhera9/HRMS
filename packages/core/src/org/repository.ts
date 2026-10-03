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

export interface LocationAddress {
  line1: string;
  line2?: string | null | undefined;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface WorkLocationRow {
  id: string;
  companyId: string;
  name: string;
  code: string;
  address: LocationAddress;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export interface OrgChartNodeRow {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string;
  departmentId: string | null;
  departmentName: string | null;
  designationId: string | null;
  designationName: string | null;
  managerId: string | null;
  directReportsCount: number;
  reportingPath?: string[] | undefined;
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

  // --------------------------------------------------------------------------
  // Work Locations
  // --------------------------------------------------------------------------
  async createLocation(
    params: {
      companyId: string;
      name: string;
      code: string;
      address: LocationAddress;
      timezone?: string | undefined;
      latitude?: number | null | undefined;
      longitude?: number | null | undefined;
      radiusMeters?: number | null | undefined;
      active?: boolean | undefined;
      userId?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<WorkLocationRow> {
    const id = generateUuidV7();
    return withTenant(
      {
        companyId: params.companyId,
        ...(params.userId ? { userId: params.userId } : {}),
      },
      async (_tx, client) => {
        const res = await client.query<WorkLocationRow>(
          `INSERT INTO work_locations (
             id, company_id, name, code, address, timezone,
             center, radius_meters, active, created_by, updated_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             CASE WHEN $7::numeric IS NOT NULL AND $8::numeric IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint($8::numeric, $7::numeric), 4326)::geography
                  ELSE NULL END,
             $9, $10, $11, $11
           )
           RETURNING id, company_id as "companyId", name, code, address, timezone,
                     ST_Y(center::geometry)::float as "latitude",
                     ST_X(center::geometry)::float as "longitude",
                     radius_meters as "radiusMeters", active,
                     created_at as "createdAt", updated_at as "updatedAt",
                     deleted_at as "deletedAt", row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.name,
            params.code.toUpperCase(),
            JSON.stringify(params.address),
            params.timezone || 'Asia/Kolkata',
            params.latitude ?? null,
            params.longitude ?? null,
            params.radiusMeters ?? null,
            params.active ?? true,
            params.userId || null,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  async getLocationById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<WorkLocationRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<WorkLocationRow>(
          `SELECT id, company_id as "companyId", name, code, address, timezone,
                  ST_Y(center::geometry)::float as "latitude",
                  ST_X(center::geometry)::float as "longitude",
                  radius_meters as "radiusMeters", active,
                  created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM work_locations
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           LIMIT 1`,
          [companyId, id],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  async listLocations(
    companyId: string,
    filters?: { active?: boolean | undefined },
    poolOverride?: pg.Pool,
  ): Promise<WorkLocationRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const wheres: string[] = ['company_id = $1', 'deleted_at IS NULL'];
        const values: unknown[] = [companyId];

        if (filters?.active !== undefined) {
          wheres.push(`active = $${values.length + 1}`);
          values.push(filters.active);
        }

        const res = await client.query<WorkLocationRow>(
          `SELECT id, company_id as "companyId", name, code, address, timezone,
                  ST_Y(center::geometry)::float as "latitude",
                  ST_X(center::geometry)::float as "longitude",
                  radius_meters as "radiusMeters", active,
                  created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM work_locations
           WHERE ${wheres.join(' AND ')}
           ORDER BY name ASC`,
          values,
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  async updateLocation(
    companyId: string,
    id: string,
    data: {
      name?: string | undefined;
      code?: string | undefined;
      address?: LocationAddress | undefined;
      timezone?: string | undefined;
      latitude?: number | null | undefined;
      longitude?: number | null | undefined;
      radiusMeters?: number | null | undefined;
      active?: boolean | undefined;
      userId?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<WorkLocationRow | null> {
    return withTenant(
      {
        companyId,
        ...(data.userId ? { userId: data.userId } : {}),
      },
      async (_tx, client) => {
        const sets: string[] = [
          'updated_at = now()',
          'row_version = row_version + 1',
        ];
        const values: unknown[] = [companyId, id];
        let pIdx = 3;

        if (data.name !== undefined) {
          sets.push(`name = $${pIdx++}`);
          values.push(data.name);
        }
        if (data.code !== undefined) {
          sets.push(`code = $${pIdx++}`);
          values.push(data.code.toUpperCase());
        }
        if (data.address !== undefined) {
          sets.push(`address = $${pIdx++}`);
          values.push(JSON.stringify(data.address));
        }
        if (data.timezone !== undefined) {
          sets.push(`timezone = $${pIdx++}`);
          values.push(data.timezone);
        }
        if (data.radiusMeters !== undefined) {
          sets.push(`radius_meters = $${pIdx++}`);
          values.push(data.radiusMeters);
        }
        if (data.active !== undefined) {
          sets.push(`active = $${pIdx++}`);
          values.push(data.active);
        }
        if (data.userId !== undefined) {
          sets.push(`updated_by = $${pIdx++}`);
          values.push(data.userId);
        }

        // Center / geofence handling
        if (data.latitude !== undefined || data.longitude !== undefined) {
          const latIdx = pIdx++;
          const lonIdx = pIdx++;
          values.push(data.latitude ?? null);
          values.push(data.longitude ?? null);
          sets.push(
            `center = CASE WHEN $${latIdx}::numeric IS NOT NULL AND $${lonIdx}::numeric IS NOT NULL
                           THEN ST_SetSRID(ST_MakePoint($${lonIdx}::numeric, $${latIdx}::numeric), 4326)::geography
                           ELSE NULL END`,
          );
        }

        const res = await client.query<WorkLocationRow>(
          `UPDATE work_locations
           SET ${sets.join(', ')}
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING id, company_id as "companyId", name, code, address, timezone,
                     ST_Y(center::geometry)::float as "latitude",
                     ST_X(center::geometry)::float as "longitude",
                     radius_meters as "radiusMeters", active,
                     created_at as "createdAt", updated_at as "updatedAt",
                     deleted_at as "deletedAt", row_version as "rowVersion"`,
          values,
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  async deleteLocation(
    companyId: string,
    id: string,
    userId?: string | undefined,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      { companyId, ...(userId ? { userId } : {}) },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE work_locations
           SET deleted_at = now(),
               updated_by = $3,
               updated_at = now(),
               row_version = row_version + 1
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id, userId || null],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }

  // --------------------------------------------------------------------------
  // Org Chart
  // --------------------------------------------------------------------------
  async getOrgChartNodes(
    companyId: string,
    parentId?: string | null | undefined,
    poolOverride?: pg.Pool,
  ): Promise<OrgChartNodeRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<OrgChartNodeRow>(
          `SELECT
             e.id,
             e.emp_code as "empCode",
             e.first_name as "firstName",
             e.last_name as "lastName",
             e.first_name || ' ' || e.last_name as "fullName",
             e.email_work as "workEmail",
             e.department_id as "departmentId",
             d.name as "departmentName",
             e.designation_id as "designationId",
             des.name as "designationName",
             e.manager_id as "managerId",
             (
               SELECT count(*)::int
               FROM employees rep
               WHERE rep.company_id = e.company_id
                 AND rep.manager_id = e.id
                 AND rep.deleted_at IS NULL
                 AND rep.status = 'active'
             ) as "directReportsCount"
           FROM employees e
           LEFT JOIN departments d ON d.id = e.department_id AND d.company_id = e.company_id AND d.deleted_at IS NULL
           LEFT JOIN designations des ON des.id = e.designation_id AND des.company_id = e.company_id AND des.deleted_at IS NULL
           WHERE e.company_id = $1
             AND e.deleted_at IS NULL
             AND e.status = 'active'
             AND (
               ($2::uuid IS NULL AND (e.manager_id IS NULL OR e.manager_id NOT IN (
                 SELECT m.id FROM employees m WHERE m.company_id = e.company_id AND m.deleted_at IS NULL AND m.status = 'active'
               )))
               OR ($2::uuid IS NOT NULL AND e.manager_id = $2::uuid)
             )
           ORDER BY e.first_name ASC, e.last_name ASC`,
          [companyId, parentId || null],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  async searchOrgChart(
    companyId: string,
    query: string,
    poolOverride?: pg.Pool,
  ): Promise<OrgChartNodeRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<OrgChartNodeRow>(
          `SELECT
             e.id,
             e.emp_code as "empCode",
             e.first_name as "firstName",
             e.last_name as "lastName",
             e.first_name || ' ' || e.last_name as "fullName",
             e.email_work as "workEmail",
             e.department_id as "departmentId",
             d.name as "departmentName",
             e.designation_id as "designationId",
             des.name as "designationName",
             e.manager_id as "managerId",
             e.reporting_path as "reportingPath",
             (
               SELECT count(*)::int
               FROM employees rep
               WHERE rep.company_id = e.company_id
                 AND rep.manager_id = e.id
                 AND rep.deleted_at IS NULL
                 AND rep.status = 'active'
             ) as "directReportsCount"
           FROM employees e
           LEFT JOIN departments d ON d.id = e.department_id AND d.company_id = e.company_id AND d.deleted_at IS NULL
           LEFT JOIN designations des ON des.id = e.designation_id AND des.company_id = e.company_id AND des.deleted_at IS NULL
           WHERE e.company_id = $1
             AND e.deleted_at IS NULL
             AND e.status = 'active'
             AND (
               e.first_name ILIKE '%' || $2 || '%'
               OR e.last_name ILIKE '%' || $2 || '%'
               OR (e.first_name || ' ' || e.last_name) ILIKE '%' || $2 || '%'
               OR e.email_work ILIKE '%' || $2 || '%'
               OR e.emp_code ILIKE '%' || $2 || '%'
             )
           ORDER BY e.first_name ASC, e.last_name ASC
           LIMIT 20`,
          [companyId, query.trim()],
        );
        return res.rows;
      },
      poolOverride,
    );
  }
}

