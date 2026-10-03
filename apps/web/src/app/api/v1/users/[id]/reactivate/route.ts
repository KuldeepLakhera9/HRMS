import { z } from 'zod';
import { createNextRoute, UserService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const userService = new UserService();

const reactivateUserSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.AUTH_USER_UPDATE,
  schema: reactivateUserSchema,
  handler: async (input, ctx) => {
    const user = await userService.reactivateUser(ctx, input.id);
    return { data: user, message: 'User has been reactivated successfully.' };
  },
});
