import { z } from 'zod';
import { createNextRoute, AuthService } from '@hrms/core';
import { UnauthorizedError } from '@hrms/shared';

const stepUpSchema = z.object({
  password: z.string().optional(),
  totpCode: z.string().optional(),
});

const authService = new AuthService();

export const POST = createNextRoute({
  schema: stepUpSchema,
  requireAuth: true,
  skipTenantTransaction: true,
  rateLimit: {
    limit: 5,
    windowSeconds: 60,
    keyGenerator: ctx => `step-up:${ctx.userId || ctx.ip || 'anon'}`,
  },
  handler: async (input, ctx) => {
    if (!ctx.sessionId) {
      throw new UnauthorizedError('Active session is required for step-up authentication.');
    }

    const result = await authService.stepUp({
      ctx,
      sessionId: ctx.sessionId,
      password: input.password,
      totpCode: input.totpCode,
    });

    return {
      success: true,
      stepUpUntil: result.stepUpUntil,
    };
  },
});
