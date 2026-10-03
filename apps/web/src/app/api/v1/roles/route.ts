import { createNextRoute, RbacService, CreateRoleSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rbacService = new RbacService();

export const GET = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_READ,
  handler: async (_input, ctx) => {
    const roles = await rbacService.listRoles(ctx);
    return { data: roles };
  },
});

export const POST = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_CREATE,
  schema: CreateRoleSchema,
  handler: async (input, ctx) => {
    const role = await rbacService.createRole(ctx, input);
    return { data: role };
  },
});
