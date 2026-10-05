import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendanceExceptionsService } from './exceptions-service.js';
import type { AttendanceExceptionsRepository } from './exceptions-repository.js';
import type { AttendanceLockService } from './lock-service.js';
import type { AttendanceDayService, RecomputeDayResult } from './day-service.js';
import type { AttendanceDayRepository } from './day-repository.js';
import type { AttendancePunchRepository, EffectivePunchRecord } from './punch-repository.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';
import { ConflictError, ForbiddenError, PERMISSIONS } from '@hrms/shared';

describe('AttendanceExceptionsService (P2-DAY-05, P2-DAY-06)', () => {
  let service: AttendanceExceptionsService;
  let mockRepo: Partial<AttendanceExceptionsRepository>;
  let mockLockService: Partial<AttendanceLockService>;
  let mockDayService: Partial<AttendanceDayService>;
  let mockDayRepo: Partial<AttendanceDayRepository>;
  let mockPunchRepo: Partial<AttendancePunchRepository>;
  let mockAuditService: Partial<AuditService>;

  const companyId = '00000000-0000-0000-0000-000000000001';
  const employeeId = '00000000-0000-0000-0000-000000000010';
  const otherEmployeeId = '00000000-0000-0000-0000-000000000020';

  const hrCtx: RequestContext = {
    companyId,
    userId: '00000000-0000-0000-0000-000000000099',
    employeeId: '00000000-0000-0000-0000-000000000099',
    roles: ['hr_admin'],
    permissions: [
      PERMISSIONS.ATTENDANCE_EXCEPTION_READ,
      PERMISSIONS.ATTENDANCE_EXCEPTION_MANAGE,
      PERMISSIONS.ATTENDANCE_DAY_READ,
      PERMISSIONS.ATTENDANCE_PUNCH_READ,
      PERMISSIONS.ATTENDANCE_PUNCH_VIEW_MAP,
    ],
    requestId: 'req-ex-01',
    isAuthenticated: true,
  };

  const empCtxWithoutMap: RequestContext = {
    companyId,
    userId: '00000000-0000-0000-0000-000000000010',
    employeeId,
    roles: ['employee'],
    permissions: [PERMISSIONS.ATTENDANCE_PUNCH_READ],
    requestId: 'req-ex-02',
    isAuthenticated: true,
  };

  beforeEach(() => {
    mockRepo = {
      listExceptions: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'day-001',
            employeeId,
            employeeName: 'Jane Doe',
            employeeCode: 'EMP001',
            departmentName: 'Engineering',
            workDate: '2026-10-01',
            shiftName: 'General Shift',
            shiftStartTime: '09:00:00',
            shiftEndTime: '18:00:00',
            firstIn: new Date('2026-10-01T09:45:00Z'),
            lastOut: null,
            punchCount: 1,
            totalWorkMinutes: 0,
            effectiveMinutes: 0,
            lateInMinutes: 45,
            earlyOutMinutes: 0,
            overtimeMinutes: 0,
            status: 'missing_punch',
            isRegularized: false,
            isLocked: false,
            ruleVersion: 1,
          },
        ],
        nextCursor: null,
      }),
      getExceptionSummary: vi.fn().mockResolvedValue({
        totalExceptions: 12,
        missingPunch: 5,
        lateIn: 4,
        earlyOut: 2,
        shortHours: 1,
        unexcusedAbsence: 0,
      }),
      getDaysByIds: vi.fn().mockResolvedValue([
        {
          id: 'day-001',
          employeeId,
          workDate: '2026-10-01',
          isLocked: false,
          status: 'missing_punch',
        },
      ]),
      bulkUpdateDays: vi.fn().mockResolvedValue(1),
      getMonthCalendarDays: vi.fn().mockResolvedValue([
        {
          id: 'day-001',
          employeeId,
          workDate: '2026-10-01',
          status: 'present',
          shiftId: 'shift-01',
          shiftName: 'General',
          firstIn: new Date('2026-10-01T09:00:00Z'),
          lastOut: new Date('2026-10-01T18:00:00Z'),
          punchCount: 2,
          totalWorkMinutes: 540,
          effectiveMinutes: 540,
          lateInMinutes: 0,
          earlyOutMinutes: 0,
          overtimeMinutes: 0,
          isRegularized: false,
          isLocked: false,
        },
      ]),
    };

    mockLockService = {
      isDateLocked: vi.fn().mockResolvedValue(false),
    };

    mockDayService = {
      recomputeDay: vi.fn().mockResolvedValue({} as unknown as RecomputeDayResult),
    };

    mockDayRepo = {
      getDay: vi.fn().mockResolvedValue({
        id: 'day-001',
        companyId,
        employeeId,
        workDate: '2026-10-01',
        shiftId: 'shift-01',
        firstIn: new Date('2026-10-01T09:00:00Z'),
        lastOut: new Date('2026-10-01T18:00:00Z'),
        punchCount: 2,
        totalWorkMinutes: 540,
        effectiveMinutes: 540,
        lateInMinutes: 0,
        earlyOutMinutes: 0,
        overtimeMinutes: 0,
        status: 'present',
        isRegularized: false,
        isLocked: false,
        ruleVersion: 1,
        sourceHash: 'hash-001',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: '00000000-0000-0000-0000-000000000000',
        updatedBy: '00000000-0000-0000-0000-000000000000',
        deletedAt: null,
        rowVersion: 1,
      }),
    };

    const samplePunch: EffectivePunchRecord = {
      id: 'punch-001',
      companyId,
      employeeId,
      punchTime: new Date('2026-10-01T09:00:00Z'),
      punchType: 'in',
      source: 'mobile',
      workDate: '2026-10-01',
      shiftId: 'shift-01',
      locationId: 'loc-01',
      gpsAccuracy: 12.5,
      isInsideGeofence: true,
      distanceMeters: 15.0,
      selfieFileId: null,
      deviceId: 'dev-001',
      deviceModel: 'Pixel 8',
      isMockLocation: false,
      status: 'valid',
      reasonCode: 'PUNCH_SUCCESS',
      flagReasons: [],
      effectiveStatus: 'valid',
      latitude: 28.6139,
      longitude: 77.209,
      reviewId: null,
      workflowRequestId: null,
      reviewerId: null,
      reviewComments: null,
      reviewedAt: null,
      idempotencyKey: null,
      createdAt: new Date(),
    };

    mockPunchRepo = {
      getEmployeePunchesForDate: vi.fn().mockResolvedValue([samplePunch]),
    };

    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    };

    service = new AttendanceExceptionsService(
      mockRepo as AttendanceExceptionsRepository,
      mockLockService as AttendanceLockService,
      mockDayService as AttendanceDayService,
      mockDayRepo as AttendanceDayRepository,
      mockPunchRepo as AttendancePunchRepository,
      mockAuditService as AuditService,
    );
  });

  describe('listExceptions & getExceptionSummary', () => {
    it('returns filtered exceptions when caller has exception.read permission', async () => {
      const result = await service.listExceptions(hrCtx, { exceptionType: 'all', limit: 50 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.employeeName).toBe('Jane Doe');
      expect(mockRepo.listExceptions).toHaveBeenCalledWith(companyId, { exceptionType: 'all', limit: 50 }, undefined);
    });

    it('rejects listing exceptions when permission is missing', async () => {
      await expect(service.listExceptions(empCtxWithoutMap, { exceptionType: 'all', limit: 50 })).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('returns aggregated summary counts', async () => {
      const summary = await service.getExceptionSummary(hrCtx, '2026-10-01', '2026-10-31');
      expect(summary.totalExceptions).toBe(12);
      expect(summary.missingPunch).toBe(5);
    });
  });

  describe('bulkResolveExceptions', () => {
    it('rejects bulk resolution when date falls in locked period', async () => {
      mockLockService.isDateLocked = vi.fn().mockResolvedValue(true);

      await expect(
        service.bulkResolveExceptions(hrCtx, {
          dayIds: ['day-001'],
          action: 'mark_present',
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('successfully bulk updates days to mark_present and emits audit event', async () => {
      const result = await service.bulkResolveExceptions(hrCtx, {
        dayIds: ['day-001'],
        action: 'mark_present',
        comments: 'Approved by HR',
      });

      expect(result.resolvedCount).toBe(1);
      expect(mockRepo.bulkUpdateDays).toHaveBeenCalledWith(
        companyId,
        ['day-001'],
        expect.objectContaining({ status: 'present', isRegularized: true, effectiveMinutes: 480 }),
        undefined,
      );
      expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
        hrCtx,
        expect.objectContaining({
          action: 'attendance.exception.bulk_resolved',
        }),
      );
    });

    it('triggers day recomputation when action is regularize', async () => {
      const result = await service.bulkResolveExceptions(hrCtx, {
        dayIds: ['day-001'],
        action: 'regularize',
      });

      expect(result.resolvedCount).toBe(1);
      expect(mockDayService.recomputeDay).toHaveBeenCalledWith(hrCtx, employeeId, '2026-10-01', undefined);
    });
  });

  describe('getMonthCalendar', () => {
    it('returns month calendar and summary stats for an employee', async () => {
      const result = await service.getMonthCalendar(hrCtx, '2026-10', employeeId);
      expect(result.employeeId).toBe(employeeId);
      expect(result.summary.presentDays).toBe(1);
      expect(result.summary.totalWorkedHours).toBe('9.0');
      expect(result.days).toHaveLength(1);
    });

    it('blocks regular employee from viewing another employee calendar', async () => {
      await expect(service.getMonthCalendar(empCtxWithoutMap, '2026-10', otherEmployeeId)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe('getDayDetail & Map Privacy Masking', () => {
    it('masks geolocation coordinates when caller lacks attendance.punch.view_map', async () => {
      const result = await service.getDayDetail(empCtxWithoutMap, '2026-10-01', employeeId);
      expect(result.canViewMap).toBe(false);
      expect(result.punches).toHaveLength(1);
      expect(result.punches[0]?.latitude).toBeNull();
      expect(result.punches[0]?.longitude).toBeNull();
      expect(result.punches[0]?.hasLocationData).toBe(true);
    });

    it('exposes geolocation coordinates when caller has attendance.punch.view_map', async () => {
      const result = await service.getDayDetail(hrCtx, '2026-10-01', employeeId);
      expect(result.canViewMap).toBe(true);
      expect(result.punches).toHaveLength(1);
      expect(result.punches[0]?.latitude).toBe(28.6139);
      expect(result.punches[0]?.longitude).toBe(77.209);
      expect(result.punches[0]?.hasLocationData).toBe(true);
    });
  });
});
