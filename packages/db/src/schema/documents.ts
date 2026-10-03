import { pgTable, uuid, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const employeeDocuments = pgTable(
  'employee_documents',
  {
    ...baseTenantColumns,
    employeeId: uuid('employee_id').notNull(),
    type: text('type').notNull(),
    fileId: uuid('file_id').notNull(),
    status: text('status', {
      enum: ['pending', 'verified', 'rejected'],
    }).default('pending').notNull(),
    expiry: text('expiry'),
    verifiedBy: uuid('verified_by'),
    verificationComment: text('verification_comment'),
  },
  table => [
    uniqueIndex('idx_employee_documents_company_id_id').on(table.companyId, table.id),
    index('idx_employee_documents_emp_type').on(table.companyId, table.employeeId, table.type),
    index('idx_employee_documents_expiry').on(table.companyId, table.expiry),
    index('idx_employee_documents_status').on(table.companyId, table.status),
  ],
);

export type EmployeeDocument = typeof employeeDocuments.$inferSelect;
export type NewEmployeeDocument = typeof employeeDocuments.$inferInsert;
