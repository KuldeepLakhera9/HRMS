import { z } from 'zod';
import { createNextRoute, PayrollLifecycleService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const lifecycleService = new PayrollLifecycleService();

const publishRunSchema = z.object({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_PUBLISH,
  schema: publishRunSchema,
  handler: async (body, ctx, tx) => {
    const result = await lifecycleService.publishRun(ctx, tx!, body.id);
    return { data: result };
  },
});
