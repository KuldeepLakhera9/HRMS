import { z } from 'zod';
import { createNextRoute, SalaryService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const salaryService = new SalaryService();

const createStructureSchema = z.object({
  name: z.string().min(1).max(100),
  components: z.array(
    z.object({
      code: z.string().min(1),
      kind: z.enum(['earning', 'deduction', 'employer_contribution', 'reimbursement', 'benefit']),
      calc: z.enum(['fixed', 'formula', 'slab', 'input']),
      formula: z.string().optional(),
      isBalancing: z.boolean().optional(),
      roundTarget: z.enum(['rupee', 'paisa']).optional(),
      rounding: z.enum(['half_up', 'floor', 'ceil']).optional(),
    }),
  ),
  validations: z.record(z.unknown()).optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STRUCTURE_READ,
  handler: async (_query, ctx, tx) => {
    const list = await salaryService.listStructures(ctx, tx!);
    return { data: list };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STRUCTURE_MANAGE,
  schema: createStructureSchema,
  handler: async (body, ctx, tx) => {
    const created = await salaryService.createStructure(
      ctx,
      tx!,
      body.name,
      body.components,
      body.validations,
    );
    return { data: created };
  },
});
