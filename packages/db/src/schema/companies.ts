import { pgTable, uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../id.js';

export const companies = pgTable('companies', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  name: text('name').notNull(),
  legalName: text('legal_name').notNull(),
  timezone: text('timezone').default('Asia/Kolkata').notNull(),
  currency: text('currency').default('INR').notNull(),
  fiscalYearStartMonth: integer('fiscal_year_start_month').default(4).notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  domain: text('domain').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
