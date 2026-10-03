import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AttendancePunchService,
} from './punch-service.js';
import { calculateHaversineDistanceMeters } from '../location/geofence.js';
import { PUNCH_REASON_CODES } from './punch-validation.js';
import type { RequestContext } from '../routing/context.js';
import type { AttendancePolicyRecord } from './repository.js';
import type { PunchRecord, PresenceRecord } from './punch-repository.js';

import type { AttendancePolicyRepository } from './repository.js';
import type { ShiftService } from './shift-service.js';
import type { AttendancePunchRepository } from './punch-repository.js';
import type { AuditService } from '../audit/service.js';

describe('AttendancePunchService', () => {
  let mockPunchRepo: {
    findByIdempotencyKey: ReturnType<typeof vi.fn>;
    getLatestPunch: ReturnType<typeof vi.fn>;
    evaluateGeofence: ReturnType<typeof vi.fn>;
    getEmployeeReportingManager: ReturnType<typeof vi.fn>;
    recordPunchAtomic: ReturnType<typeof vi.fn>;
    getEmployeePunchesForDate: ReturnType<typeof vi.fn>;
    getEmployeePresence: ReturnType<typeof vi.fn>;
    listLivePresence: ReturnType<typeof vi.fn>;
  };
  let mockPolicyRepo: {
    findEffectivePolicy: ReturnType<typeof vi.fn>;
  };
  let mockShiftService: {
    resolveShiftAndDate: ReturnType<typeof vi.fn>;
  };
  let mockAuditService: {
    recordEvent: ReturnType<typeof vi.fn>;
  };
  let service: AttendancePunchService;

  const sampleContext: RequestContext = {
    companyId: '11111111-1111-7111-8111-111111111111',
    userId: '22222222-2222-7222-8222-222222222222',
    employeeId: '33333333-3333-7333-8333-333333333333',
    roles: ['employee'],
    permissions: [],
    isAuthenticated: true,
    requestId: 'req-1',
  };

  const defaultPolicy: AttendancePolicyRecord = {
    id: 'pol-1',
    companyId: '11111111-1111-7111-8111-111111111111',
    code: 'POL-DEF',
    name: 'Default Policy',
    description: null,
    geofenceMode: 'strict',
    allowSelfie: true,
    requireSelfie: false,
    maxGpsAccuracyMeters: 50,
    allowedSources: ['web', 'mobile'],
    graceMinutes: 15,
    halfDayMinutes: 240,
    fullDayMinutes: 480,
    autoPunchOutHours: '12.0',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPunchRepo = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      getLatestPunch: vi.fn().mockResolvedValue(null),
      evaluateGeofence: vi.fn().mockResolvedValue({
        locationId: 'loc-1',
        locationName: 'Bangalore HQ',
        timezone: 'Asia/Kolkata',
        geofenceType: 'radius',
        radiusMeters: 100,
        distanceMeters: 20,
        isInside: true,
      }),
      getEmployeeReportingManager: vi.fn().mockResolvedValue('mgr-1'),
      recordPunchAtomic: vi.fn().mockImplementation((_companyId, punchData, presenceData) => {
        const punch: PunchRecord = {
          id: 'punch-new-1',
          companyId: sampleContext.companyId,
          employeeId: punchData.employeeId,
          punchTime: punchData.punchTime,
          punchType: punchData.punchType,
          source: punchData.source,
          workDate: punchData.workDate,
          shiftId: punchData.shiftId,
          locationId: punchData.locationId,
          latitude: punchData.latitude,
          longitude: punchData.longitude,
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

        const presence: PresenceRecord = {
          id: 'pres-1',
          companyId: sampleContext.companyId,
          employeeId: punchData.employeeId,
          status: presenceData.status,
          lastPunchId: punch.id,
          lastPunchTime: punch.punchTime,
          locationId: presenceData.locationId,
          shiftDate: presenceData.shiftDate,
          updatedAt: new Date(),
        };

        return Promise.resolve({
          punch,
          presence,
          workflowRequestId: punchData.status === 'soft_pending' ? 'wf-req-1' : undefined,
        });
      }),
      getEmployeePunchesForDate: vi.fn().mockResolvedValue([]),
      getEmployeePresence: vi.fn().mockResolvedValue(null),
      listLivePresence: vi.fn().mockResolvedValue([]),
    };

    mockPolicyRepo = {
      findEffectivePolicy: vi.fn().mockResolvedValue({
        policy: defaultPolicy,
        assignment: { priority: 1 },
      }),
    };

    mockShiftService = {
      resolveShiftAndDate: vi.fn().mockResolvedValue({
        shiftDate: '2026-10-03',
        shift: {
          id: 'shift-1',
          code: 'GEN',
          name: 'General Shift',
          startTime: '09:00:00',
          endTime: '18:00:00',
          crossesMidnight: false,
        },
      }),
    };

    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    };

    const mockRedis = {
      publish: vi.fn().mockResolvedValue(1),
    };

    service = new AttendancePunchService(
      mockPunchRepo as unknown as AttendancePunchRepository,
      mockPolicyRepo as unknown as AttendancePolicyRepository,
      mockShiftService as unknown as ShiftService,
      mockAuditService as unknown as AuditService,
      mockRedis,
    );
  });

  describe('Haversine distance calculation', () => {
    it('accurately computes distance between coordinates', () => {
      // Bangalore to Delhi is ~1740 km
      const distance = calculateHaversineDistanceMeters(
        77.5946,
        12.9716, // Bangalore
        77.209,
        28.6139, // Delhi
      );
      expect(Math.round(distance / 1000)).toBeGreaterThan(1700);
      expect(Math.round(distance / 1000)).toBeLessThan(1800);
    });

    it('returns 0 for identical coordinates', () => {
      const distance = calculateHaversineDistanceMeters(77.5946, 12.9716, 77.5946, 12.9716);
      expect(Math.round(distance)).toBe(0);
    });
  });

  describe('Idempotency Replay', () => {
    it('returns existing punch when idempotencyKey matches', async () => {
      mockPunchRepo.findByIdempotencyKey.mockResolvedValueOnce({
        id: 'existing-punch-1',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId!,
        punchTime: new Date('2026-10-03T09:05:00Z'),
        punchType: 'in',
        source: 'web',
        workDate: '2026-10-03',
        status: 'valid',
        reasonCode: PUNCH_REASON_CODES.PUNCH_SUCCESS,
        distanceMeters: 10,
        isInsideGeofence: true,
      });

      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:05:00Z'),
        source: 'web',
        idempotencyKey: 'idemp-key-12345',
        isMockLocation: false,
      });

      expect(res.success).toBe(true);
      expect(res.isReplay).toBe(true);
      expect(res.punchId).toBe('existing-punch-1');
      expect(mockPunchRepo.recordPunchAtomic).not.toHaveBeenCalled();
    });
  });

  describe('Validation & Policy Gates', () => {
    it('rejects punch if mock location is detected', async () => {
      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'mobile',
        isMockLocation: true,
      });

      expect(res.success).toBe(false);
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.MOCK_LOCATION_DETECTED);
      expect(mockPunchRepo.recordPunchAtomic).not.toHaveBeenCalled();
    });

    it('rejects punch if policy is not found', async () => {
      mockPolicyRepo.findEffectivePolicy.mockResolvedValueOnce(null);

      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'web',
        isMockLocation: false,
      });

      expect(res.success).toBe(false);
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.POLICY_NOT_FOUND);
    });

    it('rejects punch if source is not allowed by policy', async () => {
      mockPolicyRepo.findEffectivePolicy.mockResolvedValueOnce({
        policy: { ...defaultPolicy, allowedSources: ['mobile'] },
        assignment: { priority: 1 },
      });

      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'web',
        isMockLocation: false,
      });

      expect(res.success).toBe(false);
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.SOURCE_NOT_ALLOWED);
    });

    it('rejects punch if GPS accuracy exceeds threshold', async () => {
      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'mobile',
        accuracyMeters: 120, // policy max is 50
        isMockLocation: false,
      });

      expect(res.success).toBe(false);
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.ACCURACY_EXCEEDED);
    });

    it('rejects punch if selfie is required but not provided', async () => {
      mockPolicyRepo.findEffectivePolicy.mockResolvedValueOnce({
        policy: { ...defaultPolicy, requireSelfie: true },
        assignment: { priority: 1 },
      });

      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'mobile',
        isMockLocation: false,
      });

      expect(res.success).toBe(false);
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.SELFIE_REQUIRED);
    });
  });

  describe('Velocity & Impossible Travel Check', () => {
    it('detects impossible travel when speed exceeds 1000 km/h', async () => {
      // Previous punch 10 minutes ago in Bangalore
      mockPunchRepo.getLatestPunch.mockResolvedValueOnce({
        id: 'punch-prev',
        punchTime: new Date('2026-10-03T08:50:00Z'),
        punchType: 'in',
        longitude: 77.5946,
        latitude: 12.9716, // Bangalore
        gpsAccuracy: 10,
      });

      // Current punch 10 minutes later in Delhi (~1740 km away)
      const res = await service.recordPunch(sampleContext, {
        punchType: 'out',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'mobile',
        longitude: 77.209,
        latitude: 28.6139, // Delhi
        accuracyMeters: 15,
        isMockLocation: false,
      });

      expect(res.success).toBe(false);
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.IMPOSSIBLE_TRAVEL);
      expect(mockPunchRepo.recordPunchAtomic).not.toHaveBeenCalled();
    });
  });

  describe('Geofence Strict vs Soft Modes', () => {
    it('rejects punch under strict policy when outside geofence', async () => {
      mockPunchRepo.evaluateGeofence.mockResolvedValueOnce({
        locationId: 'loc-1',
        locationName: 'Bangalore HQ',
        timezone: 'Asia/Kolkata',
        geofenceType: 'radius',
        radiusMeters: 100,
        distanceMeters: 350,
        isInside: false,
      });

      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'mobile',
        longitude: 77.6,
        latitude: 12.98,
        accuracyMeters: 15,
        isMockLocation: false,
      });

      expect(res.success).toBe(false);
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.OUTSIDE_GEOFENCE);
      expect(res.isInsideGeofence).toBe(false);
      expect(res.distanceMeters).toBe(350);
      expect(mockPunchRepo.recordPunchAtomic).not.toHaveBeenCalled();
    });

    it('records punch as soft_pending under soft policy when outside geofence', async () => {
      mockPolicyRepo.findEffectivePolicy.mockResolvedValueOnce({
        policy: { ...defaultPolicy, geofenceMode: 'soft' },
        assignment: { priority: 1 },
      });

      mockPunchRepo.evaluateGeofence.mockResolvedValueOnce({
        locationId: 'loc-1',
        locationName: 'Bangalore HQ',
        timezone: 'Asia/Kolkata',
        geofenceType: 'radius',
        radiusMeters: 100,
        distanceMeters: 250,
        isInside: false,
      });

      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'mobile',
        longitude: 77.6,
        latitude: 12.98,
        accuracyMeters: 15,
        isMockLocation: false,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('soft_pending');
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.PENDING_MANAGER_APPROVAL);
      expect(res.workflowRequestId).toBe('wf-req-1');
      expect(mockPunchRepo.recordPunchAtomic).toHaveBeenCalledWith(
        sampleContext.companyId,
        expect.objectContaining({
          status: 'soft_pending',
          reasonCode: PUNCH_REASON_CODES.PENDING_MANAGER_APPROVAL,
          flagReasons: ['OUTSIDE_GEOFENCE'],
        }),
        expect.anything(),
        expect.objectContaining({ managerId: 'mgr-1' }),
        undefined,
      );
    });

    it('records valid punch when inside geofence', async () => {
      const res = await service.recordPunch(sampleContext, {
        punchType: 'in',
        punchTime: new Date('2026-10-03T09:00:00Z'),
        source: 'mobile',
        longitude: 77.5946,
        latitude: 12.9716,
        accuracyMeters: 10,
        isMockLocation: false,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('valid');
      expect(res.reasonCode).toBe(PUNCH_REASON_CODES.PUNCH_SUCCESS);
      expect(res.isInsideGeofence).toBe(true);
      expect(mockPunchRepo.recordPunchAtomic).toHaveBeenCalled();
    });
  });

  describe('Today Summary', () => {
    it('computes worked minutes correctly from IN/OUT punches', async () => {
      mockPunchRepo.getEmployeePunchesForDate.mockResolvedValueOnce([
        {
          id: 'p1',
          punchType: 'in',
          punchTime: new Date('2026-10-03T09:00:00Z'),
          effectiveStatus: 'valid',
        },
        {
          id: 'p2',
          punchType: 'out',
          punchTime: new Date('2026-10-03T13:00:00Z'), // 4 hours = 240 mins
          effectiveStatus: 'valid',
        },
      ]);

      mockPunchRepo.getEmployeePresence.mockResolvedValueOnce({
        status: 'out',
        lastPunchId: 'p2',
        lastPunchTime: new Date('2026-10-03T13:00:00Z'),
      });

      const summary = await service.getTodaySummary(sampleContext);
      expect(summary.totalWorkedMinutes).toBe(240);
      expect(summary.currentPresence).toBe('out');
      expect(summary.punches.length).toBe(2);
    });
  });
});
