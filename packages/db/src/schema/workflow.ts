import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    ...baseTenantColumns,
    code: text('code').notNull(),
    name: text('name').notNull(),
    entityType: text('entity_type').notNull(),
    version: integer('version').default(1).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    steps: jsonb('steps').$type<Array<Record<string, unknown>>>().notNull(),
  },
  table => [
    uniqueIndex('idx_workflow_definitions_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_workflow_definitions_version').on(table.companyId, table.code, table.version),
    index('idx_wf_definitions_lookup').on(table.companyId, table.entityType, table.isActive),
  ],
);

export const workflowRequests = pgTable(
  'workflow_requests',
  {
    ...baseTenantColumns,
    definitionId: uuid('definition_id').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    requesterId: uuid('requester_id').notNull(),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled'>()
      .notNull(),
    currentStepIndex: integer('current_step_index').default(0).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  table => [
    uniqueIndex('idx_workflow_requests_company_id').on(table.companyId, table.id),
    index('idx_wf_requests_inbox').on(table.companyId, table.status, table.createdAt),
    index('idx_wf_requests_entity').on(table.companyId, table.entityType, table.entityId),
  ],
);

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    ...baseTenantColumns,
    requestId: uuid('request_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    name: text('name').notNull(),
    mode: text('mode').$type<'any' | 'all'>().notNull(),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected' | 'skipped'>()
      .notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => [
    uniqueIndex('idx_workflow_steps_company_id').on(table.companyId, table.id),
    index('idx_wf_steps_due').on(table.companyId, table.status, table.dueAt),
  ],
);

export const workflowAssignees = pgTable(
  'workflow_assignees',
  {
    ...baseTenantColumns,
    requestId: uuid('request_id').notNull(),
    stepId: uuid('step_id').notNull(),
    assigneeId: uuid('assignee_id').notNull(),
    originalAssigneeId: uuid('original_assignee_id'),
    isDelegated: boolean('is_delegated').default(false).notNull(),
    status: text('status').$type<'pending' | 'acted' | 'cancelled'>().notNull(),
  },
  table => [
    uniqueIndex('idx_workflow_assignees_company_id').on(table.companyId, table.id),
    index('idx_wf_assignees_inbox').on(
      table.companyId,
      table.assigneeId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const workflowActions = pgTable(
  'workflow_actions',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id').notNull(),
    requestId: uuid('request_id').notNull(),
    stepId: uuid('step_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    action: text('action').$type<'approve' | 'reject' | 'delegate' | 'withdraw'>().notNull(),
    comments: text('comments'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').notNull(),
    rowVersion: integer('row_version').default(1).notNull(),
  },
  table => [
    uniqueIndex('idx_workflow_actions_company_id').on(table.companyId, table.id),
    index('idx_wf_actions_request').on(table.companyId, table.requestId, table.createdAt),
  ],
);

export const workflowDelegations = pgTable(
  'workflow_delegations',
  {
    ...baseTenantColumns,
    delegatorId: uuid('delegator_id').notNull(),
    delegateeId: uuid('delegatee_id').notNull(),
    entityType: text('entity_type'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_workflow_delegations_company_id').on(table.companyId, table.id),
    index('idx_wf_delegations_lookup').on(
      table.companyId,
      table.delegatorId,
      table.isActive,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
export type NewWorkflowDefinition = typeof workflowDefinitions.$inferInsert;
export type WorkflowRequest = typeof workflowRequests.$inferSelect;
export type NewWorkflowRequest = typeof workflowRequests.$inferInsert;
export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type NewWorkflowStep = typeof workflowSteps.$inferInsert;
export type WorkflowAssignee = typeof workflowAssignees.$inferSelect;
export type NewWorkflowAssignee = typeof workflowAssignees.$inferInsert;
export type WorkflowAction = typeof workflowActions.$inferSelect;
export type NewWorkflowAction = typeof workflowActions.$inferInsert;
export type WorkflowDelegation = typeof workflowDelegations.$inferSelect;
export type NewWorkflowDelegation = typeof workflowDelegations.$inferInsert;
