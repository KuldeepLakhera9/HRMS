import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import { withTenant } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { ChangeRequestRepository, type ChangeRequestRow } from './repository.js';
import type { CreateChangeRequestInput, DecideChangeRequestInput } from './validation.js';
import { AuditService } from '../audit/service.js';
import { EmployeeRepository } from '../employee/repository.js';
import { WorkflowService } from '../workflow/service.js';

export class ChangeRequestService {
  private changeRepo: ChangeRequestRepository;
  private employeeRepo: EmployeeRepository;
  private auditService: AuditService;
  private workflowService: WorkflowService;

  constructor(
    changeRepo?: ChangeRequestRepository,
    employeeRepo?: EmployeeRepository,
    auditService?: AuditService,
    workflowService?: WorkflowService,
  ) {
    this.changeRepo = changeRepo ?? new ChangeRequestRepository();
    this.employeeRepo = employeeRepo ?? new EmployeeRepository();
    this.auditService = auditService ?? new AuditService();
    this.workflowService = workflowService ?? new WorkflowService();
  }

  /**
   * Submits a profile change request.
   */
  async submitChangeRequest(
    ctx: RequestContext,
    employeeId: string,
    changes: CreateChangeRequestInput,
    poolOverride?: pg.Pool,
  ): Promise<ChangeRequestRow> {
    const isSelf = ctx.employeeId === employeeId;
    const hasPerm = can(ctx, PERMISSIONS.EMPLOYEE_CHANGEREQUEST_CREATE);

    if (!isSelf && !hasPerm) {
      throw new ForbiddenError('You do not have permission to submit change requests for this employee.');
    }

    const employee = await this.employeeRepo.findById(ctx.companyId, employeeId, poolOverride);
    if (!employee) {
      throw new NotFoundError('Employee not found.');
    }

    return withTenant(
      { companyId: ctx.companyId, ...(ctx.userId ? { userId: ctx.userId } : {}) },
      async (_tx, client) => {
        const req = await this.changeRepo.createChangeRequest(
          ctx.companyId,
          {
            employeeId,
            changes: changes as Record<string, unknown>,
            createdBy: ctx.userId,
          },
          client,
        );

        // Submit to workflow engine if profile_change definition is registered (P2-WF-05)
        try {
          await this.workflowService.submitRequest(
            ctx,
            {
              definitionCode: 'profile_change',
              entityType: 'change_request',
              entityId: req.id,
              requesterId: employeeId,
              payload: {
                employeeId,
                changes: changes as Record<string, unknown>,
              },
            },
            poolOverride,
          );
        } catch {
          // If workflow definition not active yet, leave in standard pending state
        }

        // Record outbox event atomically
        await this.auditService.recordOutboxEvent(
          ctx,
          'change_request',
          'change_request.created',
          {
            requestId: req.id,
            employeeId,
            changes,
          },
          client,
        );

        return req;
      },
      poolOverride,
    );
  }

  /**
   * Backfills pending legacy change requests onto the workflow engine (P2-WF-05).
   */
  async backfillPendingRequests(ctx: RequestContext, poolOverride?: pg.Pool): Promise<number> {
    const pending = await this.changeRepo.listChangeRequests(ctx.companyId, { status: 'pending', limit: 100 }, poolOverride);
    let backfilled = 0;
    for (const req of pending.items) {
      try {
        await this.workflowService.submitRequest(
          ctx,
          {
            definitionCode: 'profile_change',
            entityType: 'change_request',
            entityId: req.id,
            requesterId: req.employeeId,
            payload: {
              employeeId: req.employeeId,
              changes: req.changes,
            },
          },
          poolOverride,
        );
        backfilled++;
      } catch {
        // Already migrated or definition not active
      }
    }
    return backfilled;
  }

  /**
   * Lists change requests (scoped).
   */
  async listChangeRequests(
    ctx: RequestContext,
    params: {
      status?: string | undefined;
      employeeId?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ items: ChangeRequestRow[]; nextCursor?: string | undefined }> {
    // If not HR and requesting list, restrict to self unless manager
    const hasApprove = can(ctx, PERMISSIONS.EMPLOYEE_CHANGEREQUEST_APPROVE);
    let targetEmployeeId = params.employeeId;

    if (!hasApprove) {
      if (!ctx.employeeId) {
        throw new ForbiddenError('Only employees or HR managers can view change requests.');
      }
      targetEmployeeId = ctx.employeeId;
    }

    return this.changeRepo.listChangeRequests(
      ctx.companyId,
      {
        status: params.status,
        employeeId: targetEmployeeId,
        cursor: params.cursor,
        limit: params.limit,
      },
      poolOverride,
    );
  }

  /**
   * Approves or rejects a change request.
   */
  async decideChangeRequest(
    ctx: RequestContext,
    requestId: string,
    input: DecideChangeRequestInput,
    poolOverride?: pg.Pool,
  ): Promise<ChangeRequestRow> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_CHANGEREQUEST_APPROVE)) {
      throw new ForbiddenError('Only HR managers or authorized personnel can approve or reject change requests.');
    }

    const req = await this.changeRepo.findById(ctx.companyId, requestId, poolOverride);
    if (!req) {
      throw new NotFoundError('Change request not found.');
    }

    if (req.status !== 'pending') {
      throw new ForbiddenError(`Cannot decide on change request with status '${req.status}'.`);
    }

    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to decide on change requests.');
    }

    const userId = ctx.userId;

    return withTenant(
      { companyId: ctx.companyId, userId },
      async (_tx, client) => {
        const decided = await this.changeRepo.updateStatus(
          ctx.companyId,
          requestId,
          {
            status: input.decision,
            decidedBy: userId,
            comment: input.comment,
          },
          client,
        );

        if (!decided) {
          throw new NotFoundError('Change request not found or not in pending state.');
        }

        // If approved, apply the requested changes directly to the employee record
        if (input.decision === 'approved') {
          const sets: string[] = ['updated_at = now()', 'row_version = row_version + 1'];
          const values: unknown[] = [ctx.companyId, req.employeeId];
          let pIdx = 3;

          const changes = req.changes as Record<string, unknown>;

          if (changes.phone !== undefined) {
            sets.push(`phone = $${pIdx++}`);
            values.push(changes.phone);
          }
          if (changes.emailPersonal !== undefined) {
            sets.push(`email_personal = $${pIdx++}`);
            values.push(changes.emailPersonal);
          }
          if (changes.maritalStatus !== undefined) {
            sets.push(`marital_status = $${pIdx++}`);
            values.push(changes.maritalStatus);
          }
          if (changes.addresses !== undefined) {
            sets.push(`addresses = $${pIdx++}`);
            values.push(JSON.stringify(changes.addresses));
          }
          if (changes.emergencyContacts !== undefined) {
            sets.push(`emergency_contacts = $${pIdx++}`);
            values.push(JSON.stringify(changes.emergencyContacts));
          }

          if (sets.length > 2) {
            await client.query(
              `UPDATE employees
               SET ${sets.join(', ')}
               WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
              values,
            );
          }

          // Record audit log
          await this.auditService.recordEvent(ctx, {
            action: 'employee.profile.change_request_approved',
            entity: 'employee',
            entityId: req.employeeId,
            before: { requestId, status: req.status },
            after: { requestId, status: 'approved', appliedChanges: req.changes },
            clientOverride: client,
          });
        } else {
          // Record rejection audit log
          await this.auditService.recordEvent(ctx, {
            action: 'employee.profile.change_request_rejected',
            entity: 'change_request',
            entityId: requestId,
            before: { status: req.status },
            after: { status: 'rejected', comment: input.comment },
            clientOverride: client,
          });
        }

        // Insert transactional outbox event
        await this.auditService.recordOutboxEvent(
          ctx,
          'change_request',
          'change_request.decided',
          {
            requestId,
            employeeId: req.employeeId,
            decision: input.decision,
            comment: input.comment,
          },
          client,
        );

        return decided;
      },
      poolOverride,
    );
  }
}
