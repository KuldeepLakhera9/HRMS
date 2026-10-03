import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';

export interface ImportRowError {
  row: number;
  empCode?: string | undefined;
  column?: string | undefined;
  message: string;
  value?: unknown | undefined;
}

export interface ImportJobRow {
  id: string;
  companyId: string;
  fileId: string | null;
  entity: string;
  status: 'pending' | 'validated' | 'processing' | 'completed' | 'failed';
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
  summary: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  rowVersion: number;
}

export interface EmployeeUpsertRow {
  empCode: string;
  firstName: string;
  lastName: string;
  dob?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  emailWork: string;
  emailPersonal?: string | null;
  phone?: string | null;
  addresses?: Record<string, unknown>;
  emergencyContacts?: Array<Record<string, unknown>>;
  departmentId?: string | null;
  designationId?: string | null;
  gradeId?: string | null;
  costCenterId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  employmentType: string;
  doj: string;
  confirmationDate?: string | null;
  status: string;
  jobEffectiveFrom?: string;
  reportingPath?: string[];
  bankEnc?: string | null;
  panEnc?: string | null;
  panBlindIdx?: string | null;
  aadhaarEnc?: string | null;
  customFields?: Record<string, unknown>;
  searchKey: string;
}

export class BulkRepository {
  async createJob(
    params: {
      companyId: string;
      actorId: string;
      entity?: string;
      fileId?: string | null;
      status?: 'pending' | 'validated' | 'processing' | 'completed' | 'failed';
      totalRows?: number;
      validRows?: number;
      errorRows?: number;
      errors?: ImportRowError[];
      summary?: Record<string, unknown>;
    },
    poolOverride?: pg.Pool,
  ): Promise<ImportJobRow> {
    const id = generateUuidV7();
    return withTenant(
      { companyId: params.companyId, userId: params.actorId },
      async (_tx, client) => {
        const res = await client.query<ImportJobRow>(
          `INSERT INTO import_jobs (
             id, company_id, file_id, entity, status, total_rows, valid_rows, error_rows,
             errors, summary, created_by, updated_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11
           )
           RETURNING
             id, company_id as "companyId", file_id as "fileId", entity, status,
             total_rows as "totalRows", valid_rows as "validRows", error_rows as "errorRows",
             errors, summary, created_at as "createdAt", updated_at as "updatedAt",
             created_by as "createdBy", updated_by as "updatedBy", row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.fileId || null,
            params.entity || 'employee',
            params.status || 'pending',
            params.totalRows || 0,
            params.validRows || 0,
            params.errorRows || 0,
            JSON.stringify(params.errors || []),
            JSON.stringify(params.summary || {}),
            params.actorId,
          ],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  async findJobById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<ImportJobRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<ImportJobRow>(
          `SELECT
             id, company_id as "companyId", file_id as "fileId", entity, status,
             total_rows as "totalRows", valid_rows as "validRows", error_rows as "errorRows",
             errors, summary, created_at as "createdAt", updated_at as "updatedAt",
             created_by as "createdBy", updated_by as "updatedBy", row_version as "rowVersion"
           FROM import_jobs
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  async updateJob(
    companyId: string,
    id: string,
    updates: {
      status?: 'pending' | 'validated' | 'processing' | 'completed' | 'failed';
      totalRows?: number;
      validRows?: number;
      errorRows?: number;
      errors?: ImportRowError[];
      summary?: Record<string, unknown>;
      actorId: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<ImportJobRow | null> {
    return withTenant(
      { companyId, userId: updates.actorId },
      async (_tx, client) => {
        const setClauses: string[] = ['updated_at = NOW()', 'updated_by = $3'];
        const values: unknown[] = [companyId, id, updates.actorId];
        let pIndex = 4;

        if (updates.status !== undefined) {
          setClauses.push(`status = $${pIndex++}`);
          values.push(updates.status);
        }
        if (updates.totalRows !== undefined) {
          setClauses.push(`total_rows = $${pIndex++}`);
          values.push(updates.totalRows);
        }
        if (updates.validRows !== undefined) {
          setClauses.push(`valid_rows = $${pIndex++}`);
          values.push(updates.validRows);
        }
        if (updates.errorRows !== undefined) {
          setClauses.push(`error_rows = $${pIndex++}`);
          values.push(updates.errorRows);
        }
        if (updates.errors !== undefined) {
          setClauses.push(`errors = $${pIndex++}`);
          values.push(JSON.stringify(updates.errors));
        }
        if (updates.summary !== undefined) {
          setClauses.push(`summary = $${pIndex++}`);
          values.push(JSON.stringify(updates.summary));
        }

        const res = await client.query<ImportJobRow>(
          `UPDATE import_jobs
           SET ${setClauses.join(', ')}
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING
             id, company_id as "companyId", file_id as "fileId", entity, status,
             total_rows as "totalRows", valid_rows as "validRows", error_rows as "errorRows",
             errors, summary, created_at as "createdAt", updated_at as "updatedAt",
             created_by as "createdBy", updated_by as "updatedBy", row_version as "rowVersion"`,
          values,
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  async listJobs(
    companyId: string,
    limit = 20,
    poolOverride?: pg.Pool,
  ): Promise<ImportJobRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<ImportJobRow>(
          `SELECT
             id, company_id as "companyId", file_id as "fileId", entity, status,
             total_rows as "totalRows", valid_rows as "validRows", error_rows as "errorRows",
             errors, summary, created_at as "createdAt", updated_at as "updatedAt",
             created_by as "createdBy", updated_by as "updatedBy", row_version as "rowVersion"
           FROM import_jobs
           WHERE company_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC
           LIMIT $2`,
          [companyId, limit],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Batched idempotent upsert of employees in chunks up to 500 rows.
   * Multi-row INSERT ... ON CONFLICT (company_id, emp_code) DO UPDATE inside transactions.
   */
  async batchUpsertEmployees(
    companyId: string,
    rows: EmployeeUpsertRow[],
    actorId: string,
    chunkSize = 500,
    poolOverride?: pg.Pool,
  ): Promise<{ inserted: number; updated: number }> {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    let totalProcessed = 0;

    for (let c = 0; c < rows.length; c += chunkSize) {
      const chunk = rows.slice(c, c + chunkSize);

      await withTenant(
        { companyId, userId: actorId },
        async (_tx, client) => {
          // Construct parameterized multi-row insert query
          const valueClauses: string[] = [];
          const params: unknown[] = [companyId, actorId];
          let paramIdx = 3;

          for (const row of chunk) {
            const id = generateUuidV7();
            const placeholders: string[] = [];

            // 1: id
            placeholders.push(`$${paramIdx++}`);
            params.push(id);

            // 2: company_id ($1)
            placeholders.push('$1');

            // 3: emp_code
            placeholders.push(`$${paramIdx++}`);
            params.push(row.empCode);

            // 4: first_name
            placeholders.push(`$${paramIdx++}`);
            params.push(row.firstName);

            // 5: last_name
            placeholders.push(`$${paramIdx++}`);
            params.push(row.lastName);

            // 6: dob
            placeholders.push(`$${paramIdx++}`);
            params.push(row.dob || null);

            // 7: gender
            placeholders.push(`$${paramIdx++}`);
            params.push(row.gender || null);

            // 8: marital_status
            placeholders.push(`$${paramIdx++}`);
            params.push(row.maritalStatus || null);

            // 9: email_work
            placeholders.push(`$${paramIdx++}`);
            params.push(row.emailWork.toLowerCase());

            // 10: email_personal
            placeholders.push(`$${paramIdx++}`);
            params.push(row.emailPersonal ? row.emailPersonal.toLowerCase() : null);

            // 11: phone
            placeholders.push(`$${paramIdx++}`);
            params.push(row.phone || null);

            // 12: addresses
            placeholders.push(`$${paramIdx++}`);
            params.push(JSON.stringify(row.addresses || {}));

            // 13: emergency_contacts
            placeholders.push(`$${paramIdx++}`);
            params.push(JSON.stringify(row.emergencyContacts || []));

            // 14: department_id
            placeholders.push(`$${paramIdx++}`);
            params.push(row.departmentId || null);

            // 15: designation_id
            placeholders.push(`$${paramIdx++}`);
            params.push(row.designationId || null);

            // 16: grade_id
            placeholders.push(`$${paramIdx++}`);
            params.push(row.gradeId || null);

            // 17: cost_center_id
            placeholders.push(`$${paramIdx++}`);
            params.push(row.costCenterId || null);

            // 18: location_id
            placeholders.push(`$${paramIdx++}`);
            params.push(row.locationId || null);

            // 19: manager_id
            placeholders.push(`$${paramIdx++}`);
            params.push(row.managerId || null);

            // 20: employment_type
            placeholders.push(`$${paramIdx++}`);
            params.push(row.employmentType || 'full_time');

            // 21: doj
            placeholders.push(`$${paramIdx++}`);
            params.push(row.doj);

            // 22: confirmation_date
            placeholders.push(`$${paramIdx++}`);
            params.push(row.confirmationDate || null);

            // 23: status
            placeholders.push(`$${paramIdx++}`);
            params.push(row.status || 'active');

            // 24: job_effective_from
            placeholders.push(`$${paramIdx++}`);
            params.push(row.jobEffectiveFrom || row.doj);

            // 25: reporting_path
            placeholders.push(`$${paramIdx++}`);
            params.push(row.reportingPath || []);

            // 26: bank_enc
            placeholders.push(`$${paramIdx++}`);
            params.push(row.bankEnc || null);

            // 27: pan_enc
            placeholders.push(`$${paramIdx++}`);
            params.push(row.panEnc || null);

            // 28: pan_blind_idx
            placeholders.push(`$${paramIdx++}`);
            params.push(row.panBlindIdx || null);

            // 29: aadhaar_enc
            placeholders.push(`$${paramIdx++}`);
            params.push(row.aadhaarEnc || null);

            // 30: custom_fields
            placeholders.push(`$${paramIdx++}`);
            params.push(JSON.stringify(row.customFields || {}));

            // 31: search_key
            placeholders.push(`$${paramIdx++}`);
            params.push(row.searchKey.toLowerCase());

            // 32: created_by ($2)
            placeholders.push('$2');

            // 33: updated_by ($2)
            placeholders.push('$2');

            valueClauses.push(`(${placeholders.join(', ')})`);
          }

          // Single SQL command with multi-row VALUES
          const sql = `
            INSERT INTO employees (
              id, company_id, emp_code, first_name, last_name, dob, gender, marital_status,
              email_work, email_personal, phone, addresses, emergency_contacts,
              department_id, designation_id, grade_id, cost_center_id, location_id, manager_id,
              employment_type, doj, confirmation_date, status, job_effective_from, reporting_path,
              bank_enc, pan_enc, pan_blind_idx, aadhaar_enc, custom_fields, search_key,
              created_by, updated_by
            )
            VALUES ${valueClauses.join(',\n')}
            ON CONFLICT (company_id, emp_code) DO UPDATE SET
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              dob = COALESCE(EXCLUDED.dob, employees.dob),
              gender = COALESCE(EXCLUDED.gender, employees.gender),
              marital_status = COALESCE(EXCLUDED.marital_status, employees.marital_status),
              email_work = EXCLUDED.email_work,
              email_personal = COALESCE(EXCLUDED.email_personal, employees.email_personal),
              phone = COALESCE(EXCLUDED.phone, employees.phone),
              department_id = COALESCE(EXCLUDED.department_id, employees.department_id),
              designation_id = COALESCE(EXCLUDED.designation_id, employees.designation_id),
              location_id = COALESCE(EXCLUDED.location_id, employees.location_id),
              employment_type = EXCLUDED.employment_type,
              doj = EXCLUDED.doj,
              status = EXCLUDED.status,
              bank_enc = COALESCE(EXCLUDED.bank_enc, employees.bank_enc),
              pan_enc = COALESCE(EXCLUDED.pan_enc, employees.pan_enc),
              pan_blind_idx = COALESCE(EXCLUDED.pan_blind_idx, employees.pan_blind_idx),
              aadhaar_enc = COALESCE(EXCLUDED.aadhaar_enc, employees.aadhaar_enc),
              custom_fields = employees.custom_fields || EXCLUDED.custom_fields,
              search_key = EXCLUDED.search_key,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW(),
              row_version = employees.row_version + 1
          `;

          await client.query(sql, params);
          totalProcessed += chunk.length;
        },
        poolOverride,
      );
    }

    return { inserted: totalProcessed, updated: 0 };
  }

  async getValidOrgEntityIds(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<{ departments: Set<string>; designations: Set<string>; locations: Set<string> }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const [d, des, l] = await Promise.all([
          client.query<{ id: string }>('SELECT id FROM departments WHERE company_id = $1 AND deleted_at IS NULL', [companyId]),
          client.query<{ id: string }>('SELECT id FROM designations WHERE company_id = $1 AND deleted_at IS NULL', [companyId]),
          client.query<{ id: string }>('SELECT id FROM locations WHERE company_id = $1 AND deleted_at IS NULL', [companyId]),
        ]);
        return {
          departments: new Set(d.rows.map(r => r.id)),
          designations: new Set(des.rows.map(r => r.id)),
          locations: new Set(l.rows.map(r => r.id)),
        };
      },
      poolOverride,
    );
  }

  async getEmployeesForExport(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<Array<{
    empCode: string;
    firstName: string;
    lastName: string;
    emailWork: string;
    phone: string | null;
    gender: string | null;
    dob: string | null;
    doj: string;
    status: string;
    employmentType: string;
    departmentName: string | null;
    designationName: string | null;
    locationName: string | null;
    panEnc: string | null;
    aadhaarEnc: string | null;
    bankEnc: string | null;
    customFields: Record<string, unknown>;
  }>> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{
          empCode: string;
          firstName: string;
          lastName: string;
          emailWork: string;
          phone: string | null;
          gender: string | null;
          dob: string | null;
          doj: string;
          status: string;
          employmentType: string;
          departmentName: string | null;
          designationName: string | null;
          locationName: string | null;
          panEnc: string | null;
          aadhaarEnc: string | null;
          bankEnc: string | null;
          customFields: Record<string, unknown>;
        }>(
          `SELECT
             e.emp_code as "empCode", e.first_name as "firstName", e.last_name as "lastName",
             e.email_work as "emailWork", e.phone, e.gender, e.dob, e.doj, e.status,
             e.employment_type as "employmentType",
             d.name as "departmentName", des.name as "designationName", loc.name as "locationName",
             e.pan_enc as "panEnc", e.aadhaar_enc as "aadhaarEnc", e.bank_enc as "bankEnc",
             e.custom_fields as "customFields"
           FROM employees e
           LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id AND d.deleted_at IS NULL
           LEFT JOIN designations des ON des.company_id = e.company_id AND des.id = e.designation_id AND des.deleted_at IS NULL
           LEFT JOIN locations loc ON loc.company_id = e.company_id AND loc.id = e.location_id AND loc.deleted_at IS NULL
           WHERE e.company_id = $1 AND e.deleted_at IS NULL
           ORDER BY e.emp_code ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }
}
