import { z } from 'zod';
import { createNextRoute, UserService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const userService = new UserService();

const resetMfaSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.AUTH_USER_RESET_MFA,
  schema: resetMfaSchema,
  handler: async (input, ctx) => {
    const user = await userService.resetMfa(ctx, input.id);
    return { data: user, message: 'User MFA has been reset and all active sessions revoked.' };
  },
});
