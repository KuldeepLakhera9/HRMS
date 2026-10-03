import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShiftService } from './shift-service.js';
import { ShiftRepository, type ShiftRecord, type RosterWithShift } from './shift-repository.js';
import { PERMISSIONS, ForbiddenError } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';

describe('ShiftService & Night-Shift Resolution Engine (P2-POL-02)', () => {
  let service: ShiftService;
  let mockRepo: ShiftRepository;
  let mockAuditService: { recordEvent: ReturnType<typeof vi.fn> };

  const mockContext: RequestContext = {
    companyId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    employeeId: '33333333-3333-3333-3333-333333333333',
    roles: ['admin'],
    permissions: [PERMISSIONS.ATTENDANCE_SHIFT_READ, PERMISSIONS.ATTENDANCE_SHIFT_MANAGE, PERMISSIONS.ATTENDANCE_ROSTER_READ, PERMISSIONS.ATTENDANCE_ROSTER_MANAGE],
    requestId: 'req-shift-1',
    isAuthenticated: true,
  };

  const dayShift: ShiftRecord = {
    id: 'shift-day-1',
    companyId: mockContext.companyId,
    code: 'DAY_GEN',
    name: 'Day General',
    startTime: '09:00:00',
    endTime: '18:00:00',
    crossesMidnight: false,
    graceMinutes: 15,
    breakMinutes: 60,
    workHours: '8.00',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const nightShift: ShiftRecord = {
    id: 'shift-night-1',
    companyId: mockContext.companyId,
    code: 'NIGHT_A',
    name: 'Night Shift A',
    startTime: '22:00:00',
    endTime: '06:00:00',
    crossesMidnight: true,
    graceMinutes: 15,
    breakMinutes: 60,
    workHours: '8.00',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockRepo = new ShiftRepository();
    mockAuditService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    service = new ShiftService(mockRepo, mockAuditService as unknown as import('../audit/service.js').AuditService);
    vi.clearAllMocks();
  });

  describe('Authorization checks', () => {
    it('throws ForbiddenError when creating a shift without ATTENDANCE_SHIFT_MANAGE', async () => {
      const restrictedCtx: RequestContext = {
        ...mockContext,
        permissions: [],
      };

      await expect(
        service.createShift(restrictedCtx, {
          code: 'TEST',
          name: 'Test Shift',
          startTime: '09:00',
          endTime: '17:00',
          crossesMidnight: false,
          graceMinutes: 15,
          breakMinutes: 60,
          workHours: '8.00',
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('Night Shift & Shift Date Resolution (crosses_midnight)', () => {
    it('resolves normal daytime shift to the current local date', async () => {
      const mockRoster: RosterWithShift = {
        id: 'roster-1',
        companyId: mockContext.companyId,
        employeeId: mockContext.employeeId!,
        shiftId: dayShift.id,
        workDate: '2026-10-03',
        isWeeklyOff: false,
        isHoliday: false,
        status: 'published',
        createdAt: new Date(),
        shift: dayShift,
      };

      // Previous day has no night shift
      vi.spyOn(mockRepo, 'getRosterForDate').mockImplementation(async (_comp, _emp, date) => {
        if (date === '2026-10-03') return mockRoster;
        return null;
      });

      // 09:30 AM IST on 2026-10-03 (04:00 UTC)
      const punchDate = new Date('2026-10-03T04:00:00.000Z');
      const res = await service.resolveShiftAndDate(
        mockContext.companyId,
        mockContext.employeeId!,
        punchDate,
        'Asia/Kolkata',
      );

      expect(res.shiftDate).toBe('2026-10-03');
      expect(res.isNightShift).toBe(false);
      expect(res.shift.code).toBe('DAY_GEN');
    });

    it('resolves night shift before midnight to the current date', async () => {
      const mockNightRoster: RosterWithShift = {
        id: 'roster-night-1',
        companyId: mockContext.companyId,
        employeeId: mockContext.employeeId!,
        shiftId: nightShift.id,
        workDate: '2026-10-03',
        isWeeklyOff: false,
        isHoliday: false,
        status: 'published',
        createdAt: new Date(),
        shift: nightShift,
      };

      vi.spyOn(mockRepo, 'getRosterForDate').mockImplementation(async (_comp, _emp, date) => {
        if (date === '2026-10-03') return mockNightRoster;
        return null;
      });

      // 22:30 IST on 2026-10-03 (17:00 UTC)
      const punchDate = new Date('2026-10-03T17:00:00.000Z');
      const res = await service.resolveShiftAndDate(
        mockContext.companyId,
        mockContext.employeeId!,
        punchDate,
        'Asia/Kolkata',
      );

      expect(res.shiftDate).toBe('2026-10-03');
      expect(res.isNightShift).toBe(true);
      expect(res.shift.code).toBe('NIGHT_A');
    });

    it('resolves night shift punch AFTER midnight to previous day shift_date', async () => {
      const prevNightRoster: RosterWithShift = {
        id: 'roster-night-prev',
        companyId: mockContext.companyId,
        employeeId: mockContext.employeeId!,
        shiftId: nightShift.id,
        workDate: '2026-10-03',
        isWeeklyOff: false,
        isHoliday: false,
        status: 'published',
        createdAt: new Date(),
        shift: nightShift,
      };

      vi.spyOn(mockRepo, 'getRosterForDate').mockImplementation(async (_comp, _emp, date) => {
        if (date === '2026-10-03') return prevNightRoster;
        return null;
      });

      // 02:15 AM IST on 2026-10-04 (20:45 UTC on 2026-10-03)
      const punchDate = new Date('2026-10-03T20:45:00.000Z');
      const res = await service.resolveShiftAndDate(
        mockContext.companyId,
        mockContext.employeeId!,
        punchDate,
        'Asia/Kolkata',
      );

      // Punch occurred on 2026-10-04 calendar day, but correctly belongs to 2026-10-03 shift date!
      expect(res.shiftDate).toBe('2026-10-03');
      expect(res.isNightShift).toBe(true);
      expect(res.shift.code).toBe('NIGHT_A');
    });

    it('resolves clock-out at 06:10 AM after night shift ends to previous day shift_date', async () => {
      const prevNightRoster: RosterWithShift = {
        id: 'roster-night-prev',
        companyId: mockContext.companyId,
        employeeId: mockContext.employeeId!,
        shiftId: nightShift.id,
        workDate: '2026-10-03',
        isWeeklyOff: false,
        isHoliday: false,
        status: 'published',
        createdAt: new Date(),
        shift: nightShift,
      };

      vi.spyOn(mockRepo, 'getRosterForDate').mockImplementation(async (_comp, _emp, date) => {
        if (date === '2026-10-03') return prevNightRoster;
        return null;
      });

      // 06:10 AM IST on 2026-10-04 (00:40 UTC on 2026-10-04)
      const punchDate = new Date('2026-10-04T00:40:00.000Z');
      const res = await service.resolveShiftAndDate(
        mockContext.companyId,
        mockContext.employeeId!,
        punchDate,
        'Asia/Kolkata',
      );

      expect(res.shiftDate).toBe('2026-10-03');
      expect(res.isNightShift).toBe(true);
    });

    it('falls back to default shift when no roster is assigned', async () => {
      vi.spyOn(mockRepo, 'getRosterForDate').mockResolvedValue(null);
      vi.spyOn(mockRepo, 'getDefaultShift').mockResolvedValue(dayShift);

      // 11:00 AM IST on 2026-10-04 (05:30 UTC)
      const punchDate = new Date('2026-10-04T05:30:00.000Z');
      const res = await service.resolveShiftAndDate(
        mockContext.companyId,
        mockContext.employeeId!,
        punchDate,
        'Asia/Kolkata',
      );

      expect(res.shiftDate).toBe('2026-10-04');
      expect(res.shift.code).toBe('DAY_GEN');
    });
  });
});
