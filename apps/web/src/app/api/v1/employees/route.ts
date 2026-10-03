import { z } from 'zod';
import { createNextRoute, EmployeeService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const employeeService = new EmployeeService();

const listEmployeesSchema = z.object({
  query: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_READ,
  schema: listEmployeesSchema,
  handler: async (input, ctx) => {
    const result = await employeeService.listEmployees(ctx, input);
    return { data: result.employees, nextCursor: result.nextCursor };
  },
});

const createEmployeeSchema = z.object({
  firstName: z.string().min(1, 'First name is required.').max(100),
  lastName: z.string().min(1, 'Last name is required.').max(100),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD').nullable().optional(),
  gender: z.string().nullable().optional(),
  maritalStatus: z.string().nullable().optional(),
  emailWork: z.string().email('Valid work email is required.'),
  emailPersonal: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  addresses: z.record(z.unknown()).optional(),
  emergencyContacts: z.array(z.record(z.unknown())).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  gradeId: z.string().uuid().nullable().optional(),
  costCenterId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  employmentType: z.string().optional(),
  doj: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOJ must be YYYY-MM-DD'),
  confirmationDate: z.string().nullable().optional(),
  status: z.string().optional(),
  bankAccount: z.string().min(8).max(30).nullable().optional(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format').nullable().optional(),
  aadhaar: z.string().regex(/^\d{12}$/, 'Aadhaar must be 12 digits').nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
  userId: z.string().uuid().nullable().optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_CREATE,
  schema: createEmployeeSchema,
  handler: async (input, ctx) => {
    const employee = await employeeService.createEmployee(ctx, input);
    return { data: employee };
  },
});
