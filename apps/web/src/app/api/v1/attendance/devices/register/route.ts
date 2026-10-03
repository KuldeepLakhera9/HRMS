import {
  createNextRoute,
  DeviceService,
  registerDeviceSchema,
} from '@hrms/core';

const deviceService = new DeviceService();

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: registerDeviceSchema,
  handler: async (input, ctx) => {
    const result = await deviceService.registerDevice(ctx, input);
    return {
      data: result,
      statusCode: result.requiresApproval ? 202 : 200,
    };
  },
});
