import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

const getDepartmentsSchema = z.object({
  tree: z.enum(['true', 'false']).optional(),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_DEPARTMENT_READ,
  schema: getDepartmentsSchema,
  handler: async (input, ctx) => {
    if (input.tree === 'true') {
      const tree = await orgService.getDepartmentTree(ctx);
      return { data: tree };
    }
    const departments = await orgService.listDepartments(ctx);
    return { data: departments };
  },
});

const createDepartmentSchema = z.object({
  name: z.string().min(1, 'Department name is required.'),
  code: z.string().min(1, 'Department code is required.').max(20),
  parentId: z.string().uuid().nullable().optional(),
  headEmployeeId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_DEPARTMENT_MANAGE,
  schema: createDepartmentSchema,
  handler: async (input, ctx) => {
    const department = await orgService.createDepartment(ctx, input);
    return { data: department };
  },
});
