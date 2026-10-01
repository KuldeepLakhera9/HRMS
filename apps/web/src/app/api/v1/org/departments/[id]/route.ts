import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

const updateDepartmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  code: z.string().min(1).max(20).optional(),
  parentId: z.string().uuid().nullable().optional(),
  headEmployeeId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});

export const PUT = createNextRoute({
  permission: PERMISSIONS.ORG_DEPARTMENT_MANAGE,
  schema: updateDepartmentSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const department = await orgService.updateDepartment(ctx, id, data);
    return { data: department };
  },
});

const deleteDepartmentSchema = z.object({
  id: z.string().uuid(),
});

export const DELETE = createNextRoute({
  permission: PERMISSIONS.ORG_DEPARTMENT_MANAGE,
  schema: deleteDepartmentSchema,
  handler: async (input, ctx) => {
    await orgService.deleteDepartment(ctx, input.id);
    return { success: true, message: 'Department deleted successfully.' };
  },
});
