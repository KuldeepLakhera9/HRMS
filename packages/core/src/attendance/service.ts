import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { getRedisClient } from '../redis/client.js';
import { AuditService } from '../audit/service.js';
import {
  AttendancePolicyRepository,
  type AttendancePolicyRecord,
  type AttendancePolicyAssignmentRecord,
  type EffectivePolicyResult,
} from './repository.js';
import type {
  CreateAttendancePolicyInput,
  UpdateAttendancePolicyInput,
  AssignAttendancePolicyInput,
} from './validation.js';

export class AttendancePolicyService {
  private repository: AttendancePolicyRepository;
  private auditService: AuditService;

  constructor(repository?: AttendancePolicyRepository, auditService?: AuditService) {
    this.repository = repository ?? new AttendancePolicyRepository();
    this.auditService = auditService ?? new AuditService();
  }

  private getCacheKey(companyId: string, employeeId: string, dateStr: string): string {
    return `att_policy:${companyId}:${employeeId}:${dateStr}`;
  }

  /**
   * Invalidates Redis cached effective policies for a company.
   */
  async invalidatePolicyCache(companyId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          `att_policy:${companyId}:*`,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      // Redis errors should not fail database operations
    }
  }

  /**
   * Creates a new attendance policy.
   */
  async createPolicy(
    ctx: RequestContext,
    input: CreateAttendancePolicyInput,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_POLICY_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage attendance policies.');
    }

    const existing = await this.repository.getPolicyByCode(ctx.companyId, input.code, poolOverride);
    if (existing) {
      throw new ConflictError(`Attendance policy with code '${input.code}' already exists.`);
    }

    const policy = await this.repository.createPolicy(
      ctx.companyId,
      { ...input, createdBy: ctx.userId ?? 'system' },
      poolOverride,
    );

    await this.invalidatePolicyCache(ctx.companyId);

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.policy.create',
      entity: 'attendance_policies',
      entityId: policy.id,
      after: policy as unknown as Record<string, unknown>,
      poolOverride,
    });

    return policy;
  }

  /**
   * Updates an existing attendance policy.
   */
  async updatePolicy(
    ctx: RequestContext,
    id: string,
    input: UpdateAttendancePolicyInput,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_POLICY_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage attendance policies.');
    }

    const before = await this.repository.getPolicyById(ctx.companyId, id, poolOverride);
    if (!before) {
      throw new NotFoundError('Attendance policy not found.');
    }

    const updated = await this.repository.updatePolicy(
      ctx.companyId,
      id,
      { ...input, updatedBy: ctx.userId ?? 'system' },
      poolOverride,
    );

    if (!updated) {
      throw new NotFoundError('Attendance policy not found.');
    }

    await this.invalidatePolicyCache(ctx.companyId);

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.policy.update',
      entity: 'attendance_policies',
      entityId: id,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      poolOverride,
    });

    return updated;
  }

  /**
   * Retrieves a single attendance policy by ID.
   */
  async getPolicy(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_POLICY_READ)) {
      throw new ForbiddenError('You do not have permission to view attendance policies.');
    }

    const policy = await this.repository.getPolicyById(ctx.companyId, id, poolOverride);
    if (!policy) {
      throw new NotFoundError('Attendance policy not found.');
    }

    return policy;
  }

  /**
   * Lists all attendance policies for the company.
   */
  async listPolicies(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyRecord[]> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_POLICY_READ)) {
      throw new ForbiddenError('You do not have permission to view attendance policies.');
    }

    return this.repository.listPolicies(ctx.companyId, poolOverride);
  }

  /**
   * Assigns an attendance policy to an employee, department, location, or company.
   */
  async assignPolicy(
    ctx: RequestContext,
    input: AssignAttendancePolicyInput,
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyAssignmentRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_POLICY_MANAGE)) {
      throw new ForbiddenError('You do not have permission to assign attendance policies.');
    }

    const policy = await this.repository.getPolicyById(ctx.companyId, input.policyId, poolOverride);
    if (!policy) {
      throw new NotFoundError('Attendance policy not found.');
    }

    const assignment = await this.repository.createAssignment(
      ctx.companyId,
      { ...input, createdBy: ctx.userId ?? 'system' },
      poolOverride,
    );

    await this.invalidatePolicyCache(ctx.companyId);

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.policy.assign',
      entity: 'attendance_policy_assignments',
      entityId: assignment.id,
      after: assignment as unknown as Record<string, unknown>,
      poolOverride,
    });

    return assignment;
  }

  /**
   * Lists attendance policy assignments.
   */
  async listAssignments(
    ctx: RequestContext,
    filters?: { policyId?: string; targetType?: string; targetId?: string },
    poolOverride?: pg.Pool,
  ): Promise<AttendancePolicyAssignmentRecord[]> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_POLICY_READ)) {
      throw new ForbiddenError('You do not have permission to view policy assignments.');
    }

    return this.repository.listAssignments(ctx.companyId, filters, poolOverride);
  }

  /**
   * Resolves the effective attendance policy for an employee on a given date.
   * Priority: Employee (1) > Department (2) > Location (3) > Company Default (4).
   * Result is cached in Redis with a 1-hour TTL.
   */
  async resolveEffectivePolicy(
    ctx: RequestContext,
    employeeId: string,
    dateStr?: string,
    poolOverride?: pg.Pool,
  ): Promise<EffectivePolicyResult | null> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_POLICY_READ)) {
      throw new ForbiddenError('You do not have permission to view attendance policies.');
    }

    const targetDate = dateStr ?? new Date().toISOString().slice(0, 10);
    const cacheKey = this.getCacheKey(ctx.companyId, employeeId, targetDate);

    // 1. Try Redis cache
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as EffectivePolicyResult;
      }
    } catch {
      // Redis miss / error fallback
    }

    // 2. Fetch employee's org details (departmentId, locationId)
    const orgDetails = await this.repository.getEmployeeOrgDetails(
      ctx.companyId,
      employeeId,
      poolOverride,
    );
    if (!orgDetails) {
      throw new NotFoundError(`Employee with ID '${employeeId}' not found.`);
    }

    // 3. Resolve effective assignment via single ordered query
    const effective = await this.repository.findEffectiveAssignment(
      ctx.companyId,
      employeeId,
      orgDetails.departmentId,
      orgDetails.locationId,
      targetDate,
      poolOverride,
    );

    // 4. Cache resolved policy if found
    if (effective) {
      try {
        const redis = getRedisClient();
        await redis.set(cacheKey, JSON.stringify(effective), 'EX', 3600);
      } catch {
        // Cache write errors do not block return
      }
    }

    return effective;
  }
}
