import { z } from 'zod';
import { createNextRoute, AuthService } from '@hrms/core';

const revokeSchema = z.object({
  id: z.string().uuid(),
});

const authService = new AuthService();

export const DELETE = createNextRoute({
  schema: revokeSchema,
  requireAuth: true,
  skipTenantTransaction: true,
  handler: async (input, ctx) => {
    const result = await authService.revokeSession({
      ctx,
      sessionId: input.id,
    });

    return {
      success: result.success,
    };
  },
});
