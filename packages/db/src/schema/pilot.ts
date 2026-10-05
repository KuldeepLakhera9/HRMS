import { pgTable, uuid, text, integer, boolean, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const featureFlags = pgTable(
  'feature_flags',
  {
    ...baseTenantColumns,
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isEnabled: boolean('is_enabled').default(false).notNull(),
    rules: jsonb('rules').$type<Record<string, unknown>>().default({}).notNull(),
  },
  table => [
    uniqueIndex('idx_feature_flags_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_feature_flags_key').on(table.companyId, table.key),
  ],
);

export const feedbackSubmissions = pgTable(
  'feedback_submissions',
  {
    ...baseTenantColumns,
    userId: uuid('user_id').notNull(),
    rating: integer('rating').notNull(),
    category: text('category').default('general').notNull(),
    pageContext: text('page_context'),
    message: text('message').notNull(),
  },
  table => [
    uniqueIndex('idx_feedback_submissions_company_id').on(table.companyId, table.id),
    index('idx_feedback_submissions_user').on(table.companyId, table.userId),
  ],
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type FeedbackSubmission = typeof feedbackSubmissions.$inferSelect;
export type NewFeedbackSubmission = typeof feedbackSubmissions.$inferInsert;
