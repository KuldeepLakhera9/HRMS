import { z } from 'zod';
import { createNextRoute, RbacService, AssignUserRolesSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rbacService = new RbacService();

const assignUserRolesParamsSchema = AssignUserRolesSchema.extend({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const PUT = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_ASSIGN,
  schema: assignUserRolesParamsSchema,
  handler: async (input, ctx) => {
    await rbacService.assignUserRoles(ctx, input.id, input.roleIds);
    return { success: true, message: 'User roles updated and authorization cache invalidated immediately.' };
  },
});
