import { z } from 'zod';
import { createNextRoute, SalaryService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const salaryService = new SalaryService();

const assignSalarySchema = z.object({
  employeeId: z.string().uuid(),
  structureId: z.string().uuid(),
  structureVersion: z.number().int().positive(),
  ctcAnnual: z.coerce.string().min(1),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.enum(['join', 'revision', 'promotion', 'correction']).default('join'),
  overrides: z.record(z.unknown()).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SALARY_ASSIGN,
  schema: assignSalarySchema,
  handler: async (body, ctx, tx) => {
    const assigned = await salaryService.assignSalary(ctx, tx!, {
      ...body,
      reason: body.reason ?? 'join',
    });
    return { data: assigned };
  },
});
