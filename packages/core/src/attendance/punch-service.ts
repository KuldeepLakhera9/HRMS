import type pg from 'pg';
import {
  ForbiddenError,
  PERMISSIONS,
  UnauthorizedError,
  ValidationError,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import { AttendancePolicyRepository } from './repository.js';
import { ShiftService } from './shift-service.js';
import {
  AttendancePunchRepository,
  type EffectivePunchRecord,
} from './punch-repository.js';
import {
  PUNCH_REASON_CODES,
  PUNCH_REASON_MESSAGES,
  type PunchReasonCode,
  type RecordPunchInput,
} from './punch-validation.js';
import { getRedisClient } from '../redis/client.js';

export interface PunchResult {
  success: boolean;
  punchId?: string;
  reasonCode: PunchReasonCode;
  message: string;
  status?: 'valid' | 'flagged' | 'soft_pending' | 'rejected';
  effectiveStatus?: string;
  punchTime?: Date;
  shiftDate?: string;
  distanceMeters?: number | null;
  isInsideGeofence?: boolean;
  workflowRequestId?: string | null;
  isReplay?: boolean;
}

export interface TodayAttendanceSummary {
  employeeId: string;
  shiftDate: string;
  currentPresence: 'in' | 'out';
  lastPunchTime: Date | null;
  totalWorkedMinutes: number;
  punches: EffectivePunchRecord[];
  shift: {
    id: string;
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
  } | null;
}

import { calculateHaversineDistanceMeters } from '../location/geofence.js';
import { DeviceRepository } from './device-repository.js';
import { verifyRotatingQrToken, verifyWifiBssid } from './qr-service.js';

export class AttendancePunchService {
  private punchRepo: AttendancePunchRepository;
  private policyRepo: AttendancePolicyRepository;
  private shiftService: ShiftService;
  private auditService: AuditService;
  private deviceRepo: DeviceRepository;
  private redisClient?: { publish: (channel: string, message: string) => Promise<unknown> } | undefined;

  constructor(
    punchRepo?: AttendancePunchRepository,
    policyRepo?: AttendancePolicyRepository,
    shiftService?: ShiftService,
    auditService?: AuditService,
    redisClient?: { publish: (channel: string, message: string) => Promise<unknown> } | undefined,
    deviceRepo?: DeviceRepository,
  ) {
    this.punchRepo = punchRepo ?? new AttendancePunchRepository();
    this.policyRepo = policyRepo ?? new AttendancePolicyRepository();
    this.shiftService = shiftService ?? new ShiftService();
    this.auditService = auditService ?? new AuditService();
    this.deviceRepo = deviceRepo ?? new DeviceRepository();
    this.redisClient = redisClient;
  }

  /**
   * Executes the 10-step punch ingestion pipeline per PHASE2_SPEC Section 6.2.
   */
  async recordPunch(
    ctx: RequestContext,
    input: RecordPunchInput,
    poolOverride?: pg.Pool,
  ): Promise<PunchResult> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to record punch.');
    }

    // 1. Target employee identification and authorization
    const employeeId = input.employeeId ?? ctx.employeeId;
    if (!employeeId) {
      throw new ValidationError('Employee ID is required to record punch.');
    }

    if (input.employeeId && input.employeeId !== ctx.employeeId) {
      if (!can(ctx, PERMISSIONS.ATTENDANCE_PUNCH_CREATE)) {
        throw new ForbiddenError('Permission denied: attendance.punch.create required to punch for another employee.');
      }
    }

    // 2. Idempotency Check
    if (input.idempotencyKey) {
      const existing = await this.punchRepo.findByIdempotencyKey(
        ctx.companyId,
        input.idempotencyKey,
        poolOverride,
      );
      if (existing) {
        return {
          success: true,
          isReplay: true,
          punchId: existing.id,
          reasonCode: existing.reasonCode,
          message: PUNCH_REASON_MESSAGES[existing.reasonCode] ?? 'Punch recorded successfully.',
          status: existing.status,
          effectiveStatus: existing.status,
          punchTime: existing.punchTime,
          shiftDate: existing.workDate,
          distanceMeters: existing.distanceMeters,
          isInsideGeofence: existing.isInsideGeofence,
        };
      }
    }

    // 3. Mock Location Detection
    if (input.isMockLocation) {
      return {
        success: false,
        reasonCode: PUNCH_REASON_CODES.MOCK_LOCATION_DETECTED,
        message: PUNCH_REASON_MESSAGES.MOCK_LOCATION_DETECTED,
      };
    }

    // 4. Effective Policy Resolution
    const punchDateStr = input.punchTime.toISOString().slice(0, 10);
    const policyResult = await this.policyRepo.findEffectivePolicy(
      ctx.companyId,
      punchDateStr,
      employeeId,
      undefined,
      undefined,
      poolOverride,
    );

    if (!policyResult) {
      return {
        success: false,
        reasonCode: PUNCH_REASON_CODES.POLICY_NOT_FOUND,
        message: PUNCH_REASON_MESSAGES.POLICY_NOT_FOUND,
      };
    }

    const policy = policyResult.policy;

    // Check allowed sources
    if (policy.allowedSources && policy.allowedSources.length > 0) {
      if (!policy.allowedSources.includes(input.source)) {
        return {
          success: false,
          reasonCode: PUNCH_REASON_CODES.SOURCE_NOT_ALLOWED,
          message: PUNCH_REASON_MESSAGES.SOURCE_NOT_ALLOWED,
        };
      }
    }

    // GPS Accuracy Check
    if (input.accuracyMeters != null && input.accuracyMeters > policy.maxGpsAccuracyMeters) {
      return {
        success: false,
        reasonCode: PUNCH_REASON_CODES.ACCURACY_EXCEEDED,
        message: PUNCH_REASON_MESSAGES.ACCURACY_EXCEEDED,
      };
    }

    // Selfie Requirement Check
    if (policy.requireSelfie && !input.selfieFileId) {
      return {
        success: false,
        reasonCode: PUNCH_REASON_CODES.SELFIE_REQUIRED,
        message: PUNCH_REASON_MESSAGES.SELFIE_REQUIRED,
      };
    }

    // 4b. Mobile Device Binding Verification (P2-PUNCH-03: zero external calls on hot path)
    if (input.source === 'mobile' && input.deviceId) {
      const activeDevice = await this.deviceRepo.getActiveDevice(
        ctx.companyId,
        employeeId,
        poolOverride,
      );

      if (!activeDevice || activeDevice.deviceId !== input.deviceId) {
        return {
          success: false,
          reasonCode: PUNCH_REASON_CODES.DEVICE_NOT_REGISTERED,
          message: PUNCH_REASON_MESSAGES.DEVICE_NOT_REGISTERED,
        };
      }
    }

    // 5. Geofence Spatial Evaluation (if coordinates provided)
    let isInsideGeofence = true;
    let distanceMeters: number | null = null;
    let locationId: string | null = null;
    let locationTimezone = 'Asia/Kolkata';

    if (input.longitude != null && input.latitude != null) {
      const geofenceResult = await this.punchRepo.evaluateGeofence(
        ctx.companyId,
        employeeId,
        punchDateStr,
        input.longitude,
        input.latitude,
        poolOverride,
      );

      if (geofenceResult) {
        locationId = geofenceResult.locationId;
        locationTimezone = geofenceResult.timezone;
        distanceMeters = geofenceResult.distanceMeters;
        isInsideGeofence = geofenceResult.isInside;

        // Fallback verification: Rotating QR or Wi-Fi BSSID (P2-PUNCH-06)
        if (!isInsideGeofence) {
          if (input.qrPayload && geofenceResult.qrSecret && geofenceResult.locationId) {
            const qrCheck = verifyRotatingQrToken(input.qrPayload, geofenceResult.locationId, geofenceResult.qrSecret);
            if (qrCheck.valid) {
              isInsideGeofence = true;
            }
          } else if (input.wifiBssid && geofenceResult.wifiBssids) {
            if (verifyWifiBssid(input.wifiBssid, geofenceResult.wifiBssids)) {
              isInsideGeofence = true;
            }
          }
        }
      } else if (policy.geofenceMode === 'strict') {
        return {
          success: false,
          reasonCode: PUNCH_REASON_CODES.GEOFENCE_NOT_ASSIGNED,
          message: PUNCH_REASON_MESSAGES.GEOFENCE_NOT_ASSIGNED,
        };
      }

      if (policy.geofenceMode === 'strict' && !isInsideGeofence) {
        return {
          success: false,
          reasonCode: PUNCH_REASON_CODES.OUTSIDE_GEOFENCE,
          message: PUNCH_REASON_MESSAGES.OUTSIDE_GEOFENCE,
          distanceMeters,
          isInsideGeofence: false,
        };
      }
    }

    // 6. Shift & Shift Date Resolution (incorporating night shifts crossing midnight)
    const shiftResolution = await this.shiftService.resolveShiftAndDate(
      ctx.companyId,
      employeeId,
      input.punchTime,
      locationTimezone,
      poolOverride,
    );
    const shiftDate = shiftResolution.shiftDate;
    const shiftId = shiftResolution.shift?.id ?? null;

    // 7. Velocity Calculation / Impossible Travel Check
    if (input.longitude != null && input.latitude != null) {
      const latestPunch = await this.punchRepo.getLatestPunch(ctx.companyId, employeeId, poolOverride);
      if (latestPunch && latestPunch.longitude != null && latestPunch.latitude != null) {
        const deltaSeconds = (input.punchTime.getTime() - latestPunch.punchTime.getTime()) / 1000;
        if (deltaSeconds > 0 && deltaSeconds < 86400) {
          const travelDistanceMeters = calculateHaversineDistanceMeters(
            latestPunch.longitude,
            latestPunch.latitude,
            input.longitude,
            input.latitude,
          );
          if (travelDistanceMeters > 50000) {
            const speedKmh = (travelDistanceMeters / 1000) / (deltaSeconds / 3600);
            if (speedKmh > 1000) {
              return {
                success: false,
                reasonCode: PUNCH_REASON_CODES.IMPOSSIBLE_TRAVEL,
                message: PUNCH_REASON_MESSAGES.IMPOSSIBLE_TRAVEL,
              };
            }
          }
        }
      }
    }

    // 8. Soft-policy vs Valid determination
    let status: 'valid' | 'soft_pending' = 'valid';
    let reasonCode: PunchReasonCode = PUNCH_REASON_CODES.PUNCH_SUCCESS;
    const flagReasons: string[] = [];
    let managerId: string | null = null;

    if (policy.geofenceMode === 'soft' && !isInsideGeofence) {
      status = 'soft_pending';
      reasonCode = PUNCH_REASON_CODES.PENDING_MANAGER_APPROVAL;
      flagReasons.push('OUTSIDE_GEOFENCE');
      managerId = await this.punchRepo.getEmployeeReportingManager(
        ctx.companyId,
        employeeId,
        poolOverride,
      );
    }

    // 9. Atomic Multi-Row Write Transaction
    const { punch, workflowRequestId } = await this.punchRepo.recordPunchAtomic(
      ctx.companyId,
      {
        employeeId,
        punchTime: input.punchTime,
        punchType: input.punchType,
        source: input.source,
        workDate: shiftDate,
        shiftId,
        locationId,
        longitude: input.longitude ?? null,
        latitude: input.latitude ?? null,
        gpsAccuracy: input.accuracyMeters ?? null,
        isInsideGeofence,
        distanceMeters,
        selfieFileId: input.selfieFileId ?? null,
        deviceId: input.deviceId ?? null,
        deviceModel: input.deviceModel ?? null,
        isMockLocation: input.isMockLocation,
        status,
        reasonCode,
        flagReasons,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      {
        status: input.punchType === 'in' ? 'in' : 'out',
        shiftDate,
        locationId,
      },
      status === 'soft_pending' ? { managerId } : undefined,
      poolOverride,
    );

    // 10. Live Event Broadcasting & Audit Logging
    try {
      const redis = this.redisClient ?? getRedisClient();
      await redis.publish(
        `attendance:live:${ctx.companyId}`,
        JSON.stringify({
          event: 'punch.recorded',
          punchId: punch.id,
          employeeId,
          punchType: punch.punchType,
          status: punch.status,
          shiftDate,
          punchTime: punch.punchTime.toISOString(),
        }),
      );
    } catch {
      // Non-blocking for Redis connection drops
    }

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.punch.record',
      entity: 'attendance_punches',
      entityId: punch.id,
      after: {
        employeeId,
        punchType: punch.punchType,
        status: punch.status,
        reasonCode: punch.reasonCode,
        shiftDate,
      },
    });

    return {
      success: true,
      punchId: punch.id,
      reasonCode,
      message: PUNCH_REASON_MESSAGES[reasonCode],
      status: punch.status,
      effectiveStatus: punch.status,
      punchTime: punch.punchTime,
      shiftDate,
      distanceMeters,
      isInsideGeofence,
      workflowRequestId: workflowRequestId ?? null,
    };
  }

  /**
   * Retrieves summary of today's attendance for an employee (query budget <= 3).
   */
  async getTodaySummary(
    ctx: RequestContext,
    employeeId?: string,
    poolOverride?: pg.Pool,
  ): Promise<TodayAttendanceSummary> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }

    const targetEmployeeId = employeeId ?? ctx.employeeId;
    if (!targetEmployeeId) {
      throw new ValidationError('Target employee ID is required.');
    }

    if (employeeId && employeeId !== ctx.employeeId) {
      if (!can(ctx, PERMISSIONS.ATTENDANCE_PUNCH_READ)) {
        throw new ForbiddenError('Permission denied: attendance.punch.read required.');
      }
    }

    const now = new Date();
    // Resolve active shift and shiftDate
    const shiftRes = await this.shiftService.resolveShiftAndDate(
      ctx.companyId,
      targetEmployeeId,
      now,
      'Asia/Kolkata',
      poolOverride,
    );

    // Query punches for shiftDate
    const punches = await this.punchRepo.getEmployeePunchesForDate(
      ctx.companyId,
      targetEmployeeId,
      shiftRes.shiftDate,
      poolOverride,
    );

    // Query presence
    const presence = await this.punchRepo.getEmployeePresence(
      ctx.companyId,
      targetEmployeeId,
      poolOverride,
    );

    // Calculate worked minutes from IN/OUT pairs
    let totalWorkedMinutes = 0;
    let currentInTime: Date | null = null;

    for (const p of punches) {
      if (p.effectiveStatus === 'rejected') continue;

      if (p.punchType === 'in') {
        currentInTime = p.punchTime;
      } else if (p.punchType === 'out' || p.punchType === 'auto_out') {
        if (currentInTime) {
          const diffMs = p.punchTime.getTime() - currentInTime.getTime();
          if (diffMs > 0) {
            totalWorkedMinutes += Math.floor(diffMs / 60000);
          }
          currentInTime = null;
        }
      }
    }

    // If currently IN, add elapsed time up to now
    if (presence?.status === 'in' && presence.lastPunchTime) {
      const diffMs = now.getTime() - presence.lastPunchTime.getTime();
      if (diffMs > 0) {
        totalWorkedMinutes += Math.floor(diffMs / 60000);
      }
    }

    return {
      employeeId: targetEmployeeId,
      shiftDate: shiftRes.shiftDate,
      currentPresence: presence?.status ?? 'out',
      lastPunchTime: presence?.lastPunchTime ?? null,
      totalWorkedMinutes,
      punches,
      shift: shiftRes.shift
        ? {
            id: shiftRes.shift.id,
            code: shiftRes.shift.code,
            name: shiftRes.shift.name,
            startTime: shiftRes.shift.startTime,
            endTime: shiftRes.shift.endTime,
            crossesMidnight: shiftRes.shift.crossesMidnight,
          }
        : null,
    };
  }

  /**
   * Retrieves live presence list for manager team board (query budget <= 3).
   */
  async getWhoIsIn(
    ctx: RequestContext,
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
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }

    if (!can(ctx, PERMISSIONS.ATTENDANCE_PRESENCE_READ)) {
      throw new ForbiddenError('Permission denied: attendance.presence.read required.');
    }

    return this.punchRepo.listLivePresence(ctx.companyId, filters, poolOverride);
  }
}
