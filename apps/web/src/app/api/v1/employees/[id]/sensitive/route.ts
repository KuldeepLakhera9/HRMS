import { z } from 'zod';
import { createNextRoute, EmployeeService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const employeeService = new EmployeeService();

const getSensitiveSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE,
  schema: getSensitiveSchema,
  handler: async (input, ctx) => {
    const sensitive = await employeeService.getSensitiveFields(ctx, input.id);
    return { data: sensitive };
  },
});
