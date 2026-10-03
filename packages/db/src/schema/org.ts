import { pgTable, uuid, text, boolean, integer, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
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

export const workLocations = pgTable(
  'work_locations',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    code: text('code').notNull(),
    address: jsonb('address').$type<Record<string, unknown>>().default({}).notNull(),
    timezone: text('timezone').default('Asia/Kolkata').notNull(),
    center: text('center'), // PostgreSQL geography(Point, 4326)
    radiusMeters: integer('radius_meters'),
    geofenceType: text('geofence_type').default('radius').notNull(),
    polygon: text('polygon'), // PostgreSQL geography(Polygon, 4326)
    wifiBssids: text('wifi_bssids').array().default([]).notNull(),
    qrSecret: text('qr_secret'),
    geofenceVersion: integer('geofence_version').default(1).notNull(),
    active: boolean('active').default(true).notNull(),
  },
  table => [
    uniqueIndex('idx_work_locations_company_code').on(table.companyId, table.code),
    index('idx_work_locations_company_active').on(table.companyId, table.active),
    index('idx_work_locations_created').on(table.companyId, table.createdAt),
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
export type WorkLocation = typeof workLocations.$inferSelect;
export type NewWorkLocation = typeof workLocations.$inferInsert;
