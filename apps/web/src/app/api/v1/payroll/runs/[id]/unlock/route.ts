import { z } from 'zod';
import { createNextRoute, PayrollLifecycleService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const lifecycleService = new PayrollLifecycleService();

const unlockRunSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().min(5),
  secondApproverId: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_UNLOCK,
  schema: unlockRunSchema,
  handler: async (body, ctx, tx) => {
    const result = await lifecycleService.unlockRun(ctx, tx!, body.id, {
      reason: body.reason,
      secondApproverId: body.secondApproverId,
    });
    return { data: result };
  },
});
