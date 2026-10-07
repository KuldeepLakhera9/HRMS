import { z } from 'zod';
import { createNextRoute, PayrollLifecycleService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const lifecycleService = new PayrollLifecycleService();

const correctionRunSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().optional(),
  runType: z.enum(['correction', 'off_cycle', 'final']).default('correction'),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_CREATE,
  schema: correctionRunSchema,
  handler: async (body, ctx, tx) => {
    const result = await lifecycleService.createCorrectionRun(ctx, tx!, body.id, {
      notes: body.notes,
      runType: body.runType,
    });
    return { data: result };
  },
});
