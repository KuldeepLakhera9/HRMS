import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const changeRequests = pgTable(
  'change_requests',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    changes: jsonb('changes').$type<Record<string, unknown>>().notNull(),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected'],
    }).default('pending').notNull(),
    decidedBy: uuid('decided_by'),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_change_requests_company_id_id').on(table.companyId, table.id),
    index('idx_change_requests_status_created').on(table.companyId, table.status, table.createdAt),
    index('idx_change_requests_emp_created').on(table.companyId, table.employeeId, table.createdAt),
  ],
);

export type ChangeRequest = typeof changeRequests.$inferSelect;
export type NewChangeRequest = typeof changeRequests.$inferInsert;
