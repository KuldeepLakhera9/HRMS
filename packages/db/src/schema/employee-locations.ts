import { pgTable, uuid, text, date, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const employeeLocations = pgTable(
  'employee_locations',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    locationId: uuid('location_id').notNull(),
    assignmentType: text('assignment_type').$type<'fixed' | 'flexible' | 'remote' | 'field'>().notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
  },
  table => [
    uniqueIndex('idx_employee_locations_company_id').on(table.companyId, table.id),
    index('idx_emp_locations_lookup').on(table.companyId, table.employeeId, table.validFrom, table.validTo),
  ],
);

export type EmployeeLocation = typeof employeeLocations.$inferSelect;
export type NewEmployeeLocation = typeof employeeLocations.$inferInsert;
