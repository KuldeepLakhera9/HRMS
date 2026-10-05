import type pg from 'pg';
import { DateTime } from 'luxon';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { AuditService } from '../audit/service.js';
import { RegularizationRepository, type RegularizationRecord } from './regularization-repository.js';
import { AttendanceLockService } from './lock-service.js';
import { AttendanceDayService } from './day-service.js';
import { WorkflowService } from '../workflow/service.js';
import type {
  CreateRegularizationInput,
  ListRegularizationsQuery,
  DecideRegularizationInput,
} from './regularization-validation.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveAuditUserId(userId?: string): string {
  if (userId && UUID_REGEX.test(userId)) return userId;
  return NIL_UUID;
}

export class RegularizationService {
  private repo: RegularizationRepository;
  private lockService: AttendanceLockService;
  private dayService: AttendanceDayService;
  private workflowService: WorkflowService;
  private auditService: AuditService;

  constructor(
    repo?: RegularizationRepository,
    lockService?: AttendanceLockService,
    dayService?: AttendanceDayService,
    workflowService?: WorkflowService,
    auditService?: AuditService,
  ) {
    this.repo = repo ?? new RegularizationRepository();
    this.lockService = lockService ?? new AttendanceLockService();
    this.dayService = dayService ?? new AttendanceDayService();
    this.workflowService = workflowService ?? new WorkflowService();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Submits a regularization request through the workflow engine.
   * Enforces locked-period immutability and submission window rules.
   */
  async submitRequest(
    ctx: RequestContext,
    input: CreateRegularizationInput,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord> {
    const employeeId = input.employeeId ?? ctx.employeeId;
    if (!employeeId) {
      throw new ValidationError('Employee ID is required to submit a regularization request.');
    }

    const isSelf = ctx.employeeId === employeeId;
    const canManage = can(ctx, PERMISSIONS.ATTENDANCE_REGULARIZATION_CREATE);

    if (!isSelf && !canManage) {
      throw new ForbiddenError('You do not have permission to submit regularization for this employee.');
    }

    // 1. Enforce that future dates cannot be regularized
    const reqDate = DateTime.fromISO(input.date);
    const today = DateTime.now().startOf('day');
    if (reqDate > today) {
      throw new ValidationError('Cannot regularize attendance for future dates.');
    }

    // 2. Enforce locked-period check (immutability rule)
    const isLocked = await this.lockService.isDateLocked(ctx.companyId, input.date, poolOverride);
    if (isLocked) {
      throw new ConflictError(
        `Attendance period for date ${input.date} is locked and immutable. Regularization is prohibited.`,
      );
    }

    // 3. Create pending regularization request record
    const regRecord = await this.repo.createRequest(
      ctx.companyId,
      {
        ...input,
        employeeId,
        createdBy: resolveAuditUserId(ctx.userId),
      },
      poolOverride,
    );

    // 4. Submit via workflow engine if definition exists
    try {
      const wfResult = await this.workflowService.submitRequest(
        ctx,
        {
          definitionCode: 'attendance_regularization',
          entityType: 'attendance_regularization',
          entityId: regRecord.id,
          payload: {
            employeeId,
            date: input.date,
            requestType: input.requestType,
            inTime: input.inTime,
            outTime: input.outTime,
            reason: input.reason,
          },
        },
        poolOverride,
      );

      // Link workflow request ID to regularization record
      if (wfResult.requestId) {
        regRecord.workflowRequestId = wfResult.requestId;
      }
    } catch {
      // In dev or unit test environments without seeded workflow definitions, keep pending
    }

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.regularization.requested',
      entity: 'attendance_regularization_requests',
      entityId: regRecord.id,
      after: regRecord as unknown as Record<string, unknown>,
      poolOverride,
    });

    return regRecord;
  }

  /**
   * Decides a regularization request (approve or reject).
   * Upon approval, synthesizes punches, recalculates attendance day, and updates day records.
   */
  async decideRequest(
    ctx: RequestContext,
    id: string,
    input: DecideRegularizationInput,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_REGULARIZATION_APPROVE)) {
      throw new ForbiddenError('You do not have permission to approve or reject attendance regularizations.');
    }

    const reg = await this.repo.getRequestById(ctx.companyId, id, poolOverride);
    if (!reg) {
      throw new NotFoundError('Regularization request', id);
    }

    if (reg.status !== 'pending') {
      throw new ConflictError(`Regularization request is already ${reg.status}.`);
    }

    // Re-verify that the period was not locked in the interim
    const isLocked = await this.lockService.isDateLocked(ctx.companyId, reg.date, poolOverride);
    if (isLocked) {
      throw new ConflictError(
        `Attendance period for date ${reg.date} is now locked. Approval cannot proceed.`,
      );
    }

    const auditUserId = resolveAuditUserId(ctx.userId);

    if (input.action === 'reject') {
      const rejected = await this.repo.updateStatus(
        ctx.companyId,
        id,
        'rejected',
        undefined,
        auditUserId,
        poolOverride,
      );

      await this.auditService.recordEvent(ctx, {
        action: 'attendance.regularization.rejected',
        entity: 'attendance_regularization_requests',
        entityId: id,
        after: { id, status: 'rejected', comments: input.comments },
        poolOverride,
      });

      return rejected ?? reg;
    }

    // --- APPROVAL FLOW ---
    let syntheticInPunchId: string | undefined;
    let syntheticOutPunchId: string | undefined;

    // 1. Create synthetic IN punch if inTime is provided
    if (reg.inTime) {
      const inIso = `${reg.date}T${reg.inTime.length === 5 ? reg.inTime + ':00' : reg.inTime}Z`;
      syntheticInPunchId = await this.repo.insertSyntheticPunch(
        ctx.companyId,
        {
          employeeId: reg.employeeId,
          punchTime: new Date(inIso),
          punchType: 'in',
          workDate: reg.date,
        },
        poolOverride,
      );
    }

    // 2. Create synthetic OUT punch if outTime is provided
    if (reg.outTime) {
      const outIso = `${reg.date}T${reg.outTime.length === 5 ? reg.outTime + ':00' : reg.outTime}Z`;
      syntheticOutPunchId = await this.repo.insertSyntheticPunch(
        ctx.companyId,
        {
          employeeId: reg.employeeId,
          punchTime: new Date(outIso),
          punchType: 'out',
          workDate: reg.date,
        },
        poolOverride,
      );
    }

    // 3. Mark regularization record as approved
    const approved = await this.repo.updateStatus(
      ctx.companyId,
      id,
      'approved',
      { inPunchId: syntheticInPunchId, outPunchId: syntheticOutPunchId },
      auditUserId,
      poolOverride,
    );

    // 4. Trigger attendance day recalculation (pure engine updates attendance_days with isRegularized = true)
    await this.dayService.recomputeDay(
      ctx,
      reg.employeeId,
      reg.date,
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.regularization.approved',
      entity: 'attendance_regularization_requests',
      entityId: id,
      after: {
        id,
        status: 'approved',
        syntheticInPunchId,
        syntheticOutPunchId,
        comments: input.comments,
      },
      poolOverride,
    });

    return approved ?? reg;
  }

  /**
   * Retrieves a regularization request by ID.
   */
  async getRequestById(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord> {
    const reg = await this.repo.getRequestById(ctx.companyId, id, poolOverride);
    if (!reg) {
      throw new NotFoundError('Regularization request', id);
    }

    const isSelf = ctx.employeeId === reg.employeeId;
    const canRead = can(ctx, PERMISSIONS.ATTENDANCE_REGULARIZATION_READ);

    if (!isSelf && !canRead) {
      throw new ForbiddenError('You do not have permission to view this regularization request.');
    }

    return reg;
  }

  /**
   * Lists regularization requests with filtering.
   */
  async listRequests(
    ctx: RequestContext,
    query: ListRegularizationsQuery,
    poolOverride?: pg.Pool,
  ): Promise<RegularizationRecord[]> {
    const canReadOthers = can(ctx, PERMISSIONS.ATTENDANCE_REGULARIZATION_READ);

    // If caller cannot read all regularizations, restrict to their own employee ID
    const targetEmployeeId = canReadOthers ? query.employeeId : ctx.employeeId;
    if (!canReadOthers && !targetEmployeeId) {
      return [];
    }

    return this.repo.listRequests(
      ctx.companyId,
      { ...query, employeeId: targetEmployeeId },
      poolOverride,
    );
  }
}
