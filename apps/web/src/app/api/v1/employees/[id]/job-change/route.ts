import { z } from 'zod';
import { createNextRoute, EmployeeService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const employeeService = new EmployeeService();

const jobChangeSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
  field: z.enum([
    'departmentId',
    'designationId',
    'gradeId',
    'costCenterId',
    'locationId',
    'managerId',
    'status',
  ]),
  newValue: z.string().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must be YYYY-MM-DD'),
  reason: z.string().max(255).optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_UPDATE,
  schema: jobChangeSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const result = await employeeService.changeJob(ctx, id, data);
    return { data: result };
  },
});
