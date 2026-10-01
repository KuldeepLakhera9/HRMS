import { pgTable, uuid, text, boolean, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const departments = pgTable(
  'departments',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    code: text('code').notNull(),
    parentId: uuid('parent_id'),
    headEmployeeId: uuid('head_employee_id'),
    active: boolean('active').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_departments_company_code').on(table.companyId, table.code),
  ],
);

export const designations = pgTable(
  'designations',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    code: text('code').notNull(),
    active: boolean('active').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_designations_company_code').on(table.companyId, table.code),
  ],
);

export const grades = pgTable(
  'grades',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    code: text('code').notNull(),
    level: integer('level').default(1).notNull(),
    active: boolean('active').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_grades_company_code').on(table.companyId, table.code),
  ],
);

export const costCenters = pgTable(
  'cost_centers',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    code: text('code').notNull(),
    active: boolean('active').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_cost_centers_company_code').on(table.companyId, table.code),
  ],
);

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type Designation = typeof designations.$inferSelect;
export type NewDesignation = typeof designations.$inferInsert;
export type Grade = typeof grades.$inferSelect;
export type NewGrade = typeof grades.$inferInsert;
export type CostCenter = typeof costCenters.$inferSelect;
export type NewCostCenter = typeof costCenters.$inferInsert;
