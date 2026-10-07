import { z } from 'zod';
import { createNextRoute, PayrollRunService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const runService = new PayrollRunService();

const listPeriodsSchema = z.object({
  legalEntityId: z.string().uuid().optional(),
});

const createPeriodSchema = z.object({
  legalEntityId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  fy: z.string().regex(/^\d{4}-\d{4}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: listPeriodsSchema,
  handler: async (query, ctx, tx) => {
    const periods = await runService.listPeriods(ctx, tx!, query.legalEntityId);
    return { data: periods };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_CREATE,
  schema: createPeriodSchema,
  handler: async (body, ctx, tx) => {
    const period = await runService.createPeriod(ctx, tx!, body);
    return { data: period };
  },
});
