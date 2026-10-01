import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_GRADE_READ,
  handler: async (_input, ctx) => {
    const grades = await orgService.listGrades(ctx);
    return { data: grades };
  },
});

const createGradeSchema = z.object({
  name: z.string().min(1, 'Grade name is required.'),
  code: z.string().min(1, 'Grade code is required.').max(20),
  level: z.number().int().min(1).default(1),
  active: z.boolean().optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_GRADE_MANAGE,
  schema: createGradeSchema,
  handler: async (input, ctx) => {
    const grade = await orgService.createGrade(ctx, input);
    return { data: grade };
  },
});
