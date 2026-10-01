import type pg from 'pg';
import { ForbiddenError } from '@hrms/shared';
import { PERMISSIONS } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import {
  AuditRepository,
  type AuditLogRow,
  type AuditLogQueryParams,
} from './repository.js';

export interface RecordAuditEventParams {
  action: string;
  entity: string;
  entityId?: string | null | undefined;
  before?: Record<string, unknown> | null | undefined;
  after?: Record<string, unknown> | null | undefined;
  meta?: Record<string, unknown> | undefined;
  clientOverride?: pg.PoolClient | undefined;
  poolOverride?: pg.Pool | undefined;
}

export class AuditService {
  private repository: AuditRepository;

  constructor(repository?: AuditRepository) {
    this.repository = repository ?? new AuditRepository();
  }

  /**
   * Records an immutable audit log entry synchronously.
   */
  async recordEvent(ctx: RequestContext, params: RecordAuditEventParams): Promise<string> {
    return this.repository.insert(
      {
        companyId: ctx.companyId,
        actorId: ctx.userId || null,
        actorRole: ctx.roles?.[0] || null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId || null,
        before: params.before,
        after: params.after,
        ip: ctx.ip || null,
        userAgent: ctx.userAgent || null,
        requestId: ctx.requestId,
        meta: params.meta,
      },
      params.clientOverride,
      params.poolOverride,
    );
  }

  /**
   * Queries audit logs with keyset pagination, enforcing permission checks.
   */
  async queryLogs(
    ctx: RequestContext,
    params: Omit<AuditLogQueryParams, 'companyId'> & { poolOverride?: pg.Pool | undefined },
  ): Promise<{ logs: AuditLogRow[]; nextCursor?: { ts: string; id: string } | undefined }> {
    const hasFullRead = can(ctx, PERMISSIONS.AUDIT_LOG_READ);
    const hasOwnRead = can(ctx, PERMISSIONS.AUDIT_LOG_READ_OWN);

    if (!hasFullRead && !hasOwnRead) {
      throw new ForbiddenError('You do not have permission to view audit logs.');
    }

    // If caller only has own read, strictly enforce actorId to self
    let actorId = params.actorId;
    if (!hasFullRead && hasOwnRead) {
      actorId = ctx.userId;
    }

    return this.repository.queryLogs(
      {
        companyId: ctx.companyId,
        entity: params.entity,
        entityId: params.entityId,
        actorId,
        action: params.action,
        cursorTs: params.cursorTs,
        cursorId: params.cursorId,
        limit: params.limit,
      },
      params.poolOverride,
    );
  }

  /**
   * Appends an event to the transactional outbox table.
   */
  async recordOutboxEvent(
    ctx: RequestContext,
    aggregate: string,
    type: string,
    payload: Record<string, unknown>,
    client: pg.PoolClient,
  ): Promise<string> {
    return this.repository.insertOutboxEvent(
      ctx.companyId,
      aggregate,
      type,
      payload,
      client,
    );
  }
}
