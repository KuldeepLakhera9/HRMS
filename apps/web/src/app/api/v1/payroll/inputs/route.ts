import { z } from 'zod';
import { createNextRoute, PayrollInputService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const inputService = new PayrollInputService();

const listInputsSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(['pending', 'approved', 'consumed', 'cancelled']).optional(),
  employeeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createInputSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum([
    'bonus',
    'incentive',
    'arrear',
    'deduction',
    'loan_emi',
    'reimbursement',
    'adjustment',
    'lop_override',
    'leave_encashment',
    'other',
  ]),
  componentCode: z.string().optional(),
  amount: z.coerce.string().min(1),
  taxable: z.boolean().default(true),
  forPeriod: z.string().regex(/^\d{4}-\d{2}$/),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  note: z.string().optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_INPUT_READ,
  schema: listInputsSchema,
  handler: async (query, ctx, tx) => {
    const inputs = await inputService.listInputs(ctx, tx!, query);
    return { data: inputs };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_INPUT_CREATE,
  schema: createInputSchema,
  handler: async (body, ctx, tx) => {
    const created = await inputService.createInput(ctx, tx!, body);
    return { data: created };
  },
});
