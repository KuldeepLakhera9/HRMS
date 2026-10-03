import {
  createNextRoute,
  DeviceService,
} from '@hrms/core';

const deviceService = new DeviceService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  handler: async (_input, ctx) => {
    const device = await deviceService.getMyDevice(ctx);
    return {
      data: { device },
      statusCode: 200,
    };
  },
});
