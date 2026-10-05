import {
  createNextRoute,
  BiometricService,
  biometricIngestBatchSchema,
} from '@hrms/core';

const biometricService = new BiometricService();

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: biometricIngestBatchSchema,
  handler: async (input, ctx) => {
    // Extract headers for hardware authentication
    const signature = ctx.requestId ? undefined : undefined; // signature from request if present

    const result = await biometricService.ingestBatch(
      ctx,
      {
        deviceId: input.deviceId,
        punches: input.punches.map(p => ({
          biometricUserId: p.biometricUserId,
          punchTime: p.punchTime,
          punchType: p.punchType ?? 'auto',
          rawRecordId: p.rawRecordId,
        })),
      },
      {
        clientIp: ctx.ip,
        signature,
      },
    );

    return {
      data: result,
      statusCode: 200,
    };
  },
});
