import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const helpdeskCategories = pgTable(
  'helpdesk_categories',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    code: text('code').notNull(),
    defaultAssigneeRole: text('default_assignee_role').default('hr_manager').notNull(),
    slaHours: integer('sla_hours').default(48).notNull(),
  },
  table => [
    uniqueIndex('idx_helpdesk_categories_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_helpdesk_categories_code').on(table.companyId, table.code),
  ],
);

export const helpdeskTickets = pgTable(
  'helpdesk_tickets',
  {
    ...baseTenantColumns,
    ticketNumber: text('ticket_number').notNull(),
    categoryId: uuid('category_id').notNull(),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    priority: text('priority', { enum: ['low', 'medium', 'high', 'urgent'] }).default('medium').notNull(),
    status: text('status', { enum: ['open', 'in_progress', 'resolved', 'closed'] }).default('open').notNull(),
    creatorUserId: uuid('creator_user_id').notNull(),
    assigneeUserId: uuid('assignee_user_id'),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true, mode: 'date' }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_helpdesk_tickets_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_helpdesk_tickets_number').on(table.companyId, table.ticketNumber),
    index('idx_helpdesk_tickets_status').on(table.companyId, table.status),
    index('idx_helpdesk_tickets_creator').on(table.companyId, table.creatorUserId),
    index('idx_helpdesk_tickets_assignee').on(table.companyId, table.assigneeUserId),
  ],
);

export const helpdeskComments = pgTable(
  'helpdesk_comments',
  {
    ...baseTenantColumns,
    ticketId: uuid('ticket_id').notNull(),
    userId: uuid('user_id').notNull(),
    commentMd: text('comment_md').notNull(),
    isInternal: boolean('is_internal').default(false).notNull(),
  },
  table => [
    uniqueIndex('idx_helpdesk_comments_company_id').on(table.companyId, table.id),
    index('idx_helpdesk_comments_ticket').on(table.companyId, table.ticketId, table.createdAt),
  ],
);

export type HelpdeskCategory = typeof helpdeskCategories.$inferSelect;
export type NewHelpdeskCategory = typeof helpdeskCategories.$inferInsert;
export type HelpdeskTicket = typeof helpdeskTickets.$inferSelect;
export type NewHelpdeskTicket = typeof helpdeskTickets.$inferInsert;
export type HelpdeskComment = typeof helpdeskComments.$inferSelect;
export type NewHelpdeskComment = typeof helpdeskComments.$inferInsert;
