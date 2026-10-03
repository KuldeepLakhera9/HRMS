import { z } from 'zod';
import { createNextRoute, RbacService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rbacService = new RbacService();

const getEffectivePermissionsSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_READ,
  schema: getEffectivePermissionsSchema,
  handler: async (input, ctx) => {
    const data = await rbacService.getUserEffectivePermissions(ctx, input.id);
    return { data };
  },
});
