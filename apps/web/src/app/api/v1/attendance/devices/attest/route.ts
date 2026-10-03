import {
  createNextRoute,
  DeviceService,
  attestDeviceSchema,
} from '@hrms/core';

const deviceService = new DeviceService();

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: attestDeviceSchema,
  handler: async (input, ctx) => {
    const result = await deviceService.attestDevice(ctx, input);
    return {
      data: result,
      statusCode: result.verified ? 200 : 422,
    };
  },
});
