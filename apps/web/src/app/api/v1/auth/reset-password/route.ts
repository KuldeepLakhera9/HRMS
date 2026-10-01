import { z } from 'zod';
import { createNextRoute, AuthService } from '@hrms/core';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required.'),
  newPassword: z.string().min(12, 'Password must be at least 12 characters long.'),
});

const authService = new AuthService();

export const POST = createNextRoute({
  schema: resetPasswordSchema,
  skipTenantTransaction: true,
  rateLimit: {
    limit: 5,
    windowSeconds: 60,
    keyGenerator: ctx => `reset_pwd:${ctx.ip || 'anon'}`,
  },
  handler: async (input, ctx) => {
    return authService.resetPassword({
      token: input.token,
      newPassword: input.newPassword,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
  },
});
