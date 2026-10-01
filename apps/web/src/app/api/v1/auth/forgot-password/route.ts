import { z } from 'zod';
import { createNextRoute, AuthService } from '@hrms/core';

const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
});

const authService = new AuthService();

export const POST = createNextRoute({
  schema: forgotPasswordSchema,
  skipTenantTransaction: true,
  rateLimit: {
    limit: 5,
    windowSeconds: 60,
    keyGenerator: ctx => `forgot_pwd:${ctx.ip || 'anon'}`,
  },
  handler: async (input, ctx) => {
    return authService.requestPasswordReset(input.email, ctx);
  },
});
