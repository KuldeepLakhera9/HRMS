import type pg from 'pg';
import {
  ForbiddenError,
  PERMISSIONS,
  ValidationError,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import {
  LocationRepository,
  type UpdateGeofenceInput,
  type EmployeeLocationAssignmentInput,
} from './repository.js';
import { type GeofenceEvaluationResult, validateWgs84Coordinates } from './geofence.js';

export class LocationService {
  private repository: LocationRepository;
  private auditService: AuditService;

  constructor(repository?: LocationRepository, auditService?: AuditService) {
    this.repository = repository ?? new LocationRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Updates geofence configuration for a work location.
   * Requires permission: org.location.manage.
   */
  async updateGeofence(
    ctx: RequestContext,
    input: UpdateGeofenceInput,
    poolOverride?: pg.Pool,
  ): Promise<{ geofenceVersion: number }> {
    if (!can(ctx, PERMISSIONS.ORG_LOCATION_MANAGE)) {
      throw new ForbiddenError('Permission denied: org.location.manage required to update geofence.');
    }

    if (input.center) {
      validateWgs84Coordinates(input.center.longitude, input.center.latitude);
    }

    if (input.radiusMeters !== undefined && input.radiusMeters !== null && input.radiusMeters <= 0) {
      throw new ValidationError('Radius must be a positive integer in meters.');
    }

    const result = await this.repository.updateGeofence(ctx.companyId, input, poolOverride);

    await this.auditService.recordEvent(ctx, {
      action: 'location.geofence.update',
      entity: 'work_locations',
      entityId: input.locationId,
      after: {
        geofenceType: input.geofenceType,
        radiusMeters: input.radiusMeters,
        version: result.geofenceVersion,
      },
    });

    return result;
  }

  /**
   * Evaluates coordinate against a location's geofence boundaries.
   * Requires permission: org.location.read.
   */
  async testCoordinate(
    ctx: RequestContext,
    locationId: string,
    longitude: number,
    latitude: number,
    accuracyMeters = 10,
    poolOverride?: pg.Pool,
  ): Promise<GeofenceEvaluationResult> {
    if (!can(ctx, PERMISSIONS.ORG_LOCATION_READ)) {
      throw new ForbiddenError('Permission denied: org.location.read required to test coordinate.');
    }

    validateWgs84Coordinates(longitude, latitude);

    return this.repository.testCoordinate(
      ctx.companyId,
      locationId,
      longitude,
      latitude,
      accuracyMeters,
      poolOverride,
    );
  }

  /**
   * Finds the nearest active work location for a punch or check-in attempt.
   */
  async findNearestLocation(
    ctx: RequestContext,
    longitude: number,
    latitude: number,
    accuracyMeters = 10,
    poolOverride?: pg.Pool,
  ): Promise<GeofenceEvaluationResult | null> {
    validateWgs84Coordinates(longitude, latitude);

    return this.repository.findNearestLocation(
      ctx.companyId,
      longitude,
      latitude,
      accuracyMeters,
      poolOverride,
    );
  }

  /**
   * Assigns an employee to a work location.
   * Requires permission: attendance.location.assign or org.location.manage.
   */
  async assignEmployeeLocation(
    ctx: RequestContext,
    input: Omit<EmployeeLocationAssignmentInput, 'createdBy'>,
    poolOverride?: pg.Pool,
  ): Promise<{ assignmentId: string }> {
    const hasPermission =
      can(ctx, PERMISSIONS.ATTENDANCE_LOCATION_ASSIGN) ||
      can(ctx, PERMISSIONS.ORG_LOCATION_MANAGE);

    if (!hasPermission) {
      throw new ForbiddenError('Permission denied: attendance.location.assign required.');
    }

    const id = await this.repository.assignEmployeeLocation(
      ctx.companyId,
      {
        ...input,
        createdBy: ctx.userId ?? 'system',
      },
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'employee.location.assign',
      entity: 'employee_locations',
      entityId: id,
      after: input,
    });

    return { assignmentId: id };
  }

  /**
   * Retrieves covered employee count for a location.
   */
  async getCoveredEmployeesCount(
    ctx: RequestContext,
    locationId: string,
    poolOverride?: pg.Pool,
  ): Promise<{ count: number }> {
    if (!can(ctx, PERMISSIONS.ORG_LOCATION_READ)) {
      throw new ForbiddenError('Permission denied: org.location.read required.');
    }

    const count = await this.repository.getCoveredEmployeesCount(ctx.companyId, locationId, poolOverride);
    return { count };
  }
}
