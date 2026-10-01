import { pgTable, uuid, text, timestamp, jsonb, index, primaryKey } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../id.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .$defaultFn(() => generateUuidV7())
      .notNull(),
    ts: timestamp('ts', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    companyId: uuid('company_id').notNull(),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}).notNull(),
  },
  table => [
    primaryKey({ columns: [table.id, table.ts] }),
    index('idx_audit_logs_company_entity').on(table.companyId, table.entity, table.entityId, table.ts),
    index('idx_audit_logs_company_actor').on(table.companyId, table.actorId, table.ts),
    index('idx_audit_logs_company_action').on(table.companyId, table.action, table.ts),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
