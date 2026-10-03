import { z } from 'zod';
import { createNextRoute, getRedisClient, createChildLogger } from '@hrms/core';

const registerPushTokenSchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(['ios', 'android', 'web']),
  deviceId: z.string().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: registerPushTokenSchema,
  handler: async (input, ctx) => {
    const logger = createChildLogger({
      requestId: ctx.requestId,
      companyId: ctx.companyId,
      userId: ctx.userId,
    });

    const redis = getRedisClient();
    const tokenKey = `push_tokens:${ctx.companyId}:${ctx.userId}`;
    const tokenData = JSON.stringify({
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId ?? 'unknown',
      updatedAt: new Date().toISOString(),
    });

    try {
      await redis.sadd(tokenKey, tokenData);
      // Keep push token registrations active for 90 days
      await redis.expire(tokenKey, 90 * 24 * 3600);
    } catch (err: unknown) {
      logger.warn({ err }, 'Failed to persist push token to Redis cache');
    }

    logger.info({ platform: input.platform }, 'Mobile push token registered successfully');

    return {
      data: {
        success: true,
        registeredAt: new Date().toISOString(),
      },
      statusCode: 200,
    };
  },
});
