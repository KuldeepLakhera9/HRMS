import { z } from 'zod';
import { createNextRoute, SalaryService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const salaryService = new SalaryService();

const createComponentSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  kind: z.enum(['earning', 'deduction', 'employer_contribution', 'reimbursement', 'benefit']),
  calc: z.enum(['fixed', 'formula', 'slab', 'input']),
  formula: z.string().optional().nullable(),
  rounding: z.enum(['half_up', 'floor', 'ceil']).default('half_up'),
  roundTarget: z.enum(['rupee', 'paisa']).default('rupee'),
  taxable: z.boolean().default(true),
  taxExemptionRule: z.record(z.unknown()).optional().nullable(),
  pfWage: z.boolean().default(false),
  esiWage: z.boolean().default(false),
  gratuityWage: z.boolean().default(false),
  bonusWage: z.boolean().default(false),
  statutoryWage: z.boolean().default(false),
  prorate: z.boolean().default(true),
  showOnPayslip: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_COMPONENT_READ,
  handler: async (_query, ctx, tx) => {
    const components = await salaryService.listComponents(ctx, tx!);
    return { data: components };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_COMPONENT_MANAGE,
  schema: createComponentSchema,
  handler: async (body, ctx, tx) => {
    const created = await salaryService.createComponent(
      ctx,
      tx!,
      body as unknown as Parameters<typeof salaryService.createComponent>[2],
    );
    return { data: created };
  },
});
