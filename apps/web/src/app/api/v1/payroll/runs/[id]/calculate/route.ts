import { z } from 'zod';
import { createNextRoute, PayrollCalculationWorker } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const worker = new PayrollCalculationWorker();

const calculateRunSchema = z.object({
  id: z.string().uuid(),
  chunkSize: z.number().int().min(1).max(500).optional(),
  forceRecalculate: z.boolean().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_CALCULATE,
  schema: calculateRunSchema,
  handler: async (body, ctx, tx) => {
    const result = await worker.calculateRun(ctx, tx!, body.id, {
      chunkSize: body.chunkSize ?? 100,
      forceRecalculate: body.forceRecalculate ?? false,
    });
    return { data: result };
  },
});
