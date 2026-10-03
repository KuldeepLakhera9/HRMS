import { z } from 'zod';
import { createNextRoute, EmployeeService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const employeeService = new EmployeeService();

const getHistorySchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_HISTORY_READ,
  schema: getHistorySchema,
  handler: async (input, ctx) => {
    const history = await employeeService.getEmployeeHistory(ctx, input.id);
    return { data: history };
  },
});
