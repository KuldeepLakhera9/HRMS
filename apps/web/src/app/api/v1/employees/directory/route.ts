import { z } from 'zod';
import { createNextRoute, EmployeeService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const employeeService = new EmployeeService();

const getDirectorySchema = z.object({
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'probation', 'notice', 'terminated']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_READ,
  schema: getDirectorySchema,
  handler: async (input, ctx) => {
    const result = await employeeService.getDirectory(ctx, input);
    return {
      data: result.items,
      nextCursor: result.nextCursor,
      total: result.total,
    };
  },
});
