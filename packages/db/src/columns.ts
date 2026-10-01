import { uuid, timestamp, integer } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from './id.js';

/**
 * Standard tenant base columns helper per AGENTS.md Section 4:
 * - id: UUIDv7 generated in app (time-ordered primary key)
 * - company_id: UUID tenant partition identifier
 * - created_at: timestamptz in UTC
 * - updated_at: timestamptz in UTC
 * - created_by: nullable UUID of the acting user
 * - updated_by: nullable UUID of the acting user
 * - deleted_at: nullable timestamptz for soft deletes
 * - row_version: integer for optimistic locking (defaults to 1)
 */
export const baseTenantColumns = {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  companyId: uuid('company_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  rowVersion: integer('row_version').default(1).notNull(),
};
