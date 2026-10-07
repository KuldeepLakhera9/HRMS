import { z } from 'zod';
import { createNextRoute, SalaryRevisionService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const revisionService = new SalaryRevisionService();

const createRevisionSchema = z.object({
  batchId: z.string().min(1).max(100),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z
    .array(
      z.object({
        employeeId: z.string().uuid(),
        newCtcAnnual: z.coerce.string().min(1),
        structureId: z.string().uuid().optional(),
        structureVersion: z.number().int().positive().optional(),
        reason: z.enum(['revision', 'promotion', 'correction']).optional(),
      }),
    )
    .min(1),
  arrearsPolicy: z.record(z.unknown()).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SALARY_ASSIGN,
  schema: createRevisionSchema,
  handler: async (body, ctx, tx) => {
    const created = await revisionService.createRevisionBatch(ctx, tx!, body);
    return { data: created };
  },
});
