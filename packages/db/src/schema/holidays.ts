import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const holidayLists = pgTable(
  'holiday_lists',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    year: integer('year').notNull(),
    locationId: uuid('location_id'),
    isDefault: boolean('is_default').default(false).notNull(),
  },
  table => [
    uniqueIndex('idx_holiday_lists_company_id').on(table.companyId, table.id),
    index('idx_holiday_lists_year').on(table.companyId, table.year),
  ],
);

export const holidays = pgTable(
  'holidays',
  {
    ...baseTenantColumns,
    listId: uuid('list_id').notNull(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<'public' | 'optional' | 'restricted'>().default('public').notNull(),
  },
  table => [
    uniqueIndex('idx_holidays_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_holidays_list_date').on(table.companyId, table.listId, table.date),
    index('idx_holidays_date').on(table.companyId, table.date),
  ],
);

export const holidayAssignments = pgTable(
  'holiday_assignments',
  {
    ...baseTenantColumns,
    scope: text('scope').$type<'company' | 'location'>().notNull(),
    locationId: uuid('location_id'),
    listId: uuid('list_id').notNull(),
  },
  table => [
    uniqueIndex('idx_holiday_assignments_company_id').on(table.companyId, table.id),
    index('idx_holiday_assignments_lookup').on(table.companyId, table.scope, table.locationId),
  ],
);
