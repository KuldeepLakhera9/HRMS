import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendanceDayService } from './day-service.js';
import { computeDay } from './day-engine.js';
import type { RequestContext } from '../routing/context.js';
import type { AttendanceDayRepository } from './day-repository.js';
import type { AttendanceLockService } from './lock-service.js';
import type { DayContextProvider } from './day-context-provider.js';
import type { AttendancePunchRepository } from './punch-repository.js';
import type { ShiftService } from './shift-service.js';
import type { ShiftRecord } from './shift-repository.js';
import type { AttendancePolicyRepository, AttendancePolicyRecord } from './repository.js';
import type { AuditService } from '../audit/service.js';
import { ValidationError, ForbiddenError, UnauthorizedError } from '@hrms/shared';

describe('P2-DAY-01: AttendanceDayService Tests', () => {
  let mockDayRepo: {
    getDay: ReturnType<typeof vi.fn>;
    upsertDay: ReturnType<typeof vi.fn>;
    batchUpsertDays: ReturnType<typeof vi.fn>;
  };
  let mockLockService: {
    assertPeriodUnlocked: ReturnType<typeof vi.fn>;
    isDateLocked: ReturnType<typeof vi.fn>;
  };
  let mockContextProvider: {
    getDayContext: ReturnType<typeof vi.fn>;
  };
  let mockPunchRepo: {
    getEmployeePunchesForDate: ReturnType<typeof vi.fn>;
  };
  let mockShiftService: {
    resolveShiftAndDate: ReturnType<typeof vi.fn>;
  };
  let mockPolicyRepo: {
    findEffectivePolicy: ReturnType<typeof vi.fn>;
    listPolicies: ReturnType<typeof vi.fn>;
  };
  let mockAuditService: {
    recordEvent: ReturnType<typeof vi.fn>;
  };
  let service: AttendanceDayService;

  const adminCtx: RequestContext = {
    companyId: '11111111-1111-7111-8111-111111111111',
    userId: '22222222-2222-7222-8222-222222222222',
    employeeId: 'emp-admin-1',
    roles: ['hr_admin'],
    permissions: ['attendance.lock.manage', 'attendance.day.recalculate'],
    isAuthenticated: true,
    requestId: 'req-day-test-1',
  };

  const samplePolicy = {
    id: 'pol-1',
    companyId: '11111111-1111-7111-8111-111111111111',
    code: 'STANDARD',
    name: 'Standard Policy',
    description: null,
    geofenceMode: 'strict' as const,
    allowSelfie: false,
    requireSelfie: false,
    maxGpsAccuracyMeters: 50,
    allowedSources: ['mobile', 'web'],
    graceMinutes: 15,
    halfDayMinutes: 240,
    fullDayMinutes: 480,
    autoPunchOutHours: '12.0',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockDayRepo = {
      getDay: vi.fn(),
      upsertDay: vi.fn(),
      batchUpsertDays: vi.fn(),
    };
    mockLockService = {
      assertPeriodUnlocked: vi.fn().mockResolvedValue(undefined),
      isDateLocked: vi.fn().mockResolvedValue(false),
    };
    mockContextProvider = {
      getDayContext: vi.fn().mockResolvedValue({
        isWeeklyOff: false,
        isHoliday: false,
        isApprovedOD: false,
        isApprovedWFH: false,
        leavePortion: 0,
        isPaidLeave: true,
      }),
    };
    mockPunchRepo = {
      getEmployeePunchesForDate: vi.fn().mockResolvedValue([]),
    };
    mockShiftService = {
      resolveShiftAndDate: vi.fn().mockResolvedValue({
        shift: {
          id: 'shift-gen',
          code: 'GEN',
          name: 'General',
          startTime: '09:00',
          endTime: '18:00',
          crossesMidnight: false,
        },
        shiftDate: '2026-03-10',
      }),
    };
    mockPolicyRepo = {
      findEffectivePolicy: vi.fn().mockResolvedValue({ policy: samplePolicy }),
      listPolicies: vi.fn().mockResolvedValue([samplePolicy]),
    };
    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    };

    service = new AttendanceDayService(
      mockDayRepo as unknown as AttendanceDayRepository,
      mockLockService as unknown as AttendanceLockService,
      mockContextProvider as unknown as DayContextProvider,
      mockPunchRepo as unknown as AttendancePunchRepository,
      mockShiftService as unknown as ShiftService,
      mockPolicyRepo as unknown as AttendancePolicyRepository,
      mockAuditService as unknown as AuditService,
    );
  });

  it('rejects recomputation if unauthenticated', async () => {
    const unauthCtx = { ...adminCtx, isAuthenticated: false };
    await expect(
      service.recomputeDay(unauthCtx, 'emp-target', '2026-03-10'),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects employee recomputing another employee without permission', async () => {
    const empCtx: RequestContext = {
      ...adminCtx,
      employeeId: 'emp-other',
      roles: ['employee'],
      permissions: [],
    };
    await expect(
      service.recomputeDay(empCtx, 'emp-target', '2026-03-10'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects recomputation if period is locked', async () => {
    mockLockService.assertPeriodUnlocked.mockRejectedValue(
      new ValidationError('Attendance period is locked'),
    );
    await expect(
      service.recomputeDay(adminCtx, 'emp-target', '2026-03-10'),
    ).rejects.toThrow(ValidationError);
  });

  it('skips DB write if sourceHash is unchanged (idempotent)', async () => {
    const ctxVal = {
      isWeeklyOff: false,
      isHoliday: false,
      isApprovedOD: false,
      isApprovedWFH: false,
      leavePortion: 0,
      isPaidLeave: true,
    };
    mockContextProvider.getDayContext.mockResolvedValue(ctxVal);
    const expectedCalc = computeDay(
      [],
      { id: 'shift-gen' } as unknown as ShiftRecord,
      samplePolicy as unknown as AttendancePolicyRecord,
      ctxVal,
    );

    // Return existing day with expected hash
    mockDayRepo.getDay.mockResolvedValue({
      id: 'day-existing-1',
      companyId: adminCtx.companyId,
      employeeId: 'emp-target',
      workDate: '2026-03-10',
      sourceHash: expectedCalc.sourceHash,
      ruleVersion: 2,
      status: 'absent',
      payableDay: '0.00',
    });

    const res = await service.recomputeDay(adminCtx, 'emp-target', '2026-03-10');

    // Should indicate not recomputed
    expect(res.recomputed).toBe(false);
    expect(mockDayRepo.upsertDay).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).not.toHaveBeenCalled();
  });

  it('performs upsert and records audit event if sourceHash differs', async () => {
    mockDayRepo.getDay.mockResolvedValue(null);
    mockDayRepo.upsertDay.mockResolvedValue({
      id: 'day-new-1',
      companyId: adminCtx.companyId,
      employeeId: 'emp-target',
      workDate: '2026-03-10',
      status: 'absent',
      payableDay: '0.00',
      sourceHash: 'hash-new',
    });

    const res = await service.recomputeDay(adminCtx, 'emp-target', '2026-03-10');

    expect(res.recomputed).toBe(true);
    expect(mockDayRepo.upsertDay).toHaveBeenCalledTimes(1);
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(adminCtx, expect.objectContaining({
      action: 'attendance.day.recomputed',
      entity: 'attendance_days',
    }));
  });
});
