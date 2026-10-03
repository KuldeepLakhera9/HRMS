import { z } from 'zod';
import { createNextRoute, EmployeeService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const employeeService = new EmployeeService();

const getEmployeeSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_READ,
  schema: getEmployeeSchema,
  handler: async (input, ctx) => {
    const employee = await employeeService.getEmployee(ctx, input.id);
    return { data: employee };
  },
});

const updateEmployeeSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  emailWork: z.string().email().optional(),
  emailPersonal: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  addresses: z.record(z.unknown()).optional(),
  emergencyContacts: z.array(z.record(z.unknown())).optional(),
  bankAccount: z.string().min(8).max(30).nullable().optional(),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).nullable().optional(),
  aadhaar: z.string().regex(/^\d{12}$/).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});

export const PATCH = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_UPDATE,
  schema: updateEmployeeSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const employee = await employeeService.updateProfile(ctx, id, data);
    return { data: employee };
  },
});
