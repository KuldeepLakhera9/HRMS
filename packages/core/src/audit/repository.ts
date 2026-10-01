import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import { redactSensitiveData } from './redaction.js';

export interface InsertAuditLogParams {
  companyId: string;
  actorId?: string | null | undefined;
  actorRole?: string | null | undefined;
  action: string;
  entity: string;
  entityId?: string | null | undefined;
  before?: Record<string, unknown> | null | undefined;
  after?: Record<string, unknown> | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | null | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface AuditLogRow {
  id: string;
  ts: Date;
  companyId: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  meta: Record<string, unknown>;
}

export interface AuditLogQueryParams {
  companyId: string;
  entity?: string | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  cursorTs?: string | undefined; // ISO timestamp
  cursorId?: string | undefined;
  limit?: number | undefined;
}

export interface OutboxEventRow {
  id: string;
  companyId: string;
  aggregate: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
}

export class AuditRepository {
  /**
   * Inserts an immutable audit log entry with sensitive fields redacted.
   */
  async insert(
    params: InsertAuditLogParams,
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<string> {
    const id = generateUuidV7();
    const redactedBefore = params.before ? redactSensitiveData(params.before) : null;
    const redactedAfter = params.after ? redactSensitiveData(params.after) : null;
    const redactedMeta = params.meta ? redactSensitiveData(params.meta) : {};

    const executeInsert = async (client: pg.PoolClient | pg.Pool) => {
      await client.query(
        `INSERT INTO audit_logs (
           id, company_id, actor_id, actor_role, action,
           entity, entity_id, before, after, ip,
           user_agent, request_id, meta
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          params.companyId,
          params.actorId || null,
          params.actorRole || null,
          params.action,
          params.entity,
          params.entityId || null,
          redactedBefore ? JSON.stringify(redactedBefore) : null,
          redactedAfter ? JSON.stringify(redactedAfter) : null,
          params.ip || null,
          params.userAgent || null,
          params.requestId || null,
          JSON.stringify(redactedMeta),
        ],
      );
      return id;
    };

    if (clientOverride) {
      return executeInsert(clientOverride);
    }

    return withTenant(
      {
        companyId: params.companyId,
        ...(params.actorId ? { userId: params.actorId } : {}),
      },
      async (_tx, client) => executeInsert(client),
      poolOverride,
    );
  }

  /**
   * Keyset paginated query for audit logs, scoped to tenant and ordered by (ts DESC, id DESC).
   */
  async queryLogs(
    params: AuditLogQueryParams,
    poolOverride?: pg.Pool,
  ): Promise<{ logs: AuditLogRow[]; nextCursor?: { ts: string; id: string } | undefined }> {
    const limit = Math.min(Math.max(params.limit || 50, 1), 100);
    const conditions: string[] = ['company_id = $1'];
    const values: unknown[] = [params.companyId];
    let paramIdx = 2;

    if (params.entity) {
      conditions.push(`entity = $${paramIdx++}`);
      values.push(params.entity);
    }
    if (params.entityId) {
      conditions.push(`entity_id = $${paramIdx++}`);
      values.push(params.entityId);
    }
    if (params.actorId) {
      conditions.push(`actor_id = $${paramIdx++}`);
      values.push(params.actorId);
    }
    if (params.action) {
      conditions.push(`action = $${paramIdx++}`);
      values.push(params.action);
    }

    // Keyset cursor pagination (ts, id)
    if (params.cursorTs && params.cursorId) {
      conditions.push(`(ts, id) < ($${paramIdx++}, $${paramIdx++})`);
      values.push(new Date(params.cursorTs), params.cursorId);
    }

    values.push(limit + 1); // fetch limit + 1 to check if there is a next page
    const limitParamIdx = paramIdx;

    return withTenant(
      { companyId: params.companyId },
      async (_tx, client) => {
        const sql = `
          SELECT id, ts, company_id as "companyId", actor_id as "actorId",
                 actor_role as "actorRole", action, entity, entity_id as "entityId",
                 before, after, ip, user_agent as "userAgent",
                 request_id as "requestId", meta
          FROM audit_logs
          WHERE ${conditions.join(' AND ')}
          ORDER BY ts DESC, id DESC
          LIMIT $${limitParamIdx}
        `;

        const res = await client.query<AuditLogRow>(sql, values);
        const hasMore = res.rows.length > limit;
        const logs = hasMore ? res.rows.slice(0, limit) : res.rows;

        let nextCursor: { ts: string; id: string } | undefined = undefined;
        if (hasMore && logs.length > 0) {
          const last = logs[logs.length - 1]!;
          nextCursor = {
            ts: last.ts instanceof Date ? last.ts.toISOString() : new Date(last.ts).toISOString(),
            id: last.id,
          };
        }

        return { logs, nextCursor };
      },
      poolOverride,
    );
  }

  /**
   * Appends an event to the transactional outbox table.
   */
  async insertOutboxEvent(
    companyId: string,
    aggregate: string,
    type: string,
    payload: Record<string, unknown>,
    client: pg.PoolClient,
  ): Promise<string> {
    const id = generateUuidV7();
    const redactedPayload = redactSensitiveData(payload);

    await client.query(
      `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, companyId, aggregate, type, JSON.stringify(redactedPayload)],
    );

    return id;
  }

  /**
   * Fetches batch of unprocessed outbox events with FOR UPDATE SKIP LOCKED.
   */
  async fetchUnprocessedOutbox(
    limit: number,
    client: pg.PoolClient,
  ): Promise<OutboxEventRow[]> {
    const res = await client.query<OutboxEventRow>(
      `SELECT id, company_id as "companyId", aggregate, type, payload, attempts, created_at as "createdAt"
       FROM outbox_events
       WHERE processed_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return res.rows;
  }

  /**
   * Marks outbox events as processed.
   */
  async markOutboxProcessed(ids: string[], client: pg.PoolClient): Promise<void> {
    if (ids.length === 0) return;
    await client.query(
      `UPDATE outbox_events
       SET processed_at = now()
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }
}
