import { z } from 'zod';
import { createNextRoute, UserService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const userService = new UserService();

const revokeSessionsSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.AUTH_SESSION_REVOKE,
  schema: revokeSessionsSchema,
  handler: async (input, ctx) => {
    const result = await userService.revokeSessions(ctx, input.id);
    return { data: result, message: `Successfully revoked ${result.revoked} active session(s).` };
  },
});
