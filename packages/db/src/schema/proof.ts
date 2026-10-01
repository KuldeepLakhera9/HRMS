import { pgTable, text, uuid, unique, foreignKey } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

/**
 * Proof tables demonstrating the RLS and Composite Foreign Key patterns
 * mandated by AGENTS.md Section 4 and docs/PHASE1_SPEC.md.
 */

export const sampleTenantItems = pgTable(
  'sample_tenant_items',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
  },
  table => [
    unique('sample_tenant_items_company_id_id_unique').on(table.companyId, table.id),
  ],
);

export const sampleTenantSubitems = pgTable(
  'sample_tenant_subitems',
  {
    ...baseTenantColumns,
    parentId: uuid('parent_id').notNull(),
    name: text('name').notNull(),
  },
  table => [
    unique('sample_tenant_subitems_company_id_id_unique').on(table.companyId, table.id),
    foreignKey({
      columns: [table.companyId, table.parentId],
      foreignColumns: [sampleTenantItems.companyId, sampleTenantItems.id],
      name: 'fk_sample_subitems_parent_composite',
    }).onDelete('cascade'),
  ],
);

export const sampleAuditLogs = pgTable('sample_audit_logs', {
  ...baseTenantColumns,
  action: text('action').notNull(),
  details: text('details').notNull(),
});

export type SampleTenantItem = typeof sampleTenantItems.$inferSelect;
export type NewSampleTenantItem = typeof sampleTenantItems.$inferInsert;

export type SampleTenantSubitem = typeof sampleTenantSubitems.$inferSelect;
export type NewSampleTenantSubitem = typeof sampleTenantSubitems.$inferInsert;

export type SampleAuditLog = typeof sampleAuditLogs.$inferSelect;
export type NewSampleAuditLog = typeof sampleAuditLogs.$inferInsert;
