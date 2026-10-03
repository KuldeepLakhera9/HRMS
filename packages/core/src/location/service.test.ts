import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenError, PERMISSIONS } from '@hrms/shared';
import { LocationService } from './service.js';
import type { LocationRepository } from './repository.js';
import type { RequestContext } from '../routing/context.js';
import type { AuditService } from '../audit/service.js';

describe('LocationService Unit Tests (P2-LOC-01 & P2-LOC-02)', () => {
  let service: LocationService;
  let mockRepo: Partial<LocationRepository>;
  let mockAudit: Partial<AuditService>;

  const baseCtx: RequestContext = {
    companyId: 'comp-123',
    userId: 'user-admin',
    roles: ['admin'],
    permissions: [PERMISSIONS.ORG_LOCATION_MANAGE, PERMISSIONS.ORG_LOCATION_READ],
    requestId: 'req-1',
    isAuthenticated: true,
  };

  beforeEach(() => {
    mockRepo = {
      updateGeofence: vi.fn().mockResolvedValue({ geofenceVersion: 2 }),
      testCoordinate: vi.fn().mockResolvedValue({
        locationId: 'loc-1',
        locationName: 'Bangalore HQ',
        geofenceType: 'radius',
        distanceMeters: 45,
        radiusMeters: 100,
        accuracyMeters: 10,
        isInside: true,
        status: 'inside',
      }),
      assignEmployeeLocation: vi.fn().mockResolvedValue('assign-1'),
      getCoveredEmployeesCount: vi.fn().mockResolvedValue(42),
    };

    mockAudit = {
      recordEvent: vi.fn().mockResolvedValue('audit-1'),
    };

    service = new LocationService(mockRepo as LocationRepository, mockAudit as AuditService);
  });

  it('updates geofence when caller has permission', async () => {
    const result = await service.updateGeofence(baseCtx, {
      locationId: 'loc-1',
      geofenceType: 'radius',
      radiusMeters: 150,
      center: { longitude: 77.5946, latitude: 12.9716 },
    });

    expect(result.geofenceVersion).toBe(2);
    expect(mockRepo.updateGeofence).toHaveBeenCalled();
    expect(mockAudit.recordEvent).toHaveBeenCalled();
  });

  it('rejects updateGeofence if caller lacks org.location.manage', async () => {
    const unauthCtx: RequestContext = {
      ...baseCtx,
      permissions: [PERMISSIONS.ORG_LOCATION_READ],
    };

    await expect(
      service.updateGeofence(unauthCtx, {
        locationId: 'loc-1',
        geofenceType: 'radius',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('tests coordinate and returns evaluation breakdown', async () => {
    const result = await service.testCoordinate(baseCtx, 'loc-1', 77.5946, 12.9716, 15);

    expect(result.status).toBe('inside');
    expect(result.distanceMeters).toBe(45);
    expect(mockRepo.testCoordinate).toHaveBeenCalledWith(
      'comp-123',
      'loc-1',
      77.5946,
      12.9716,
      15,
      undefined,
    );
  });

  it('assigns employee location and logs audit trail', async () => {
    const assignCtx: RequestContext = {
      ...baseCtx,
      permissions: [PERMISSIONS.ATTENDANCE_LOCATION_ASSIGN],
    };

    const res = await service.assignEmployeeLocation(assignCtx, {
      employeeId: 'emp-1',
      locationId: 'loc-1',
      assignmentType: 'fixed',
      validFrom: '2026-10-01',
    });

    expect(res.assignmentId).toBe('assign-1');
    expect(mockRepo.assignEmployeeLocation).toHaveBeenCalled();
    expect(mockAudit.recordEvent).toHaveBeenCalled();
  });
});
