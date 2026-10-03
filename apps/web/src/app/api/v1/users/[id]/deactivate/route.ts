import { z } from 'zod';
import { createNextRoute, UserService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const userService = new UserService();

const deactivateUserSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.AUTH_USER_DEACTIVATE,
  schema: deactivateUserSchema,
  handler: async (input, ctx) => {
    const user = await userService.deactivateUser(ctx, input.id);
    return { data: user, message: 'User has been deactivated and all active sessions revoked.' };
  },
});
