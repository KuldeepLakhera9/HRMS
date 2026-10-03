import type pg from 'pg';
import {
  ForbiddenError,
  PERMISSIONS,
  UnauthorizedError,
  ValidationError,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import {
  WorkflowRepository,
  type WorkflowDefinitionInput,
  type SubmitWorkflowRequestInput,
  type ExecuteActionInput,
  type WorkflowInboxItem,
} from './repository.js';

export class WorkflowService {
  private repository: WorkflowRepository;
  private auditService: AuditService;

  constructor(repository?: WorkflowRepository, auditService?: AuditService) {
    this.repository = repository ?? new WorkflowRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Registers or updates a workflow definition.
   * Requires permission: workflow.definition.manage.
   */
  async createDefinition(
    ctx: RequestContext,
    input: Omit<WorkflowDefinitionInput, 'createdBy'>,
    poolOverride?: pg.Pool,
  ): Promise<{ id: string; version: number }> {
    if (!can(ctx, PERMISSIONS.WORKFLOW_DEFINITION_MANAGE)) {
      throw new ForbiddenError('Permission denied: workflow.definition.manage required.');
    }

    if (!input.steps || input.steps.length === 0) {
      throw new ValidationError('Workflow must contain at least one step.');
    }

    const result = await this.repository.createDefinition(
      ctx.companyId,
      {
        ...input,
        createdBy: ctx.userId ?? 'system',
      },
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'workflow.definition.create',
      entity: 'workflow_definitions',
      entityId: result.id,
      after: { code: input.code, version: result.version },
    });

    return result;
  }

  /**
   * Submits a workflow request instance pinned to the latest active definition version.
   */
  async submitRequest(
    ctx: RequestContext,
    input: Omit<SubmitWorkflowRequestInput, 'createdBy' | 'requesterId'> & {
      requesterId?: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ requestId: string; status: 'pending' | 'approved' }> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to submit workflow request.');
    }

    const requesterId = input.requesterId ?? ctx.employeeId ?? ctx.userId;
    if (!requesterId) {
      throw new ValidationError('Requester employee ID is required.');
    }

    const result = await this.repository.createRequest(
      ctx.companyId,
      {
        ...input,
        requesterId,
        createdBy: ctx.userId ?? 'system',
      },
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'workflow.request.submit',
      entity: 'workflow_requests',
      entityId: result.requestId,
      after: {
        entityType: input.entityType,
        entityId: input.entityId,
        status: result.status,
      },
    });

    return result;
  }

  /**
   * Retrieves pending or historical inbox items for the authenticated user.
   */
  async getInbox(
    ctx: RequestContext,
    options: {
      status?: 'pending' | 'acted' | 'cancelled';
      limit?: number;
      cursorCreatedAt?: string;
      cursorId?: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ items: WorkflowInboxItem[]; nextCursor?: string | undefined }> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to access workflow inbox.');
    }

    const employeeId = ctx.employeeId ?? ctx.userId;
    if (!employeeId) {
      return { items: [] };
    }

    return this.repository.getInbox(ctx.companyId, employeeId, options, poolOverride);
  }

  /**
   * Executes an approval, rejection, or delegation action on a pending step.
   */
  async executeAction(
    ctx: RequestContext,
    input: Omit<ExecuteActionInput, 'actorId'>,
    poolOverride?: pg.Pool,
  ): Promise<{ status: 'pending' | 'approved' | 'rejected' }> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to act on workflow request.');
    }

    const actorId = ctx.employeeId ?? ctx.userId;
    if (!actorId) {
      throw new ValidationError('Actor employee ID is required.');
    }

    const result = await this.repository.executeAction(
      ctx.companyId,
      {
        ...input,
        actorId,
      },
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: `workflow.action.${input.action}`,
      entity: 'workflow_requests',
      entityId: input.requestId,
      after: {
        action: input.action,
        status: result.status,
        comments: input.comments,
      },
    });

    return result;
  }
}
