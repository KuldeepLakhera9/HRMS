import { z } from 'zod';
import { createNextRoute, RbacService, UpdateRoleSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rbacService = new RbacService();

const getRoleSchema = z.object({
  id: z.string().uuid('Role ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_READ,
  schema: getRoleSchema,
  handler: async (input, ctx) => {
    const role = await rbacService.getRole(ctx, input.id);
    return { data: role };
  },
});

const updateRoleWithIdSchema = UpdateRoleSchema.extend({
  id: z.string().uuid('Role ID must be a valid UUID.'),
});

export const PUT = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_UPDATE,
  schema: updateRoleWithIdSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const role = await rbacService.updateRole(ctx, id, data);
    return { data: role };
  },
});

const deleteRoleSchema = z.object({
  id: z.string().uuid('Role ID must be a valid UUID.'),
});

export const DELETE = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_DELETE,
  schema: deleteRoleSchema,
  handler: async (input, ctx) => {
    await rbacService.deleteRole(ctx, input.id);
    return { success: true, message: 'Role deleted successfully.' };
  },
});
