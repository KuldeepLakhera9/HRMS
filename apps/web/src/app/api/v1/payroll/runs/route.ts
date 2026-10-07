import { z } from 'zod';
import { createNextRoute, PayrollRunService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const runService = new PayrollRunService();

const listRunsSchema = z.object({
  periodId: z.string().uuid(),
});

const createRunSchema = z.object({
  periodId: z.string().uuid(),
  runType: z.enum(['regular', 'off_cycle', 'correction', 'final']).default('regular'),
  sequence: z.number().int().positive().default(1),
  notes: z.string().optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: listRunsSchema,
  handler: async (query, ctx, tx) => {
    const runs = await runService.listRuns(ctx, tx!, query.periodId);
    return { data: runs };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_CREATE,
  schema: createRunSchema,
  handler: async (body, ctx, tx) => {
    const run = await runService.createRun(ctx, tx!, body);
    return { data: run };
  },
});
