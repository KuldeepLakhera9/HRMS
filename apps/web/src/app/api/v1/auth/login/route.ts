import { z } from 'zod';
import { createNextRoute, AuthService } from '@hrms/core';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
  mfaCode: z.string().optional(),
});

const authService = new AuthService();

export const POST = createNextRoute({
  schema: loginSchema,
  skipTenantTransaction: true,
  rateLimit: {
    limit: 10,
    windowSeconds: 60,
    keyGenerator: ctx => `login:${ctx.ip || 'anon'}`,
  },
  handler: async (input, ctx) => {
    const result = await authService.login({
      email: input.email,
      password: input.password,
      mfaCode: input.mfaCode,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    if (result.mfaRequired) {
      return {
        mfaRequired: true,
        tempUserId: result.tempUserId,
        message: 'Multi-factor authentication code is required.',
      };
    }

    const isProd = process.env.NODE_ENV === 'production';
    const cookie = `hrms_session=${result.rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; ${isProd ? 'Secure;' : ''}`;

    return {
      __headers: {
        'Set-Cookie': cookie,
      },
      success: true,
      user: result.user,
    };
  },
});
