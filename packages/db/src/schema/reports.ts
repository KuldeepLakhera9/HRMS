import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { companies } from './companies.js';
import { users } from './users.js';
import { files } from './files.js';

export const reportRuns = pgTable(
  'report_runs',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    reportKey: text('report_key').notNull(),
    params: jsonb('params'),
    paramsHash: text('params_hash'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('queued'), // queued, running, done, failed
    rows: integer('rows'),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    durationMs: integer('duration_ms'),
    error: text('error'),
    rowVersion: integer('row_version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    unique('report_runs_company_id_id_key').on(table.companyId, table.id),
    index('idx_report_runs_company_user_created').on(
      table.companyId,
      table.requestedBy,
      table.createdAt
    ),
    index('idx_report_runs_company_key_created').on(
      table.companyId,
      table.reportKey,
      table.createdAt
    ),
  ]
);

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    reportKey: text('report_key').notNull(),
    params: jsonb('params'),
    cron: text('cron').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    format: text('format').notNull().default('csv'), // csv, xlsx
    recipients: jsonb('recipients'), // array of email addresses or user IDs
    active: boolean('active').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    unique('report_schedules_company_id_id_key').on(table.companyId, table.id),
    index('idx_report_schedules_company_active').on(
      table.companyId,
      table.active
    ),
  ]
);

export type ReportRun = typeof reportRuns.$inferSelect;
export type NewReportRun = typeof reportRuns.$inferInsert;
export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type NewReportSchedule = typeof reportSchedules.$inferInsert;
