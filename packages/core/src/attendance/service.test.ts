import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendancePolicyService } from './service.js';
import { AttendancePolicyRepository, type AttendancePolicyRecord, type EffectivePolicyResult } from './repository.js';
import { PERMISSIONS, ForbiddenError } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';

vi.mock('../redis/client.js', () => {
  const store = new Map<string, string>();
  return {
    getRedisClient: vi.fn(() => ({
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, val: string) => {
        store.set(key, val);
        return 'OK';
      }),
      del: vi.fn(async (...keys: string[]) => {
        keys.forEach(k => store.delete(k));
        return keys.length;
      }),
      scan: vi.fn(async (_cursor: string) => ['0', Array.from(store.keys())]),
    })),
  };
});

describe('AttendancePolicyService', () => {
  let service: AttendancePolicyService;
  let mockRepo: AttendancePolicyRepository;

  const mockContext: RequestContext = {
    companyId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    employeeId: '33333333-3333-3333-3333-333333333333',
    roles: ['admin'],
    permissions: [PERMISSIONS.ATTENDANCE_POLICY_READ, PERMISSIONS.ATTENDANCE_POLICY_MANAGE],
    requestId: 'req-test-1',
    isAuthenticated: true,
  };

  const restrictedContext: RequestContext = {
    ...mockContext,
    permissions: [],
  };

  const samplePolicy: AttendancePolicyRecord = {
    id: '44444444-4444-4444-4444-444444444444',
    companyId: mockContext.companyId,
    code: 'STANDARD_HQ',
    name: 'Standard HQ Policy',
    description: 'HQ office policy with geofence',
    geofenceMode: 'strict',
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

  let mockAuditService: { recordEvent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRepo = new AttendancePolicyRepository();
    mockAuditService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    service = new AttendancePolicyService(mockRepo, mockAuditService as unknown as import('../audit/service.js').AuditService);
    vi.clearAllMocks();
  });

  describe('Authorization checks', () => {
    it('throws ForbiddenError when listing policies without ATTENDANCE_POLICY_READ', async () => {
      await expect(service.listPolicies(restrictedContext)).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when creating policy without ATTENDANCE_POLICY_MANAGE', async () => {
      await expect(
        service.createPolicy(restrictedContext, {
          code: 'TEST',
          name: 'Test',
          geofenceMode: 'strict',
          allowSelfie: false,
          requireSelfie: false,
          maxGpsAccuracyMeters: 50,
          allowedSources: ['mobile'],
          graceMinutes: 15,
          halfDayMinutes: 240,
          fullDayMinutes: 480,
          autoPunchOutHours: '12.0',
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('CRUD operations', () => {
    it('creates a policy successfully and invalidates cache', async () => {
      vi.spyOn(mockRepo, 'getPolicyByCode').mockResolvedValue(null);
      vi.spyOn(mockRepo, 'createPolicy').mockResolvedValue(samplePolicy);
      const invalidateSpy = vi.spyOn(service, 'invalidatePolicyCache');

      const result = await service.createPolicy(mockContext, {
        code: 'STANDARD_HQ',
        name: 'Standard HQ Policy',
        geofenceMode: 'strict',
        allowSelfie: false,
        requireSelfie: false,
        maxGpsAccuracyMeters: 50,
        allowedSources: ['mobile', 'web'],
        graceMinutes: 15,
        halfDayMinutes: 240,
        fullDayMinutes: 480,
        autoPunchOutHours: '12.0',
      });

      expect(result).toEqual(samplePolicy);
      expect(invalidateSpy).toHaveBeenCalledWith(mockContext.companyId);
    });

    it('creates an assignment and invalidates cache', async () => {
      vi.spyOn(mockRepo, 'getPolicyById').mockResolvedValue(samplePolicy);
      vi.spyOn(mockRepo, 'createAssignment').mockResolvedValue({
        id: 'assign-1',
        companyId: mockContext.companyId,
        policyId: samplePolicy.id,
        priority: 1,
        targetType: 'employee',
        targetId: mockContext.employeeId ?? null,
        validFrom: '2026-01-01',
        validTo: null,
        createdAt: new Date(),
      });
      const invalidateSpy = vi.spyOn(service, 'invalidatePolicyCache');

      const assignment = await service.assignPolicy(mockContext, {
        policyId: samplePolicy.id,
        targetType: 'employee',
        targetId: mockContext.employeeId,
        validFrom: '2026-01-01',
      });

      expect(assignment.priority).toBe(1);
      expect(invalidateSpy).toHaveBeenCalledWith(mockContext.companyId);
    });
  });

  describe('Effective Policy Resolution & Hierarchical Precedence', () => {
    it('resolves effective policy using employee org details and caches result', async () => {
      vi.spyOn(mockRepo, 'getEmployeeOrgDetails').mockResolvedValue({
        departmentId: 'dept-111',
        locationId: 'loc-111',
      });

      const mockEffectiveResult: EffectivePolicyResult = {
        policy: samplePolicy,
        assignment: {
          id: 'assign-1',
          priority: 2, // Department level
          targetType: 'department',
          targetId: 'dept-111',
          validFrom: '2026-01-01',
          validTo: null,
        },
      };

      const findEffectiveSpy = vi
        .spyOn(mockRepo, 'findEffectiveAssignment')
        .mockResolvedValue(mockEffectiveResult);

      // First call (cache miss)
      const res1 = await service.resolveEffectivePolicy(
        mockContext,
        mockContext.employeeId!,
        '2026-10-03',
      );

      expect(res1).toEqual(mockEffectiveResult);
      expect(findEffectiveSpy).toHaveBeenCalledTimes(1);

      // Second call (cache hit)
      const res2 = await service.resolveEffectivePolicy(
        mockContext,
        mockContext.employeeId!,
        '2026-10-03',
      );

      expect(res2?.policy.id).toBe(samplePolicy.id);
      expect(res2?.policy.code).toBe(samplePolicy.code);
      expect(res2?.assignment.priority).toBe(2);
      expect(findEffectiveSpy).toHaveBeenCalledTimes(1);
    });
  });
});
