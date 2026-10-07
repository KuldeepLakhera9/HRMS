import { z } from 'zod';
import { createNextRoute, PayrollInputService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const inputService = new PayrollInputService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_INPUT_APPROVE,
  schema: z.object({ id: z.string().uuid() }),
  handler: async (params, ctx, tx) => {
    const rejected = await inputService.rejectInput(ctx, tx!, params.id);
    return { data: rejected };
  },
});
