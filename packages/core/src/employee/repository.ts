import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';

export interface EmployeeRow {
  id: string;
  companyId: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  dob: string | null;
  gender: string | null;
  maritalStatus: string | null;
  emailWork: string;
  emailPersonal: string | null;
  phone: string | null;
  addresses: Record<string, unknown>;
  emergencyContacts: Array<Record<string, unknown>>;
  departmentId: string | null;
  departmentName?: string | null;
  designationId: string | null;
  designationName?: string | null;
  gradeId: string | null;
  costCenterId: string | null;
  locationId: string | null;
  locationName?: string | null;
  managerId: string | null;
  managerName?: string | null;
  employmentType: string;
  doj: string;
  confirmationDate: string | null;
  status: string;
  jobEffectiveFrom: string;
  reportingPath: string[];
  bankEnc: string | null;
  panEnc: string | null;
  panBlindIdx: string | null;
  aadhaarEnc: string | null;
  customFields: Record<string, unknown>;
  userId: string | null;
  searchKey: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export interface EmployeeHistoryRow {
  id: string;
  companyId: string;
  employeeId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  effectiveFrom: string;
  appliedAt: Date | null;
  changedBy: string;
  reason: string | null;
  createdAt: Date;
}

export interface DirectoryEmployeeRow {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  emailWork: string;
  phone: string | null;
  departmentId: string | null;
  departmentName: string | null;
  designationId: string | null;
  designationName: string | null;
  locationId: string | null;
  locationName: string | null;
  status: string;
  employmentType: string;
  doj: string;
  createdAt: Date;
}

export interface DirectoryQueryParams {
  search?: string | undefined;
  departmentId?: string | undefined;
  locationId?: string | undefined;
  designationId?: string | undefined;
  status?: string | undefined;
  cursor?: string | undefined; // id cursor
  limit?: number | undefined;
}

export class EmployeeRepository {
  /**
   * Atomically increments the employee code sequence using counters row-level locking.
   */
  async getNextEmpCode(companyId: string, poolOverride?: pg.Pool): Promise<string> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{ seq: string | number }>(
          `SELECT next_counter_seq($1, 'emp_code') as seq`,
          [companyId],
        );
        const seqNum = Number(res.rows[0]?.seq || 1);
        return `EMP-${String(seqNum).padStart(5, '0')}`;
      },
      poolOverride,
    );
  }

  /**
   * Inserts a new employee record.
   */
  async createEmployee(
    params: {
      companyId: string;
      empCode: string;
      firstName: string;
      lastName: string;
      dob?: string | null | undefined;
      gender?: string | null | undefined;
      maritalStatus?: string | null | undefined;
      emailWork: string;
      emailPersonal?: string | null | undefined;
      phone?: string | null | undefined;
      addresses?: Record<string, unknown> | undefined;
      emergencyContacts?: Array<Record<string, unknown>> | undefined;
      departmentId?: string | null | undefined;
      designationId?: string | null | undefined;
      gradeId?: string | null | undefined;
      costCenterId?: string | null | undefined;
      locationId?: string | null | undefined;
      managerId?: string | null | undefined;
      employmentType?: string | undefined;
      doj: string;
      confirmationDate?: string | null | undefined;
      status?: string | undefined;
      jobEffectiveFrom: string;
      reportingPath: string[];
      bankEnc?: string | null | undefined;
      panEnc?: string | null | undefined;
      panBlindIdx?: string | null | undefined;
      aadhaarEnc?: string | null | undefined;
      customFields?: Record<string, unknown> | undefined;
      userId?: string | null | undefined;
      searchKey: string;
      actorId: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<EmployeeRow> {
    const id = generateUuidV7();
    return withTenant(
      { companyId: params.companyId, userId: params.actorId },
      async (_tx, client) => {
        const res = await client.query<EmployeeRow>(
          `INSERT INTO employees (
             id, company_id, emp_code, first_name, last_name, dob, gender, marital_status,
             email_work, email_personal, phone, addresses, emergency_contacts,
             department_id, designation_id, grade_id, cost_center_id, location_id, manager_id,
             employment_type, doj, confirmation_date, status, job_effective_from, reporting_path,
             bank_enc, pan_enc, pan_blind_idx, aadhaar_enc, custom_fields, user_id, search_key,
             created_by, updated_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19,
             $20, $21, $22, $23, $24, $25,
             $26, $27, $28, $29, $30, $31, $32,
             $33, $33
           )
           RETURNING id, company_id as "companyId", emp_code as "empCode", first_name as "firstName",
                     last_name as "lastName", first_name || ' ' || last_name as "fullName",
                     dob, gender, marital_status as "maritalStatus", email_work as "emailWork",
                     email_personal as "emailPersonal", phone, addresses,
                     emergency_contacts as "emergencyContacts", department_id as "departmentId",
                     designation_id as "designationId", grade_id as "gradeId",
                     cost_center_id as "costCenterId", location_id as "locationId",
                     manager_id as "managerId", employment_type as "employmentType",
                     doj, confirmation_date as "confirmationDate", status,
                     job_effective_from as "jobEffectiveFrom", reporting_path as "reportingPath",
                     bank_enc as "bankEnc", pan_enc as "panEnc", pan_blind_idx as "panBlindIdx",
                     aadhaar_enc as "aadhaarEnc", custom_fields as "customFields",
                     user_id as "userId", search_key as "searchKey",
                     created_at as "createdAt", updated_at as "updatedAt",
                     deleted_at as "deletedAt", row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.empCode,
            params.firstName,
            params.lastName,
            params.dob || null,
            params.gender || null,
            params.maritalStatus || null,
            params.emailWork.toLowerCase(),
            params.emailPersonal ? params.emailPersonal.toLowerCase() : null,
            params.phone || null,
            JSON.stringify(params.addresses || {}),
            JSON.stringify(params.emergencyContacts || []),
            params.departmentId || null,
            params.designationId || null,
            params.gradeId || null,
            params.costCenterId || null,
            params.locationId || null,
            params.managerId || null,
            params.employmentType || 'full_time',
            params.doj,
            params.confirmationDate || null,
            params.status || 'active',
            params.jobEffectiveFrom,
            params.reportingPath,
            params.bankEnc || null,
            params.panEnc || null,
            params.panBlindIdx || null,
            params.aadhaarEnc || null,
            JSON.stringify(params.customFields || {}),
            params.userId || null,
            params.searchKey.toLowerCase(),
            params.actorId,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  /**
   * Finds an employee by ID including joined department/designation names.
   */
  async findById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<EmployeeRow>(
          `SELECT
             e.id, e.company_id as "companyId", e.emp_code as "empCode", e.first_name as "firstName",
             e.last_name as "lastName", e.first_name || ' ' || e.last_name as "fullName",
             e.dob, e.gender, e.marital_status as "maritalStatus", e.email_work as "emailWork",
             e.email_personal as "emailPersonal", e.phone, e.addresses,
             e.emergency_contacts as "emergencyContacts", e.department_id as "departmentId",
             d.name as "departmentName", e.designation_id as "designationId",
             des.name as "designationName", e.grade_id as "gradeId",
             e.cost_center_id as "costCenterId", e.location_id as "locationId",
             loc.name as "locationName", e.manager_id as "managerId",
             m.first_name || ' ' || m.last_name as "managerName",
             e.employment_type as "employmentType", e.doj, e.confirmation_date as "confirmationDate",
             e.status, e.job_effective_from as "jobEffectiveFrom", e.reporting_path as "reportingPath",
             e.bank_enc as "bankEnc", e.pan_enc as "panEnc", e.pan_blind_idx as "panBlindIdx",
             e.aadhaar_enc as "aadhaarEnc", e.custom_fields as "customFields",
             e.user_id as "userId", e.search_key as "searchKey",
             e.created_at as "createdAt", e.updated_at as "updatedAt",
             e.deleted_at as "deletedAt", e.row_version as "rowVersion"
           FROM employees e
           LEFT JOIN departments d ON d.id = e.department_id AND d.company_id = e.company_id AND d.deleted_at IS NULL
           LEFT JOIN designations des ON des.id = e.designation_id AND des.company_id = e.company_id AND des.deleted_at IS NULL
           LEFT JOIN work_locations loc ON loc.id = e.location_id AND loc.company_id = e.company_id AND loc.deleted_at IS NULL
           LEFT JOIN employees m ON m.id = e.manager_id AND m.company_id = e.company_id AND m.deleted_at IS NULL
           WHERE e.company_id = $1 AND e.id = $2 AND e.deleted_at IS NULL
           LIMIT 1`,
          [companyId, id],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  /**
   * Finds employee by PAN blind index for duplicate verification.
   */
  async findByPanBlindIndex(
    companyId: string,
    panBlindIdx: string,
    excludeId?: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const wheres = ['company_id = $1', 'pan_blind_idx = $2', 'deleted_at IS NULL'];
        const values: unknown[] = [companyId, panBlindIdx];
        if (excludeId) {
          wheres.push(`id != $3`);
          values.push(excludeId);
        }
        const res = await client.query<EmployeeRow>(
          `SELECT id, emp_code as "empCode" FROM employees WHERE ${wheres.join(' AND ')} LIMIT 1`,
          values,
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  /**
   * Lists employees with filtering and pagination.
   */
  async listEmployees(
    companyId: string,
    params: {
      query?: string | undefined;
      departmentId?: string | undefined;
      locationId?: string | undefined;
      status?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined; // id cursor
    },
    poolOverride?: pg.Pool,
  ): Promise<EmployeeRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const wheres: string[] = ['e.company_id = $1', 'e.deleted_at IS NULL'];
        const values: unknown[] = [companyId];
        let pIdx = 2;

        if (params.query && params.query.trim()) {
          wheres.push(`e.search_key ILIKE '%' || $${pIdx++} || '%'`);
          values.push(params.query.trim().toLowerCase());
        }

        if (params.departmentId) {
          wheres.push(`e.department_id = $${pIdx++}`);
          values.push(params.departmentId);
        }

        if (params.locationId) {
          wheres.push(`e.location_id = $${pIdx++}`);
          values.push(params.locationId);
        }

        if (params.status) {
          wheres.push(`e.status = $${pIdx++}`);
          values.push(params.status);
        }

        if (params.cursor) {
          wheres.push(`e.id > $${pIdx++}`);
          values.push(params.cursor);
        }

        const limit = Math.min(params.limit || 50, 100);
        values.push(limit);

        const res = await client.query<EmployeeRow>(
          `SELECT
             e.id, e.company_id as "companyId", e.emp_code as "empCode", e.first_name as "firstName",
             e.last_name as "lastName", e.first_name || ' ' || e.last_name as "fullName",
             e.dob, e.gender, e.marital_status as "maritalStatus", e.email_work as "emailWork",
             e.email_personal as "emailPersonal", e.phone, e.addresses,
             e.emergency_contacts as "emergencyContacts", e.department_id as "departmentId",
             d.name as "departmentName", e.designation_id as "designationId",
             des.name as "designationName", e.grade_id as "gradeId",
             e.cost_center_id as "costCenterId", e.location_id as "locationId",
             loc.name as "locationName", e.manager_id as "managerId",
             m.first_name || ' ' || m.last_name as "managerName",
             e.employment_type as "employmentType", e.doj, e.confirmation_date as "confirmationDate",
             e.status, e.job_effective_from as "jobEffectiveFrom", e.reporting_path as "reportingPath",
             e.bank_enc as "bankEnc", e.pan_enc as "panEnc", e.pan_blind_idx as "panBlindIdx",
             e.aadhaar_enc as "aadhaarEnc", e.custom_fields as "customFields",
             e.user_id as "userId", e.search_key as "searchKey",
             e.created_at as "createdAt", e.updated_at as "updatedAt",
             e.deleted_at as "deletedAt", e.row_version as "rowVersion"
           FROM employees e
           LEFT JOIN departments d ON d.id = e.department_id AND d.company_id = e.company_id AND d.deleted_at IS NULL
           LEFT JOIN designations des ON des.id = e.designation_id AND des.company_id = e.company_id AND des.deleted_at IS NULL
           LEFT JOIN work_locations loc ON loc.id = e.location_id AND loc.company_id = e.company_id AND loc.deleted_at IS NULL
           LEFT JOIN employees m ON m.id = e.manager_id AND m.company_id = e.company_id AND m.deleted_at IS NULL
           WHERE ${wheres.join(' AND ')}
           ORDER BY e.first_name ASC, e.last_name ASC, e.id ASC
           LIMIT $${pIdx}`,
          values,
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Fast directory projection with pg_trgm search, filtering, keyset pagination, and bounded count.
   */
  async getDirectory(
    companyId: string,
    params: DirectoryQueryParams,
    poolOverride?: pg.Pool,
  ): Promise<{ items: DirectoryEmployeeRow[]; nextCursor?: string | undefined; total: number }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const wheres: string[] = ['e.company_id = $1', 'e.deleted_at IS NULL'];
        const values: unknown[] = [companyId];
        let pIdx = 2;

        if (params.search && params.search.trim()) {
          wheres.push(`e.search_key ILIKE '%' || $${pIdx++} || '%'`);
          values.push(params.search.trim().toLowerCase());
        }

        if (params.departmentId) {
          wheres.push(`e.department_id = $${pIdx++}`);
          values.push(params.departmentId);
        }

        if (params.locationId) {
          wheres.push(`e.location_id = $${pIdx++}`);
          values.push(params.locationId);
        }

        if (params.designationId) {
          wheres.push(`e.designation_id = $${pIdx++}`);
          values.push(params.designationId);
        }

        if (params.status) {
          wheres.push(`e.status = $${pIdx++}`);
          values.push(params.status);
        }

        const countWheres = [...wheres];
        const countValues = [...values];

        if (params.cursor) {
          wheres.push(`e.id > $${pIdx++}`);
          values.push(params.cursor);
        }

        const limit = Math.min(params.limit || 50, 100);
        values.push(limit + 1);

        const sql = `
          SELECT
            e.id, e.emp_code as "empCode", e.first_name as "firstName", e.last_name as "lastName",
            e.first_name || ' ' || e.last_name as "fullName", e.email_work as "emailWork",
            e.phone, e.department_id as "departmentId", d.name as "departmentName",
            e.designation_id as "designationId", des.name as "designationName",
            e.location_id as "locationId", loc.name as "locationName",
            e.status, e.employment_type as "employmentType", e.doj, e.created_at as "createdAt"
          FROM employees e
          LEFT JOIN departments d ON d.id = e.department_id AND d.company_id = e.company_id AND d.deleted_at IS NULL
          LEFT JOIN designations des ON des.id = e.designation_id AND des.company_id = e.company_id AND des.deleted_at IS NULL
          LEFT JOIN work_locations loc ON loc.id = e.location_id AND loc.company_id = e.company_id AND loc.deleted_at IS NULL
          WHERE ${wheres.join(' AND ')}
          ORDER BY e.first_name ASC, e.last_name ASC, e.id ASC
          LIMIT $${pIdx}
        `;

        const [itemsRes, countRes] = await Promise.all([
          client.query<DirectoryEmployeeRow>(sql, values),
          client.query<{ count: string }>(
            `SELECT COUNT(*)::text as count FROM (
               SELECT 1 FROM employees e WHERE ${countWheres.join(' AND ')} LIMIT 1001
             ) sub`,
            countValues,
          ),
        ]);

        const hasMore = itemsRes.rows.length > limit;
        const items = hasMore ? itemsRes.rows.slice(0, limit) : itemsRes.rows;
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : undefined;
        const total = parseInt(countRes.rows[0]?.count || '0', 10);

        return { items, nextCursor, total };
      },
      poolOverride,
    );
  }

  /**
   * Computes the maximum subtree depth underneath an employee.
   */
  async getMaxSubtreeDepth(companyId: string, employeeId: string, poolOverride?: pg.Pool): Promise<number> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{ maxDepth: number }>(
          `SELECT COALESCE(MAX(cardinality(reporting_path)), 0) as "maxDepth"
           FROM employees
           WHERE company_id = $1
             AND reporting_path @> ARRAY[$2::uuid]::uuid[]
             AND deleted_at IS NULL`,
          [companyId, employeeId],
        );
        return Number(res.rows[0]?.maxDepth || 0);
      },
      poolOverride,
    );
  }

  /**
   * Atomically updates an employee's manager and reparents the entire descendant subtree.
   */
  async updateReportingHierarchy(
    params: {
      companyId: string;
      employeeId: string;
      newManagerId: string | null;
      newReportingPath: string[];
      oldPrefix: string[];
      actorId: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<void> {
    return withTenant(
      { companyId: params.companyId, userId: params.actorId },
      async (_tx, client) => {
        // 1. Lock employee
        await client.query(
          `SELECT id FROM employees WHERE company_id = $1 AND id = $2 FOR UPDATE`,
          [params.companyId, params.employeeId],
        );

        // 2. Update employee's manager and reporting_path
        await client.query(
          `UPDATE employees
           SET manager_id = $3,
               reporting_path = $4::uuid[],
               updated_by = $5,
               updated_at = NOW(),
               row_version = row_version + 1
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [
            params.companyId,
            params.employeeId,
            params.newManagerId,
            params.newReportingPath,
            params.actorId,
          ],
        );

        // 3. Atomically reparent all descendant subtrees
        // New prefix for children = [...newReportingPath, employeeId]
        const newPrefix = [...params.newReportingPath, params.employeeId];
        const oldPrefixLength = params.oldPrefix.length;

        // In Postgres array slicing: reporting_path[oldPrefixLength + 1 :]
        await client.query(
          `UPDATE employees
           SET reporting_path = $1::uuid[] || reporting_path[$2::int :],
               updated_by = $3,
               updated_at = NOW(),
               row_version = row_version + 1
           WHERE company_id = $4
             AND reporting_path @> ARRAY[$5::uuid]::uuid[]
             AND id != $5
             AND deleted_at IS NULL`,
          [
            newPrefix,
            oldPrefixLength + 1,
            params.actorId,
            params.companyId,
            params.employeeId,
          ],
        );
      },
      poolOverride,
    );
  }

  /**
   * Updates basic profile and job fields.
   */
  async updateEmployee(
    params: {
      companyId: string;
      id: string;
      data: Partial<EmployeeRow>;
      actorId: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<EmployeeRow | null> {
    return withTenant(
      { companyId: params.companyId, userId: params.actorId },
      async (_tx, client) => {
        const sets: string[] = ['updated_at = NOW()', 'row_version = row_version + 1', 'updated_by = $3'];
        const values: unknown[] = [params.companyId, params.id, params.actorId];
        let pIdx = 4;

        const { data } = params;
        if (data.firstName !== undefined) {
          sets.push(`first_name = $${pIdx++}`);
          values.push(data.firstName);
        }
        if (data.lastName !== undefined) {
          sets.push(`last_name = $${pIdx++}`);
          values.push(data.lastName);
        }
        if (data.emailWork !== undefined) {
          sets.push(`email_work = $${pIdx++}`);
          values.push(data.emailWork.toLowerCase());
        }
        if (data.emailPersonal !== undefined) {
          sets.push(`email_personal = $${pIdx++}`);
          values.push(data.emailPersonal ? data.emailPersonal.toLowerCase() : null);
        }
        if (data.phone !== undefined) {
          sets.push(`phone = $${pIdx++}`);
          values.push(data.phone);
        }
        if (data.addresses !== undefined) {
          sets.push(`addresses = $${pIdx++}`);
          values.push(JSON.stringify(data.addresses));
        }
        if (data.emergencyContacts !== undefined) {
          sets.push(`emergency_contacts = $${pIdx++}`);
          values.push(JSON.stringify(data.emergencyContacts));
        }
        if (data.departmentId !== undefined) {
          sets.push(`department_id = $${pIdx++}`);
          values.push(data.departmentId);
        }
        if (data.designationId !== undefined) {
          sets.push(`designation_id = $${pIdx++}`);
          values.push(data.designationId);
        }
        if (data.gradeId !== undefined) {
          sets.push(`grade_id = $${pIdx++}`);
          values.push(data.gradeId);
        }
        if (data.costCenterId !== undefined) {
          sets.push(`cost_center_id = $${pIdx++}`);
          values.push(data.costCenterId);
        }
        if (data.locationId !== undefined) {
          sets.push(`location_id = $${pIdx++}`);
          values.push(data.locationId);
        }
        if (data.status !== undefined) {
          sets.push(`status = $${pIdx++}`);
          values.push(data.status);
        }
        if (data.searchKey !== undefined) {
          sets.push(`search_key = $${pIdx++}`);
          values.push(data.searchKey.toLowerCase());
        }
        if (data.bankEnc !== undefined) {
          sets.push(`bank_enc = $${pIdx++}`);
          values.push(data.bankEnc);
        }
        if (data.panEnc !== undefined) {
          sets.push(`pan_enc = $${pIdx++}`);
          values.push(data.panEnc);
        }
        if (data.panBlindIdx !== undefined) {
          sets.push(`pan_blind_idx = $${pIdx++}`);
          values.push(data.panBlindIdx);
        }
        if (data.aadhaarEnc !== undefined) {
          sets.push(`aadhaar_enc = $${pIdx++}`);
          values.push(data.aadhaarEnc);
        }

        const res = await client.query<EmployeeRow>(
          `UPDATE employees
           SET ${sets.join(', ')}
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING id, company_id as "companyId", emp_code as "empCode", first_name as "firstName",
                     last_name as "lastName", first_name || ' ' || last_name as "fullName",
                     dob, gender, marital_status as "maritalStatus", email_work as "emailWork",
                     email_personal as "emailPersonal", phone, addresses,
                     emergency_contacts as "emergencyContacts", department_id as "departmentId",
                     designation_id as "designationId", grade_id as "gradeId",
                     cost_center_id as "costCenterId", location_id as "locationId",
                     manager_id as "managerId", employment_type as "employmentType",
                     doj, confirmation_date as "confirmationDate", status,
                     job_effective_from as "jobEffectiveFrom", reporting_path as "reportingPath",
                     bank_enc as "bankEnc", pan_enc as "panEnc", pan_blind_idx as "panBlindIdx",
                     aadhaar_enc as "aadhaarEnc", custom_fields as "customFields",
                     user_id as "userId", search_key as "searchKey",
                     created_at as "createdAt", updated_at as "updatedAt",
                     deleted_at as "deletedAt", row_version as "rowVersion"`,
          values,
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  /**
   * Records effective-dated job change in employee_history.
   */
  async insertHistory(
    params: {
      companyId: string;
      employeeId: string;
      field: string;
      oldValue: unknown;
      newValue: unknown;
      effectiveFrom: string;
      appliedAt: Date | null;
      changedBy: string;
      reason?: string | null | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<EmployeeHistoryRow> {
    const id = generateUuidV7();
    return withTenant(
      { companyId: params.companyId, userId: params.changedBy },
      async (_tx, client) => {
        const res = await client.query<EmployeeHistoryRow>(
          `INSERT INTO employee_history (
             id, company_id, employee_id, field, old_value, new_value,
             effective_from, applied_at, changed_by, reason, created_by, updated_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $9
           )
           RETURNING id, company_id as "companyId", employee_id as "employeeId",
                     field, old_value as "oldValue", new_value as "newValue",
                     effective_from as "effectiveFrom", applied_at as "appliedAt",
                     changed_by as "changedBy", reason, created_at as "createdAt"`,
          [
            id,
            params.companyId,
            params.employeeId,
            params.field,
            JSON.stringify(params.oldValue),
            JSON.stringify(params.newValue),
            params.effectiveFrom,
            params.appliedAt,
            params.changedBy,
            params.reason || null,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  /**
   * Retrieves full effective-dated timeline for an employee.
   */
  async getEmployeeHistory(
    companyId: string,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeHistoryRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<EmployeeHistoryRow>(
          `SELECT id, company_id as "companyId", employee_id as "employeeId",
                  field, old_value as "oldValue", new_value as "newValue",
                  effective_from as "effectiveFrom", applied_at as "appliedAt",
                  changed_by as "changedBy", reason, created_at as "createdAt"
           FROM employee_history
           WHERE company_id = $1 AND employee_id = $2 AND deleted_at IS NULL
           ORDER BY effective_from DESC, created_at DESC`,
          [companyId, employeeId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Gets pending scheduled changes whose effective_from has arrived.
   */
  async getPendingScheduledChanges(
    companyId: string,
    targetDate: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeHistoryRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<EmployeeHistoryRow>(
          `SELECT id, company_id as "companyId", employee_id as "employeeId",
                  field, old_value as "oldValue", new_value as "newValue",
                  effective_from as "effectiveFrom", applied_at as "appliedAt",
                  changed_by as "changedBy", reason, created_at as "createdAt"
           FROM employee_history
           WHERE company_id = $1 AND effective_from <= $2 AND applied_at IS NULL AND deleted_at IS NULL
           ORDER BY effective_from ASC, created_at ASC`,
          [companyId, targetDate],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Marks a scheduled change as applied.
   */
  async markHistoryApplied(
    companyId: string,
    historyId: string,
    actorId: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    return withTenant(
      { companyId, userId: actorId },
      async (_tx, client) => {
        await client.query(
          `UPDATE employee_history
           SET applied_at = NOW(),
               updated_by = $3,
               updated_at = NOW()
           WHERE company_id = $1 AND id = $2`,
          [companyId, historyId, actorId],
        );
      },
      poolOverride,
    );
  }
}
