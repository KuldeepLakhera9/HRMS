import { pgTable, uuid, text, integer, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export interface ImportRowError {
  row: number;
  empCode?: string | undefined;
  column?: string | undefined;
  message: string;
  value?: unknown | undefined;
}

export const importJobs = pgTable(
  'import_jobs',
  {
    ...baseTenantColumns,
    fileId: uuid('file_id'),
    entity: text('entity', { enum: ['employee'] }).default('employee').notNull(),
    status: text('status', {
      enum: ['pending', 'validated', 'processing', 'completed', 'failed'],
    }).default('pending').notNull(),
    totalRows: integer('total_rows').default(0).notNull(),
    validRows: integer('valid_rows').default(0).notNull(),
    errorRows: integer('error_rows').default(0).notNull(),
    errors: jsonb('errors').$type<ImportRowError[]>().default([]),
    summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  },
  table => [
    uniqueIndex('idx_import_jobs_company_id_id').on(table.companyId, table.id),
    index('idx_import_jobs_status').on(table.companyId, table.status, table.createdAt),
  ],
);

export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
