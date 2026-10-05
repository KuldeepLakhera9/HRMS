import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import type { AttendanceRegularizationRequest } from '@hrms/db';
import type {
  CreateRegularizationInput,
  ListRegularizationsQuery,
  RegularizationStatus,
} from './regularization-validation.js';

export interface RegularizationRecord extends AttendanceRegularizationRequest {
  employeeName?: string;
  employeeCode?: string;
}

export class RegularizationRepository {
  /**
   * Creates a new regularization request record.
   */
  async createRequest(
    companyId: string,
    input: CreateRegularizationInput & {
      employeeId: string;
      workflowRequestId?: string;
      createdBy: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        const res = await client.query(
          `INSERT INTO attendance_regularization_requests (
            id, company_id, employee_id, date, request_type,
            in_time, out_time, reason, workflow_request_id,
            status, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $10
          )
          RETURNING
            id, company_id as "companyId", employee_id as "employeeId",
            date, request_type as "requestType", in_time as "inTime",
            out_time as "outTime", reason, workflow_request_id as "workflowRequestId",
            status, synthetic_in_punch_id as "syntheticInPunchId",
            synthetic_out_punch_id as "syntheticOutPunchId",
            created_at as "createdAt", updated_at as "updatedAt",
            created_by as "createdBy", updated_by as "updatedBy"`,
          [
            id,
            companyId,
            input.employeeId,
            input.date,
            input.requestType,
            input.inTime ?? null,
            input.outTime ?? null,
            input.reason,
            input.workflowRequestId ?? null,
            input.createdBy,
          ],
        );
        return res.rows[0];
      },
      poolOverride,
    );
  }

  /**
   * Retrieves a regularization request by ID.
   */
  async getRequestById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            r.id, r.company_id as "companyId", r.employee_id as "employeeId",
            r.date, r.request_type as "requestType", r.in_time as "inTime",
            r.out_time as "outTime", r.reason, r.workflow_request_id as "workflowRequestId",
            r.status, r.synthetic_in_punch_id as "syntheticInPunchId",
            r.synthetic_out_punch_id as "syntheticOutPunchId",
            r.created_at as "createdAt", r.updated_at as "updatedAt",
            r.created_by as "createdBy", r.updated_by as "updatedBy",
            e.first_name || ' ' || e.last_name as "employeeName",
            e.emp_code as "employeeCode"
          FROM attendance_regularization_requests r
          JOIN employees e ON e.company_id = r.company_id AND e.id = r.employee_id
          WHERE r.company_id = $1 AND r.id = $2 AND r.deleted_at IS NULL`,
          [companyId, id],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Retrieves a regularization request by its workflow request ID.
   */
  async getRequestByWorkflowId(
    companyId: string,
    workflowRequestId: string,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
            r.id, r.company_id as "companyId", r.employee_id as "employeeId",
            r.date, r.request_type as "requestType", r.in_time as "inTime",
            r.out_time as "outTime", r.reason, r.workflow_request_id as "workflowRequestId",
            r.status, r.synthetic_in_punch_id as "syntheticInPunchId",
            r.synthetic_out_punch_id as "syntheticOutPunchId",
            r.created_at as "createdAt", r.updated_at as "updatedAt",
            r.created_by as "createdBy", r.updated_by as "updatedBy"
          FROM attendance_regularization_requests r
          WHERE r.company_id = $1 AND r.workflow_request_id = $2 AND r.deleted_at IS NULL`,
          [companyId, workflowRequestId],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Lists regularization requests matching the query filters.
   */
  async listRequests(
    companyId: string,
    query: ListRegularizationsQuery,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const conditions: string[] = ['r.company_id = $1', 'r.deleted_at IS NULL'];
        const values: unknown[] = [companyId];

        if (query.employeeId) {
          values.push(query.employeeId);
          conditions.push(`r.employee_id = $${values.length}`);
        }
        if (query.status) {
          values.push(query.status);
          conditions.push(`r.status = $${values.length}`);
        }
        if (query.fromDate) {
          values.push(query.fromDate);
          conditions.push(`r.date >= $${values.length}`);
        }
        if (query.toDate) {
          values.push(query.toDate);
          conditions.push(`r.date <= $${values.length}`);
        }

        values.push(query.limit ?? 50);

        const res = await client.query(
          `SELECT
            r.id, r.company_id as "companyId", r.employee_id as "employeeId",
            r.date, r.request_type as "requestType", r.in_time as "inTime",
            r.out_time as "outTime", r.reason, r.workflow_request_id as "workflowRequestId",
            r.status, r.synthetic_in_punch_id as "syntheticInPunchId",
            r.synthetic_out_punch_id as "syntheticOutPunchId",
            r.created_at as "createdAt", r.updated_at as "updatedAt",
            r.created_by as "createdBy", r.updated_by as "updatedBy",
            e.first_name || ' ' || e.last_name as "employeeName",
            e.emp_code as "employeeCode"
          FROM attendance_regularization_requests r
          JOIN employees e ON e.company_id = r.company_id AND e.id = r.employee_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.created_at DESC
          LIMIT $${values.length}`,
          values,
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Updates regularization request status and synthetic punch IDs.
   */
  async updateStatus(
    companyId: string,
    id: string,
    status: RegularizationStatus,
    syntheticPunches?: { inPunchId?: string | undefined; outPunchId?: string | undefined },
    updatedBy?: string,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE attendance_regularization_requests
           SET
             status = $3,
             synthetic_in_punch_id = COALESCE($4, synthetic_in_punch_id),
             synthetic_out_punch_id = COALESCE($5, synthetic_out_punch_id),
             updated_by = $6,
             updated_at = NOW(),
             row_version = row_version + 1
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING
             id, company_id as "companyId", employee_id as "employeeId",
             date, request_type as "requestType", in_time as "inTime",
             out_time as "outTime", reason, workflow_request_id as "workflowRequestId",
             status, synthetic_in_punch_id as "syntheticInPunchId",
             synthetic_out_punch_id as "syntheticOutPunchId",
             created_at as "createdAt", updated_at as "updatedAt",
             created_by as "createdBy", updated_by as "updatedBy"`,
          [
            companyId,
            id,
            status,
            syntheticPunches?.inPunchId ?? null,
            syntheticPunches?.outPunchId ?? null,
            updatedBy ?? '00000000-0000-0000-0000-000000000000',
          ],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Inserts a synthetic punch into the append-only attendance_punches partition table.
   */
  async insertSyntheticPunch(
    companyId: string,
    punch: {
      employeeId: string;
      punchTime: Date;
      punchType: 'in' | 'out';
      workDate: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<string> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const punchId = generateUuidV7();
        await client.query(
          `INSERT INTO attendance_punches (
            id, company_id, employee_id, punch_time, punch_type,
            source, work_date, is_synthetic, is_inside_geofence,
            status, reason_code, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'regularization', $6, true, true,
            'valid', 'REGULARIZATION_APPROVED', NOW()
          )`,
          [
            punchId,
            companyId,
            punch.employeeId,
            punch.punchTime,
            punch.punchType,
            punch.workDate,
          ],
        );
        return punchId;
      },
      poolOverride,
    );
  }
}
