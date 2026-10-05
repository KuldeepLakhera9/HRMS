import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const dataMigrationBatches = pgTable(
  'data_migration_batches',
  {
    ...baseTenantColumns,
    type: text('type', { enum: ['leave_balances', 'attendance_punches'] }).notNull(),
    status: text('status', { enum: ['preview', 'confirmed', 'completed', 'reverted', 'failed'] }).default('preview').notNull(),
    totalRows: integer('total_rows').default(0).notNull(),
    validRows: integer('valid_rows').default(0).notNull(),
    errorRows: integer('error_rows').default(0).notNull(),
    errorsJson: jsonb('errors_json').$type<Array<Record<string, unknown>>>().default([]).notNull(),
    summaryJson: jsonb('summary_json').$type<Record<string, unknown>>().default({}).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    confirmedBy: uuid('confirmed_by'),
    revertedAt: timestamp('reverted_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_data_migration_batches_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_data_migration_batches_idempotency').on(table.companyId, table.idempotencyKey),
    index('idx_data_migration_batches_type').on(table.companyId, table.type, table.status),
  ],
);

export type DataMigrationBatch = typeof dataMigrationBatches.$inferSelect;
export type NewDataMigrationBatch = typeof dataMigrationBatches.$inferInsert;
