import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import type {
  CreateAttendancePolicyInput,
  UpdateAttendancePolicyInput,
  AssignAttendancePolicyInput,
} from './validation.js';

export interface AttendancePolicyRecord {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  geofenceMode: 'strict' | 'soft' | 'off';
  allowSelfie: boolean;
  requireSelfie: boolean;
  maxGpsAccuracyMeters: number;
  allowedSources: string[];
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  autoPunchOutHours: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttendancePolicyAssignmentRecord {
  id: string;
  companyId: string;
  policyId: string;
  priority: number;
  targetType: 'employee' | 'department' | 'location' | 'company';
  targetId: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: Date;
}

export interface EffectivePolicyResult {
  policy: AttendancePolicyRecord;
  assignment: {
    id: string;
    priority: number;
    targetType: string;
    targetId: string | null;
    validFrom: string;
    validTo: string | null;
  };
}

export class AttendancePolicyRepository {
  /**
   * Creates a new attendance policy.
   */
  async createPolicy(
    companyId: string,
    input: CreateAttendancePolicyInput & { createdBy: string },
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        const res = await client.query(
          `INSERT INTO attendance_policies (
            id, company_id, code, name, description, geofence_mode,
            allow_selfie, require_selfie, max_gps_accuracy_meters, allowed_sources,
            grace_minutes, half_day_minutes, full_day_minutes, auto_punch_out_hours,
            version, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, $15, $15
          )
          ON CONFLICT (company_id, code) DO UPDATE SET updated_at = NOW()
          RETURNING
            id, company_id as "companyId", code, name, description,
            geofence_mode as "geofenceMode", allow_selfie as "allowSelfie",
            require_selfie as "requireSelfie", max_gps_accuracy_meters as "maxGpsAccuracyMeters",
            allowed_sources as "allowedSources", grace_minutes as "graceMinutes",
            half_day_minutes as "halfDayMinutes", full_day_minutes as "fullDayMinutes",
            auto_punch_out_hours as "autoPunchOutHours", version,
            created_at as "createdAt", updated_at as "updatedAt"`,
          [
            id,
            companyId,
            input.code,
            input.name,
            input.description ?? null,
            input.geofenceMode,
            input.allowSelfie,
            input.requireSelfie,
            input.maxGpsAccuracyMeters,
            input.allowedSources,
            input.graceMinutes,
            input.halfDayMinutes,
            input.fullDayMinutes,
            input.autoPunchOutHours,
            input.createdBy,
          ],
        );
        return res.rows[0];
      },
      poolOverride,
    );
  }

  /**
   * Retrieves an attendance policy by its ID.
   */
  async getPolicyById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            id, company_id as "companyId", code, name, description,
            geofence_mode as "geofenceMode", allow_selfie as "allowSelfie",
            require_selfie as "requireSelfie", max_gps_accuracy_meters as "maxGpsAccuracyMeters",
            allowed_sources as "allowedSources", grace_minutes as "graceMinutes",
            half_day_minutes as "halfDayMinutes", full_day_minutes as "fullDayMinutes",
            auto_punch_out_hours as "autoPunchOutHours", version,
            created_at as "createdAt", updated_at as "updatedAt"
          FROM attendance_policies
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Retrieves an attendance policy by its code.
   */
  async getPolicyByCode(
    companyId: string,
    code: string,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            id, company_id as "companyId", code, name, description,
            geofence_mode as "geofenceMode", allow_selfie as "allowSelfie",
            require_selfie as "requireSelfie", max_gps_accuracy_meters as "maxGpsAccuracyMeters",
            allowed_sources as "allowedSources", grace_minutes as "graceMinutes",
            half_day_minutes as "halfDayMinutes", full_day_minutes as "fullDayMinutes",
            auto_punch_out_hours as "autoPunchOutHours", version,
            created_at as "createdAt", updated_at as "updatedAt"
          FROM attendance_policies
          WHERE company_id = $1 AND code = $2 AND deleted_at IS NULL`,
          [companyId, code],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Updates an existing attendance policy.
   */
  async updatePolicy(
    companyId: string,
    id: string,
    input: UpdateAttendancePolicyInput & { updatedBy: string },
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const setClauses: string[] = ['updated_at = NOW()', 'version = version + 1', 'updated_by = $3'];
        const values: unknown[] = [companyId, id, input.updatedBy];

        const fieldMap: Record<string, string> = {
          name: 'name',
          description: 'description',
          geofenceMode: 'geofence_mode',
          allowSelfie: 'allow_selfie',
          requireSelfie: 'require_selfie',
          maxGpsAccuracyMeters: 'max_gps_accuracy_meters',
          allowedSources: 'allowed_sources',
          graceMinutes: 'grace_minutes',
          halfDayMinutes: 'half_day_minutes',
          fullDayMinutes: 'full_day_minutes',
          autoPunchOutHours: 'auto_punch_out_hours',
        };

        for (const [key, col] of Object.entries(fieldMap)) {
          if ((input as Record<string, unknown>)[key] !== undefined) {
            values.push((input as Record<string, unknown>)[key]);
            setClauses.push(`${col} = $${values.length}`);
          }
        }

        const res = await client.query(
          `UPDATE attendance_policies
           SET ${setClauses.join(', ')}
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING
            id, company_id as "companyId", code, name, description,
            geofence_mode as "geofenceMode", allow_selfie as "allowSelfie",
            require_selfie as "requireSelfie", max_gps_accuracy_meters as "maxGpsAccuracyMeters",
            allowed_sources as "allowedSources", grace_minutes as "graceMinutes",
            half_day_minutes as "halfDayMinutes", full_day_minutes as "fullDayMinutes",
            auto_punch_out_hours as "autoPunchOutHours", version,
            created_at as "createdAt", updated_at as "updatedAt"`,
          values,
        );

        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Lists all attendance policies for a company.
   */
  async listPolicies(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            id, company_id as "companyId", code, name, description,
            geofence_mode as "geofenceMode", allow_selfie as "allowSelfie",
            require_selfie as "requireSelfie", max_gps_accuracy_meters as "maxGpsAccuracyMeters",
            allowed_sources as "allowedSources", grace_minutes as "graceMinutes",
            half_day_minutes as "halfDayMinutes", full_day_minutes as "fullDayMinutes",
            auto_punch_out_hours as "autoPunchOutHours", version,
            created_at as "createdAt", updated_at as "updatedAt"
          FROM attendance_policies
          WHERE company_id = $1 AND deleted_at IS NULL
          ORDER BY name ASC`,
          [companyId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Creates an attendance policy assignment with priority calculation.
   * Priority: 1=employee, 2=department, 3=location, 4=company
   */
  async createAssignment(
    companyId: string,
    input: AssignAttendancePolicyInput & { createdBy: string },
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyAssignmentRecord> {
    const priorityMap: Record<string, number> = {
      employee: 1,
      department: 2,
      location: 3,
      company: 4,
    };
    const priority = priorityMap[input.targetType] ?? 4;

    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        const res = await client.query(
          `INSERT INTO attendance_policy_assignments (
            id, company_id, policy_id, priority, target_type, target_id,
            valid_from, valid_to, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
          )
          RETURNING
            id, company_id as "companyId", policy_id as "policyId",
            priority, target_type as "targetType", target_id as "targetId",
            valid_from as "validFrom", valid_to as "validTo",
            created_at as "createdAt"`,
          [
            id,
            companyId,
            input.policyId,
            priority,
            input.targetType,
            input.targetId ?? null,
            input.validFrom,
            input.validTo ?? null,
            input.createdBy,
          ],
        );
        return res.rows[0];
      },
      poolOverride,
    );
  }

  /**
   * Lists assignments for a company, optionally filtered by policyId or target.
   */
  async listAssignments(
    companyId: string,
    filters?: { policyId?: string; targetType?: string; targetId?: string },
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyAssignmentRecord[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const conditions: string[] = ['company_id = $1', 'deleted_at IS NULL'];
        const values: unknown[] = [companyId];

        if (filters?.policyId) {
          values.push(filters.policyId);
          conditions.push(`policy_id = $${values.length}`);
        }
        if (filters?.targetType) {
          values.push(filters.targetType);
          conditions.push(`target_type = $${values.length}`);
        }
        if (filters?.targetId) {
          values.push(filters.targetId);
          conditions.push(`target_id = $${values.length}`);
        }

        const res = await client.query(
          `SELECT
            id, company_id as "companyId", policy_id as "policyId",
            priority, target_type as "targetType", target_id as "targetId",
            valid_from as "validFrom", valid_to as "validTo",
            created_at as "createdAt"
          FROM attendance_policy_assignments
          WHERE ${conditions.join(' AND ')}
          ORDER BY priority ASC, valid_from DESC`,
          values,
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Gets an employee's department and location for policy resolution.
   */
  async getEmployeeOrgDetails(
    companyId: string,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<{ departmentId: string | null; locationId: string | null } | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT department_id as "departmentId", location_id as "locationId"
           FROM employees
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           LIMIT 1`,
          [companyId, employeeId],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Resolves effective attendance policy using hierarchical precedence:
   * 1. Employee Assignment (Priority 1)
   * 2. Department Assignment (Priority 2)
   * 3. Location Assignment (Priority 3)
   * 4. Company Default (Priority 4)
   * Date range filtered: validFrom <= date AND (validTo IS NULL OR validTo >= date).
   */
  async findEffectiveAssignment(
    companyId: string,
    employeeId: string,
    departmentId: string | null,
    locationId: string | null,
    dateStr: string,
    poolOverride?: pg.Pool,
  ): Promise<EffectivePolicyResult | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            a.id as assignment_id,
            a.priority,
            a.target_type as "targetType",
            a.target_id as "targetId",
            a.valid_from as "validFrom",
            a.valid_to as "validTo",
            p.id,
            p.company_id as "companyId",
            p.code,
            p.name,
            p.description,
            p.geofence_mode as "geofenceMode",
            p.allow_selfie as "allowSelfie",
            p.require_selfie as "requireSelfie",
            p.max_gps_accuracy_meters as "maxGpsAccuracyMeters",
            p.allowed_sources as "allowedSources",
            p.grace_minutes as "graceMinutes",
            p.half_day_minutes as "halfDayMinutes",
            p.full_day_minutes as "fullDayMinutes",
            p.auto_punch_out_hours as "autoPunchOutHours",
            p.version,
            p.created_at as "createdAt",
            p.updated_at as "updatedAt"
          FROM attendance_policy_assignments a
          JOIN attendance_policies p
            ON p.company_id = a.company_id
           AND p.id = a.policy_id
           AND p.deleted_at IS NULL
          WHERE a.company_id = $1
            AND a.deleted_at IS NULL
            AND a.valid_from <= $2::date
            AND (a.valid_to IS NULL OR a.valid_to >= $2::date)
            AND (
              (a.target_type = 'employee' AND a.target_id = $3::uuid)
              OR ($4::uuid IS NOT NULL AND a.target_type = 'department' AND a.target_id = $4::uuid)
              OR ($5::uuid IS NOT NULL AND a.target_type = 'location' AND a.target_id = $5::uuid)
              OR (a.target_type = 'company')
            )
          ORDER BY a.priority ASC, a.valid_from DESC
          LIMIT 1`,
          [companyId, dateStr, employeeId, departmentId, locationId],
        );

        if (res.rows.length === 0) {
          return null;
        }

        const row = res.rows[0];
        return {
          policy: {
            id: row.id,
            companyId: row.companyId,
            code: row.code,
            name: row.name,
            description: row.description,
            geofenceMode: row.geofenceMode,
            allowSelfie: row.allowSelfie,
            requireSelfie: row.requireSelfie,
            maxGpsAccuracyMeters: row.maxGpsAccuracyMeters,
            allowedSources: row.allowedSources,
            graceMinutes: row.graceMinutes,
            halfDayMinutes: row.halfDayMinutes,
            fullDayMinutes: row.fullDayMinutes,
            autoPunchOutHours: row.autoPunchOutHours,
            version: row.version,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          assignment: {
            id: row.assignment_id,
            priority: row.priority,
            targetType: row.targetType,
            targetId: row.targetId,
            validFrom: row.validFrom,
            validTo: row.validTo,
          },
        };
      },
      poolOverride,
    );
  }

  /**
   * Resolves effective attendance policy for an employee on a given date.
   */
  async findEffectivePolicy(
    companyId: string,
    dateStr: string,
    employeeId: string,
    departmentId?: string | null,
    locationId?: string | null,
    poolOverride?: pg.Pool,
  ): Promise<EffectivePolicyResult | null> {
    return this.findEffectiveAssignment(
      companyId,
      employeeId,
      departmentId ?? null,
      locationId ?? null,
      dateStr,
      poolOverride,
    );
  }
}

