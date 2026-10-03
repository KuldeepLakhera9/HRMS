import { z } from 'zod';
import { createNextRoute, BulkService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bulkService = new BulkService();

const getJobSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_IMPORT,
  schema: getJobSchema,
  handler: async (input, ctx) => {
    const job = await bulkService.getJob(ctx, input.id);
    return { data: job };
  },
});
