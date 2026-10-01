import { createNextRoute, AuthService } from '@hrms/core';

const authService = new AuthService();

export const GET = createNextRoute({
  requireAuth: true,
  handler: async (_input, ctx) => {
    const user = await authService.getCurrentUser(ctx);
    return {
      user,
    };
  },
});
