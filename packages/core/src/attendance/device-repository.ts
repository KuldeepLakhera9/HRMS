import type pg from 'pg';
import { getAppPool, withTenant, generateUuidV7, employeeDevices, type EmployeeDevice } from '@hrms/db';
import { eq, and, isNull } from 'drizzle-orm';

export class DeviceRepository {
  /**
   * Retrieves the current active device for an employee.
   * Query budget: 1
   */
  async getActiveDevice(
    companyId: string,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice | null> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .select()
        .from(employeeDevices)
        .where(
          and(
            eq(employeeDevices.companyId, companyId),
            eq(employeeDevices.employeeId, employeeId),
            eq(employeeDevices.status, 'active'),
            isNull(employeeDevices.deletedAt),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    }, pool);
  }

  /**
   * Retrieves a device by its hardware ID for an employee.
   */
  async getDeviceByHardwareId(
    companyId: string,
    employeeId: string,
    deviceId: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice | null> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .select()
        .from(employeeDevices)
        .where(
          and(
            eq(employeeDevices.companyId, companyId),
            eq(employeeDevices.employeeId, employeeId),
            eq(employeeDevices.deviceId, deviceId),
            isNull(employeeDevices.deletedAt),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    }, pool);
  }

  /**
   * Retrieves a device by its primary key ID.
   */
  async getDeviceById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice | null> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .select()
        .from(employeeDevices)
        .where(
          and(
            eq(employeeDevices.companyId, companyId),
            eq(employeeDevices.id, id),
            isNull(employeeDevices.deletedAt),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    }, pool);
  }

  /**
   * Inserts a new employee device.
   */
  async createDevice(
    companyId: string,
    data: {
      employeeId: string;
      deviceId: string;
      deviceModel: string;
      osName: string;
      osVersion: string;
      appVersion: string;
      status: 'active' | 'pending_approval' | 'revoked';
      createdBy: string;
      lastAttestedAt?: Date | null;
      attestationPayload?: Record<string, unknown>;
    },
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice> {
    const pool = poolOverride ?? getAppPool();
    const id = generateUuidV7();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .insert(employeeDevices)
        .values({
          id,
          companyId,
          employeeId: data.employeeId,
          deviceId: data.deviceId,
          deviceModel: data.deviceModel,
          osName: data.osName,
          osVersion: data.osVersion,
          appVersion: data.appVersion,
          status: data.status,
          lastAttestedAt: data.lastAttestedAt ?? null,
          attestationPayload: (data.attestationPayload ?? {}) as Record<string, unknown>,
          createdBy: data.createdBy,
          updatedBy: data.createdBy,
        })
        .returning();

      return rows[0]!;
    }, pool);
  }

  /**
   * Updates device status (e.g. approve or revoke).
   */
  async updateStatus(
    companyId: string,
    id: string,
    status: 'active' | 'pending_approval' | 'revoked',
    updatedBy: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .update(employeeDevices)
        .set({
          status,
          updatedBy,
          updatedAt: new Date(),
        })
        .where(and(eq(employeeDevices.companyId, companyId), eq(employeeDevices.id, id)))
        .returning();

      return rows[0]!;
    }, pool);
  }

  /**
   * Updates device attestation timestamp and payload.
   */
  async updateAttestation(
    companyId: string,
    id: string,
    lastAttestedAt: Date,
    attestationPayload: Record<string, unknown>,
    updatedBy: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice> {
    const pool = poolOverride ?? getAppPool();
    return withTenant({ companyId }, async tx => {
      const rows = await tx
        .update(employeeDevices)
        .set({
          lastAttestedAt,
          attestationPayload: attestationPayload as Record<string, unknown>,
          updatedBy,
          updatedAt: new Date(),
        })
        .where(and(eq(employeeDevices.companyId, companyId), eq(employeeDevices.id, id)))
        .returning();

      return rows[0]!;
    }, pool);
  }
}
