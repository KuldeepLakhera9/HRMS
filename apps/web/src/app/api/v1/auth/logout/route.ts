import { createNextRoute } from '@hrms/core';

export const POST = createNextRoute({
  skipTenantTransaction: true,
  handler: async (_input, _ctx) => {
    // If token present, revoke session
    const isProd = process.env.NODE_ENV === 'production';
    const clearCookie = `hrms_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ${isProd ? 'Secure;' : ''}`;

    return {
      __headers: {
        'Set-Cookie': clearCookie,
      },
      success: true,
      message: 'Successfully logged out.',
    };
  },
});
