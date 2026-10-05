import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import type { BiometricDevice, BiometricQuarantine } from '@hrms/db';

export interface InsertBiometricPunchParams {
  employeeId: string;
  punchTime: Date;
  punchType: 'in' | 'out';
  workDate: string;
  deviceId: string;
  locationId: string;
  idempotencyKey: string;
  createdBy: string;
}

export class BiometricRepository {
  /**
   * Finds an active biometric device by hardware device_id.
   * Query budget: 1
   */
  async findDeviceByDeviceId(
    companyId: string,
    deviceId: string,
    poolOverride?: pg.Pool,
  ): Promise<BiometricDevice | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<BiometricDevice>(
          `SELECT
             id, company_id as "companyId", device_id as "deviceId",
             name, ip_cidr as "ipCidr", hmac_secret as "hmacSecret",
             location_id as "locationId", is_active as "isActive",
             last_sync_at as "lastSyncAt", created_at as "createdAt",
             updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"
           FROM biometric_devices
           WHERE company_id = $1 AND device_id = $2 AND deleted_at IS NULL`,
          [companyId, deviceId],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Resolves employee ID from biometric user ID.
   * Query budget: 1
   */
  async findEmployeeByBiometricId(
    companyId: string,
    biometricId: string,
    poolOverride?: pg.Pool,
  ): Promise<{ id: string } | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{ id: string }>(
          `SELECT id
           FROM employees
           WHERE company_id = $1 AND biometric_id = $2 AND deleted_at IS NULL
           LIMIT 1`,
          [companyId, biometricId],
        );
        return res.rows[0] ?? null;
      },
      poolOverride,
    );
  }

  /**
   * Inserts an unmapped or invalid punch into the biometric quarantine table.
   * Query budget: 1
   */
  async insertQuarantine(
    companyId: string,
    data: {
      deviceId: string;
      biometricUserId: string;
      punchTime: Date;
      punchType: 'in' | 'out' | 'auto';
      rawPayload: Record<string, unknown>;
      errorReason: string;
      createdBy: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<string> {
    const id = generateUuidV7();
    return withTenant(
      { companyId },
      async (_tx, client) => {
        await client.query(
          `INSERT INTO biometric_quarantine (
             id, company_id, device_id, biometric_user_id, punch_time, punch_type,
             raw_payload, error_reason, resolved, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $9)`,
          [
            id,
            companyId,
            data.deviceId,
            data.biometricUserId,
            data.punchTime,
            data.punchType,
            JSON.stringify(data.rawPayload),
            data.errorReason,
            data.createdBy,
          ],
        );
        return id;
      },
      poolOverride,
    );
  }

  /**
   * Inserts an attendance punch from biometric hardware idempotently.
   * Duplicate punches sharing the same idempotency key are safely ignored.
   * Query budget: 1
   */
  async insertBiometricPunch(
    companyId: string,
    data: InsertBiometricPunchParams,
    poolOverride?: pg.Pool,
  ): Promise<{ punchId: string; isDuplicate: boolean }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        // Check existing idempotency key
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM attendance_punches
           WHERE company_id = $1 AND idempotency_key = $2 AND punch_time >= $3::timestamptz - interval '1 day'
           LIMIT 1`,
          [companyId, data.idempotencyKey, data.punchTime],
        );

        if (existing.rows.length > 0 && existing.rows[0]) {
          return { punchId: existing.rows[0].id, isDuplicate: true };
        }

        const id = generateUuidV7();
        await client.query(
          `INSERT INTO attendance_punches (
             id, company_id, employee_id, punch_time, punch_type, source,
             work_date, location_id, device_id, is_inside_geofence, status,
             reason_code, flag_reasons, idempotency_key, is_synthetic, created_at
           ) VALUES ($1, $2, $3, $4, $5, 'biometric', $6, $7, $8, true, 'valid', 'PUNCH_SUCCESS', '{}', $9, false, NOW())`,
          [
            id,
            companyId,
            data.employeeId,
            data.punchTime,
            data.punchType,
            data.workDate,
            data.locationId,
            data.deviceId,
            data.idempotencyKey,
          ],
        );

        return { punchId: id, isDuplicate: false };
      },
      poolOverride,
    );
  }

  /**
   * Updates last heartbeat/sync timestamp on device.
   * Query budget: 1
   */
  async updateDeviceSync(
    companyId: string,
    deviceId: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        await client.query(
          `UPDATE biometric_devices
           SET last_sync_at = NOW(), updated_at = NOW()
           WHERE company_id = $1 AND device_id = $2 AND deleted_at IS NULL`,
          [companyId, deviceId],
        );
      },
      poolOverride,
    );
  }

  /**
   * Lists unresolved quarantine records for admin monitoring.
   * Query budget: 1
   */
  async listQuarantine(
    companyId: string,
    limit = 50,
    poolOverride?: pg.Pool,
  ): Promise<BiometricQuarantine[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<BiometricQuarantine>(
          `SELECT
             id, company_id as "companyId", device_id as "deviceId",
             biometric_user_id as "biometricUserId", punch_time as "punchTime",
             punch_type as "punchType", raw_payload as "rawPayload",
             error_reason as "errorReason", resolved, resolved_employee_id as "resolvedEmployeeId",
             resolved_at as "resolvedAt", created_at as "createdAt",
             updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"
           FROM biometric_quarantine
           WHERE company_id = $1 AND resolved = false AND deleted_at IS NULL
           ORDER BY created_at DESC
           LIMIT $2`,
          [companyId, limit],
        );
        return res.rows;
      },
      poolOverride,
    );
  }
}
