import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import type { PunchReasonCode } from './punch-validation.js';

export interface PunchRecord {
  id: string;
  companyId: string;
  employeeId: string;
  punchTime: Date;
  punchType: 'in' | 'out' | 'auto_out';
  source: 'mobile' | 'web' | 'biometric' | 'qr';
  workDate: string;
  shiftId: string | null;
  locationId: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  isInsideGeofence: boolean;
  distanceMeters: number | null;
  selfieFileId: string | null;
  deviceId: string | null;
  deviceModel: string | null;
  isMockLocation: boolean;
  status: 'valid' | 'flagged' | 'soft_pending' | 'rejected';
  reasonCode: PunchReasonCode;
  flagReasons: string[];
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface EffectivePunchRecord extends PunchRecord {
  effectiveStatus: string;
  reviewId: string | null;
  workflowRequestId: string | null;
  reviewerId: string | null;
  reviewComments: string | null;
  reviewedAt: Date | null;
}

export interface PresenceRecord {
  id: string;
  companyId: string;
  employeeId: string;
  status: 'in' | 'out';
  lastPunchId: string;
  lastPunchTime: Date;
  locationId: string | null;
  shiftDate: string;
  updatedAt: Date;
}

export interface GeofenceCheckResult {
  locationId: string | null;
  locationName: string | null;
  timezone: string;
  geofenceType: 'radius' | 'polygon';
  radiusMeters: number;
  distanceMeters: number;
  isInside: boolean;
  wifiBssids?: string[];
  qrSecret?: string | null;
}

export interface RecordPunchDbInput {
  employeeId: string;
  punchTime: Date;
  punchType: 'in' | 'out' | 'auto_out';
  source: 'mobile' | 'web' | 'biometric' | 'qr';
  workDate: string;
  shiftId: string | null;
  locationId: string | null;
  longitude: number | null;
  latitude: number | null;
  gpsAccuracy: number | null;
  isInsideGeofence: boolean;
  distanceMeters: number | null;
  selfieFileId: string | null;
  deviceId: string | null;
  deviceModel: string | null;
  isMockLocation: boolean;
  status: 'valid' | 'flagged' | 'soft_pending' | 'rejected';
  reasonCode: PunchReasonCode;
  flagReasons: string[];
  idempotencyKey: string | null;
}

export class AttendancePunchRepository {
  /**
   * Looks up a punch by companyId and idempotencyKey.
   */
  async findByIdempotencyKey(
    companyId: string,
    idempotencyKey: string,
    poolOverride?: pg.Pool,
  ): Promise<PunchRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
             id, company_id as "companyId", employee_id as "employeeId",
             punch_time as "punchTime", punch_type as "punchType", source,
             work_date as "workDate", shift_id as "shiftId", location_id as "locationId",
             ST_X(location_coords::geometry) as "longitude",
             ST_Y(location_coords::geometry) as "latitude",
             gps_accuracy as "gpsAccuracy", is_inside_geofence as "isInsideGeofence",
             distance_meters as "distanceMeters", selfie_file_id as "selfieFileId",
             device_id as "deviceId", device_model as "deviceModel",
             is_mock_location as "isMockLocation", status,
             reason_code as "reasonCode", flag_reasons as "flagReasons",
             idempotency_key as "idempotencyKey", created_at as "createdAt"
           FROM attendance_punches
           WHERE company_id = $1 AND idempotency_key = $2
           LIMIT 1`,
          [companyId, idempotencyKey],
        );

        if (res.rows.length === 0) return null;
        const row = res.rows[0];
        return {
          ...row,
          gpsAccuracy: row.gpsAccuracy ? parseFloat(row.gpsAccuracy) : null,
          distanceMeters: row.distanceMeters ? parseFloat(row.distanceMeters) : null,
          longitude: row.longitude ? parseFloat(row.longitude) : null,
          latitude: row.latitude ? parseFloat(row.latitude) : null,
        };
      },
      poolOverride,
    );
  }

  /**
   * Fetches the most recent punch for an employee for velocity check.
   */
  async getLatestPunch(
    companyId: string,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<{
    id: string;
    punchTime: Date;
    punchType: string;
    longitude: number | null;
    latitude: number | null;
    gpsAccuracy: number | null;
  } | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
             id, punch_time as "punchTime", punch_type as "punchType",
             ST_X(location_coords::geometry) as "longitude",
             ST_Y(location_coords::geometry) as "latitude",
             gps_accuracy as "gpsAccuracy"
           FROM attendance_punches
           WHERE company_id = $1 AND employee_id = $2
           ORDER BY punch_time DESC
           LIMIT 1`,
          [companyId, employeeId],
        );

        if (res.rows.length === 0) return null;
        const row = res.rows[0];
        return {
          id: row.id,
          punchTime: new Date(row.punchTime),
          punchType: row.punchType,
          longitude: row.longitude !== null ? parseFloat(row.longitude) : null,
          latitude: row.latitude !== null ? parseFloat(row.latitude) : null,
          gpsAccuracy: row.gpsAccuracy !== null ? parseFloat(row.gpsAccuracy) : null,
        };
      },
      poolOverride,
    );
  }

  /**
   * Evaluates coordinates against employee's assigned locations using PostGIS.
   */
  async evaluateGeofence(
    companyId: string,
    employeeId: string,
    punchDate: string,
    longitude: number,
    latitude: number,
    poolOverride?: pg.Pool,
  ): Promise<GeofenceCheckResult | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const sql = `
          SELECT
            wl.id as "locationId",
            wl.name as "locationName",
            wl.timezone,
            wl.geofence_type as "geofenceType",
            COALESCE(wl.radius_meters, 100) as "radiusMeters",
            wl.wifi_bssids as "wifiBssids",
            wl.qr_secret as "qrSecret",
            CASE
              WHEN wl.center IS NOT NULL THEN
                ST_Distance(wl.center, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography)
              ELSE 999999
            END as "distanceMeters",
            CASE
              WHEN wl.geofence_type = 'polygon' AND wl.polygon IS NOT NULL THEN
                ST_Contains(wl.polygon::geometry, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geometry)
              WHEN wl.center IS NOT NULL THEN
                ST_DWithin(wl.center, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, COALESCE(wl.radius_meters, 100))
              ELSE false
            END as "isInside"
          FROM work_locations wl
          WHERE wl.company_id = $1
            AND wl.deleted_at IS NULL
            AND (
              wl.id IN (
                SELECT el.location_id
                FROM employee_locations el
                WHERE el.company_id = $1
                  AND el.employee_id = $2
                  AND el.deleted_at IS NULL
                  AND el.valid_from <= $3::date
                  AND (el.valid_to IS NULL OR el.valid_to >= $3::date)
              )
              OR (
                NOT EXISTS (
                  SELECT 1 FROM employee_locations el
                  WHERE el.company_id = $1
                    AND el.employee_id = $2
                    AND el.deleted_at IS NULL
                    AND el.valid_from <= $3::date
                    AND (el.valid_to IS NULL OR el.valid_to >= $3::date)
                )
                AND (
                  wl.id = (
                    SELECT e.location_id FROM employees e
                    WHERE e.company_id = $1 AND e.id = $2
                  )
                  OR NOT EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.company_id = $1 AND e.id = $2 AND e.location_id IS NOT NULL
                  )
                )
              )
            )
          ORDER BY "isInside" DESC, "distanceMeters" ASC
          LIMIT 1
        `;

        const res = await client.query(sql, [
          companyId,
          employeeId,
          punchDate,
          longitude,
          latitude,
        ]);

        if (res.rows.length === 0) return null;
        const row = res.rows[0];
        return {
          locationId: row.locationId,
          locationName: row.locationName,
          timezone: row.timezone ?? 'Asia/Kolkata',
          geofenceType: row.geofenceType,
          radiusMeters: parseFloat(row.radiusMeters),
          distanceMeters: parseFloat(row.distanceMeters),
          isInside: Boolean(row.isInside),
          wifiBssids: row.wifiBssids ?? [],
          qrSecret: row.qrSecret ?? null,
        };
      },
      poolOverride,
    );
  }

  /**
   * Fetches employee's reporting manager ID.
   */
  async getEmployeeReportingManager(
    companyId: string,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<string | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{ reports_to: string | null }>(
          `SELECT reports_to FROM employees WHERE company_id = $1 AND id = $2`,
          [companyId, employeeId],
        );
        return res.rows[0]?.reports_to ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Ensures default workflow definition for attendance punch reviews exists.
   */
  async ensurePunchReviewWorkflowDefinition(
    companyId: string,
    client: pg.PoolClient,
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM workflow_definitions
       WHERE company_id = $1 AND code = 'attendance_punch_review' AND is_active = true AND deleted_at IS NULL
       LIMIT 1`,
      [companyId],
    );

    if (res.rows.length > 0 && res.rows[0]) {
      return res.rows[0].id;
    }

    const newId = generateUuidV7();
    const steps = [
      {
        order: 1,
        name: 'Manager Review',
        approverType: 'reporting_manager',
        mode: 'any',
        onTimeout: 'escalate',
        timeoutHours: 24,
      },
    ];

    await client.query(
      `INSERT INTO workflow_definitions (
         id, company_id, code, name, entity_type, version, is_active, steps, created_by, updated_by
       ) VALUES ($1, $2, 'attendance_punch_review', 'Attendance Punch Review', 'attendance_punch_review', 1, true, $3, '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')
       ON CONFLICT (company_id, code, version) DO UPDATE SET is_active = true
       RETURNING id`,
      [newId, companyId, JSON.stringify(steps)],
    );

    return newId;
  }

  /**
   * Atomic multi-row write transaction:
   * 1. Inserts into partitioned append-only attendance_punches table
   * 2. Upserts attendance_presence
   * 3. If soft-policy, creates workflow request and punch review record
   * 4. Emits outbox event
   */
  async recordPunchAtomic(
    companyId: string,
    punchData: RecordPunchDbInput,
    presenceData: {
      status: 'in' | 'out';
      shiftDate: string;
      locationId: string | null;
    },
    reviewMeta?: {
      managerId: string | null;
      comments?: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ punch: PunchRecord; presence: PresenceRecord; workflowRequestId?: string | undefined }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const punchId = generateUuidV7();
        const presenceId = generateUuidV7();

        // 1. Insert punch
        await client.query(
          `INSERT INTO attendance_punches (
             id, company_id, employee_id, punch_time, punch_type, source,
             work_date, shift_id, location_id, location_coords, gps_accuracy,
             is_inside_geofence, distance_meters, selfie_file_id, device_id,
             device_model, is_mock_location, status, reason_code, flag_reasons,
             idempotency_key, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9,
             CASE
               WHEN $10::float8 IS NOT NULL AND $11::float8 IS NOT NULL
               THEN ST_SetSRID(ST_MakePoint($10::float8, $11::float8), 4326)::geography
               ELSE NULL
             END,
             $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21,
             $22, NOW()
           )`,
          [
            punchId,
            companyId,
            punchData.employeeId,
            punchData.punchTime,
            punchData.punchType,
            punchData.source,
            punchData.workDate,
            punchData.shiftId,
            punchData.locationId,
            punchData.longitude,
            punchData.latitude,
            punchData.gpsAccuracy,
            punchData.isInsideGeofence,
            punchData.distanceMeters,
            punchData.selfieFileId,
            punchData.deviceId,
            punchData.deviceModel,
            punchData.isMockLocation,
            punchData.status,
            punchData.reasonCode,
            punchData.flagReasons,
            punchData.idempotencyKey,
          ],
        );

        // 2. Upsert presence
        const presenceRes = await client.query(
          `INSERT INTO attendance_presence (
             id, company_id, employee_id, status, last_punch_id, last_punch_time, location_id, shift_date, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (company_id, employee_id)
           DO UPDATE SET
             status = EXCLUDED.status,
             last_punch_id = EXCLUDED.last_punch_id,
             last_punch_time = EXCLUDED.last_punch_time,
             location_id = EXCLUDED.location_id,
             shift_date = EXCLUDED.shift_date,
             updated_at = NOW()
           RETURNING id, company_id as "companyId", employee_id as "employeeId",
                     status, last_punch_id as "lastPunchId", last_punch_time as "lastPunchTime",
                     location_id as "locationId", shift_date as "shiftDate", updated_at as "updatedAt"`,
          [
            presenceId,
            companyId,
            punchData.employeeId,
            presenceData.status,
            punchId,
            punchData.punchTime,
            presenceData.locationId,
            presenceData.shiftDate,
          ],
        );

        let workflowRequestId: string | undefined;

        // 3. If soft_pending, create workflow request and punch review
        if (punchData.status === 'soft_pending') {
          const defId = await this.ensurePunchReviewWorkflowDefinition(companyId, client);
          workflowRequestId = generateUuidV7();

          // Create workflow request
          await client.query(
            `INSERT INTO workflow_requests (
               id, company_id, definition_id, definition_version, entity_type, entity_id,
               requester_id, status, current_step_index, payload, metadata, created_by, updated_by
             ) VALUES (
               $1, $2, $3, 1, 'attendance_punch_review', $4,
               $5, 'pending', 0, $6, $7, $5, $5
             )`,
            [
              workflowRequestId,
              companyId,
              defId,
              punchId,
              punchData.employeeId,
              JSON.stringify({
                punchId,
                punchTime: punchData.punchTime.toISOString(),
                punchType: punchData.punchType,
                distanceMeters: punchData.distanceMeters,
                locationId: punchData.locationId,
                reasonCode: punchData.reasonCode,
              }),
              JSON.stringify({
                managerId: reviewMeta?.managerId ?? null,
              }),
            ],
          );

          // Create workflow step
          const stepId = generateUuidV7();
          await client.query(
            `INSERT INTO workflow_steps (
               id, company_id, request_id, step_index, name, mode, status, created_by, updated_by
             ) VALUES ($1, $2, $3, 0, 'Manager Review', 'any', 'pending', $4, $4)`,
            [stepId, companyId, workflowRequestId, punchData.employeeId],
          );

          // Create assignee for reporting manager (or fallback to company HR/super_admin if none)
          if (reviewMeta?.managerId) {
            const assigneeId = generateUuidV7();
            await client.query(
              `INSERT INTO workflow_assignees (
                 id, company_id, request_id, step_id, assignee_id, status, created_by, updated_by
               ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
              [assigneeId, companyId, workflowRequestId, stepId, reviewMeta.managerId, punchData.employeeId],
            );
          }

          // Insert into attendance_punch_reviews
          const reviewId = generateUuidV7();
          await client.query(
            `INSERT INTO attendance_punch_reviews (
               id, company_id, punch_id, punch_time, workflow_request_id, status, created_by, updated_by
             ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
            [
              reviewId,
              companyId,
              punchId,
              punchData.punchTime,
              workflowRequestId,
              punchData.employeeId,
            ],
          );
        }

        // 4. Insert into outbox_events
        const outboxEventType =
          punchData.status === 'soft_pending'
            ? 'attendance.punch.pending_review'
            : 'attendance.punch.recorded';

        await client.query(
          `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
           VALUES (gen_random_uuid(), $1, 'attendance', $2, $3)`,
          [
            companyId,
            outboxEventType,
            JSON.stringify({
              punchId,
              employeeId: punchData.employeeId,
              punchType: punchData.punchType,
              punchTime: punchData.punchTime.toISOString(),
              status: punchData.status,
              reasonCode: punchData.reasonCode,
              workflowRequestId: workflowRequestId ?? null,
            }),
          ],
        );

        const presenceRow = presenceRes.rows[0];
        const presence: PresenceRecord = {
          id: presenceRow.id,
          companyId: presenceRow.companyId,
          employeeId: presenceRow.employeeId,
          status: presenceRow.status,
          lastPunchId: presenceRow.lastPunchId,
          lastPunchTime: new Date(presenceRow.lastPunchTime),
          locationId: presenceRow.locationId,
          shiftDate: presenceRow.shiftDate,
          updatedAt: new Date(presenceRow.updatedAt),
        };

        const punch: PunchRecord = {
          id: punchId,
          companyId,
          employeeId: punchData.employeeId,
          punchTime: punchData.punchTime,
          punchType: punchData.punchType,
          source: punchData.source,
          workDate: punchData.workDate,
          shiftId: punchData.shiftId,
          locationId: punchData.locationId,
          longitude: punchData.longitude,
          latitude: punchData.latitude,
          gpsAccuracy: punchData.gpsAccuracy,
          isInsideGeofence: punchData.isInsideGeofence,
          distanceMeters: punchData.distanceMeters,
          selfieFileId: punchData.selfieFileId,
          deviceId: punchData.deviceId,
          deviceModel: punchData.deviceModel,
          isMockLocation: punchData.isMockLocation,
          status: punchData.status,
          reasonCode: punchData.reasonCode,
          flagReasons: punchData.flagReasons,
          idempotencyKey: punchData.idempotencyKey,
          createdAt: new Date(),
        };

        return { punch, presence, workflowRequestId };
      },
      poolOverride,
    );
  }

  /**
   * Fetches punches for an employee on a given shift/work date from the effective view.
   */
  async getEmployeePunchesForDate(
    companyId: string,
    employeeId: string,
    workDate: string,
    poolOverride?: pg.Pool,
  ): Promise<EffectivePunchRecord[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
             id, company_id as "companyId", employee_id as "employeeId",
             punch_time as "punchTime", punch_type as "punchType", source,
             work_date as "workDate", shift_id as "shiftId", location_id as "locationId",
             ST_X(location_coords::geometry) as "longitude",
             ST_Y(location_coords::geometry) as "latitude",
             gps_accuracy as "gpsAccuracy", is_inside_geofence as "isInsideGeofence",
             distance_meters as "distanceMeters", selfie_file_id as "selfieFileId",
             device_id as "deviceId", device_model as "deviceModel",
             is_mock_location as "isMockLocation", raw_status as "status",
             effective_status as "effectiveStatus", reason_code as "reasonCode",
             flag_reasons as "flagReasons", idempotency_key as "idempotencyKey",
             created_at as "createdAt", review_id as "reviewId",
             workflow_request_id as "workflowRequestId", reviewer_id as "reviewerId",
             review_comments as "reviewComments", reviewed_at as "reviewedAt"
           FROM v_effective_punches
           WHERE company_id = $1 AND employee_id = $2 AND work_date = $3::date
           ORDER BY punch_time ASC`,
          [companyId, employeeId, workDate],
        );

        return res.rows.map((row) => ({
          ...row,
          punchTime: new Date(row.punchTime),
          createdAt: new Date(row.createdAt),
          reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
          gpsAccuracy: row.gpsAccuracy ? parseFloat(row.gpsAccuracy) : null,
          distanceMeters: row.distanceMeters ? parseFloat(row.distanceMeters) : null,
          longitude: row.longitude ? parseFloat(row.longitude) : null,
          latitude: row.latitude ? parseFloat(row.latitude) : null,
        }));
      },
      poolOverride,
    );
  }

  /**
   * Fetches current presence for an employee.
   */
  async getEmployeePresence(
    companyId: string,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<PresenceRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `SELECT
             id, company_id as "companyId", employee_id as "employeeId",
             status, last_punch_id as "lastPunchId", last_punch_time as "lastPunchTime",
             location_id as "locationId", shift_date as "shiftDate", updated_at as "updatedAt"
           FROM attendance_presence
           WHERE company_id = $1 AND employee_id = $2`,
          [companyId, employeeId],
        );

        if (res.rows.length === 0) return null;
        const row = res.rows[0];
        return {
          id: row.id,
          companyId: row.companyId,
          employeeId: row.employeeId,
          status: row.status,
          lastPunchId: row.lastPunchId,
          lastPunchTime: new Date(row.lastPunchTime),
          locationId: row.locationId,
          shiftDate: row.shiftDate,
          updatedAt: new Date(row.updatedAt),
        };
      },
      poolOverride,
    );
  }

  /**
   * Lists live presence across employees for "Who is in" manager board.
   */
  async listLivePresence(
    companyId: string,
    filters?: {
      departmentId?: string | undefined;
      locationId?: string | undefined;
      status?: 'in' | 'out' | undefined;
      limit?: number | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<
    Array<{
      employeeId: string;
      employeeName: string;
      employeeNumber: string;
      departmentName: string | null;
      locationName: string | null;
      status: 'in' | 'out';
      lastPunchId: string;
      lastPunchTime: Date;
      shiftDate: string;
    }>
  > {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const conditions: string[] = ['p.company_id = $1'];
        const values: unknown[] = [companyId];

        if (filters?.departmentId) {
          values.push(filters.departmentId);
          conditions.push(`e.department_id = $${values.length}`);
        }

        if (filters?.locationId) {
          values.push(filters.locationId);
          conditions.push(`p.location_id = $${values.length}`);
        }

        if (filters?.status) {
          values.push(filters.status);
          conditions.push(`p.status = $${values.length}`);
        }

        const limit = filters?.limit ?? 100;
        values.push(limit);

        const sql = `
          SELECT
            p.employee_id as "employeeId",
            e.first_name || ' ' || e.last_name as "employeeName",
            e.emp_code as "employeeNumber",
            d.name as "departmentName",
            wl.name as "locationName",
            p.status,
            p.last_punch_id as "lastPunchId",
            p.last_punch_time as "lastPunchTime",
            p.shift_date as "shiftDate"
          FROM attendance_presence p
          JOIN employees e ON e.company_id = p.company_id AND e.id = p.employee_id AND e.deleted_at IS NULL
          LEFT JOIN departments d ON d.company_id = p.company_id AND d.id = e.department_id
          LEFT JOIN work_locations wl ON wl.company_id = p.company_id AND wl.id = p.location_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY p.last_punch_time DESC
          LIMIT $${values.length}
        `;

        const res = await client.query(sql, values);
        return res.rows.map((row) => ({
          ...row,
          lastPunchTime: new Date(row.lastPunchTime),
        }));
      },
      poolOverride,
    );
  }

  /**
   * Updates an attendance punch review record upon workflow action execution.
   */
  async updatePunchReview(
    companyId: string,
    workflowRequestId: string,
    status: 'approved' | 'rejected',
    reviewerId: string,
    comments?: string,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE attendance_punch_reviews
           SET status = $1, reviewer_id = $2, review_comments = $3, reviewed_at = NOW(), updated_at = NOW()
           WHERE company_id = $4 AND workflow_request_id = $5 AND deleted_at IS NULL
           RETURNING id`,
          [status, reviewerId, comments ?? null, companyId, workflowRequestId],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }
}
