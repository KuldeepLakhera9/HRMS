import { createNextRoute, AuthService } from '@hrms/core';

const authService = new AuthService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  handler: async (_input, ctx) => {
    const sessions = await authService.listSessions({
      ctx,
      currentSessionId: ctx.sessionId,
    });

    return {
      data: sessions,
    };
  },
});
