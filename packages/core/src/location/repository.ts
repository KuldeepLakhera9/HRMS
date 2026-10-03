import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import {
  classifyGeofenceStatus,
  validateWgs84Coordinates,
  type GeofenceEvaluationResult,
} from './geofence.js';

export interface UpdateGeofenceInput {
  locationId: string;
  geofenceType: 'radius' | 'polygon';
  radiusMeters?: number | null;
  polygonGeoJson?: Record<string, unknown> | null;
  center?: { longitude: number; latitude: number } | null;
  wifiBssids?: string[];
  qrSecret?: string | null;
  timezone?: string;
}

export interface EmployeeLocationAssignmentInput {
  employeeId: string;
  locationId: string;
  assignmentType: 'fixed' | 'flexible' | 'remote' | 'field';
  validFrom: string;
  validTo?: string | null;
  createdBy: string;
}

export class LocationRepository {
  /**
   * Updates location geofence configuration with PostGIS geography point/polygon.
   */
  async updateGeofence(
    companyId: string,
    input: UpdateGeofenceInput,
    poolOverride?: pg.Pool,
  ): Promise<{ geofenceVersion: number }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        let centerSql = 'center';
        const params: unknown[] = [companyId, input.locationId];

        if (input.center) {
          validateWgs84Coordinates(input.center.longitude, input.center.latitude);
          params.push(input.center.longitude, input.center.latitude);
          centerSql = `ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography`;
        }

        let polygonSql = 'polygon';
        if (input.polygonGeoJson) {
          params.push(JSON.stringify(input.polygonGeoJson));
          polygonSql = `ST_GeomFromGeoJSON($${params.length})::geography`;
        } else if (input.geofenceType === 'radius') {
          polygonSql = 'NULL';
        }

        params.push(input.geofenceType);
        const geofenceTypeParam = params.length;

        params.push(input.radiusMeters ?? 100);
        const radiusParam = params.length;

        params.push(input.wifiBssids ?? []);
        const wifiParam = params.length;

        params.push(input.qrSecret ?? null);
        const qrParam = params.length;

        params.push(input.timezone ?? 'Asia/Kolkata');
        const tzParam = params.length;

        const sql = `
          UPDATE work_locations
          SET
            center = ${centerSql},
            polygon = ${polygonSql},
            geofence_type = $${geofenceTypeParam},
            radius_meters = $${radiusParam},
            wifi_bssids = $${wifiParam},
            qr_secret = $${qrParam},
            timezone = $${tzParam},
            geofence_version = geofence_version + 1,
            updated_at = NOW()
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
          RETURNING geofence_version as "geofenceVersion"
        `;

        const res = await client.query<{ geofenceVersion: number }>(sql, params);
        if (res.rows.length === 0) {
          throw new Error('Location not found or deleted');
        }
        return res.rows[0]!;
      },
      poolOverride,
    );
  }

  /**
   * Tests a coordinate against a specific location's geofence.
   */
  async testCoordinate(
    companyId: string,
    locationId: string,
    longitude: number,
    latitude: number,
    accuracyMeters: number,
    poolOverride?: pg.Pool,
  ): Promise<GeofenceEvaluationResult> {
    validateWgs84Coordinates(longitude, latitude);

    return withTenant(
      { companyId },
      async (_tx, client) => {
        const sql = `
          SELECT
            id,
            name,
            geofence_type as "geofenceType",
            COALESCE(radius_meters, 100) as "radiusMeters",
            CASE
              WHEN center IS NOT NULL THEN
                ST_Distance(center, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
              ELSE 999999
            END as "distanceMeters",
            CASE
              WHEN geofence_type = 'polygon' AND polygon IS NOT NULL THEN
                ST_Contains(polygon::geometry, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geometry)
              WHEN center IS NOT NULL THEN
                ST_DWithin(center, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, COALESCE(radius_meters, 100))
              ELSE false
            END as "isInside"
          FROM work_locations
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
        `;

        const res = await client.query<{
          id: string;
          name: string;
          geofenceType: 'radius' | 'polygon';
          radiusMeters: number;
          distanceMeters: number | string;
          isInside: boolean;
        }>(sql, [companyId, locationId, longitude, latitude]);

        if (res.rows.length === 0) {
          throw new Error('Location not found or deleted');
        }

        const row = res.rows[0]!;
        const dist = Math.round(Number(row.distanceMeters) * 100) / 100;
        const status = classifyGeofenceStatus(
          Boolean(row.isInside),
          dist,
          row.radiusMeters,
          accuracyMeters,
        );

        return {
          locationId: row.id,
          locationName: row.name,
          geofenceType: row.geofenceType,
          distanceMeters: dist,
          radiusMeters: row.radiusMeters,
          accuracyMeters,
          isInside: Boolean(row.isInside),
          status,
        };
      },
      poolOverride,
    );
  }

  /**
   * Finds the nearest active work location using PostGIS spatial indexing (<-> operator).
   */
  async findNearestLocation(
    companyId: string,
    longitude: number,
    latitude: number,
    accuracyMeters: number,
    poolOverride?: pg.Pool,
  ): Promise<GeofenceEvaluationResult | null> {
    validateWgs84Coordinates(longitude, latitude);

    return withTenant(
      { companyId },
      async (_tx, client) => {
        const sql = `
          SELECT
            id,
            name,
            geofence_type as "geofenceType",
            COALESCE(radius_meters, 100) as "radiusMeters",
            ST_Distance(center, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) as "distanceMeters",
            CASE
              WHEN geofence_type = 'polygon' AND polygon IS NOT NULL THEN
                ST_Contains(polygon::geometry, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geometry)
              ELSE
                ST_DWithin(center, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, COALESCE(radius_meters, 100))
            END as "isInside"
          FROM work_locations
          WHERE company_id = $1 AND active = true AND deleted_at IS NULL AND center IS NOT NULL
          ORDER BY center <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
          LIMIT 1
        `;

        const res = await client.query<{
          id: string;
          name: string;
          geofenceType: 'radius' | 'polygon';
          radiusMeters: number;
          distanceMeters: number | string;
          isInside: boolean;
        }>(sql, [companyId, longitude, latitude]);

        if (res.rows.length === 0) return null;

        const row = res.rows[0]!;
        const dist = Math.round(Number(row.distanceMeters) * 100) / 100;
        const status = classifyGeofenceStatus(
          Boolean(row.isInside),
          dist,
          row.radiusMeters,
          accuracyMeters,
        );

        return {
          locationId: row.id,
          locationName: row.name,
          geofenceType: row.geofenceType,
          distanceMeters: dist,
          radiusMeters: row.radiusMeters,
          accuracyMeters,
          isInside: Boolean(row.isInside),
          status,
        };
      },
      poolOverride,
    );
  }

  /**
   * Retrieves the QR secret for a work location.
   */
  async getLocationQrSecret(
    companyId: string,
    locationId: string,
    poolOverride?: pg.Pool,
  ): Promise<string | null> {
    return withTenant({ companyId }, async (_tx, client) => {
      const res = await client.query(
        'SELECT qr_secret FROM work_locations WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1',
        [companyId, locationId],
      );
      return res.rows[0]?.qr_secret ?? null;
    }, poolOverride);
  }

  /**
   * Assigns an employee to a work location with date validity.
   */
  async assignEmployeeLocation(
    companyId: string,
    input: EmployeeLocationAssignmentInput,
    poolOverride?: pg.Pool,
  ): Promise<string> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        await client.query(
          `INSERT INTO employee_locations (
             id, company_id, employee_id, location_id, assignment_type, valid_from, valid_to, created_by, updated_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [
            id,
            companyId,
            input.employeeId,
            input.locationId,
            input.assignmentType,
            input.validFrom,
            input.validTo ?? null,
            input.createdBy,
          ],
        );
        return id;
      },
      poolOverride,
    );
  }

  /**
   * Returns count of active employees assigned to a specific location.
   */
  async getCoveredEmployeesCount(
    companyId: string,
    locationId: string,
    poolOverride?: pg.Pool,
  ): Promise<number> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{ count: string }>(
          `SELECT COUNT(DISTINCT employee_id)::text as count
           FROM employee_locations
           WHERE company_id = $1
             AND location_id = $2
             AND deleted_at IS NULL
             AND valid_from <= CURRENT_DATE
             AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
          [companyId, locationId],
        );
        return parseInt(res.rows[0]?.count || '0', 10);
      },
      poolOverride,
    );
  }

  /**
   * Lists employee location assignments for a company.
   */
  async listEmployeeLocations(
    companyId: string,
    filters?: { employeeId?: string; locationId?: string },
    poolOverride?: pg.Pool,
  ): Promise<Array<{
    id: string;
    companyId: string;
    employeeId: string;
    locationId: string;
    assignmentType: string;
    validFrom: string;
    validTo: string | null;
    locationName?: string;
  }>> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const conditions: string[] = ['el.company_id = $1', 'el.deleted_at IS NULL'];
        const values: unknown[] = [companyId];

        if (filters?.employeeId) {
          values.push(filters.employeeId);
          conditions.push(`el.employee_id = $${values.length}`);
        }
        if (filters?.locationId) {
          values.push(filters.locationId);
          conditions.push(`el.location_id = $${values.length}`);
        }

        const res = await client.query(
          `SELECT
             el.id, el.company_id as "companyId", el.employee_id as "employeeId",
             el.location_id as "locationId", el.assignment_type as "assignmentType",
             el.valid_from as "validFrom", el.valid_to as "validTo",
             wl.name as "locationName"
           FROM employee_locations el
           JOIN work_locations wl ON wl.company_id = el.company_id AND wl.id = el.location_id
           WHERE ${conditions.join(' AND ')}
           ORDER BY el.valid_from DESC`,
          values,
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Soft-deletes an employee location assignment.
   */
  async deleteEmployeeLocation(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE employee_locations
           SET deleted_at = NOW()
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING id`,
          [companyId, id],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }
}

