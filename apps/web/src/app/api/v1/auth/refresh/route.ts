import { z } from 'zod';
import { createNextRoute, AuthService } from '@hrms/core';

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required.'),
});

const authService = new AuthService();

export const POST = createNextRoute({
  schema: refreshSchema,
  skipTenantTransaction: true,
  rateLimit: {
    limit: 20,
    windowSeconds: 60,
    keyGenerator: ctx => `refresh:${ctx.ip || 'anon'}`,
  },
  handler: async (input, ctx) => {
    const result = await authService.refresh({
      refreshToken: input.refreshToken,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const isProd = process.env.NODE_ENV === 'production';
    const cookie = `hrms_session=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; ${isProd ? 'Secure;' : ''}`;

    return {
      __headers: {
        'Set-Cookie': cookie,
      },
      token: result.token,
      refreshToken: result.refreshToken,
      session: result.sessionData,
    };
  },
});
