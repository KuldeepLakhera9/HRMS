import { z } from 'zod';
import {
  createNextRoute,
  generateRotatingQrToken,
  LocationRepository,
} from '@hrms/core';
import { NotFoundError } from '@hrms/shared';

const locationRepo = new LocationRepository();

const qrTokenParamsSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: qrTokenParamsSchema,
  handler: async (input, ctx) => {
    const locationId = input.id;
    const secret = await locationRepo.getLocationQrSecret(ctx.companyId, locationId);
    if (!secret) {
      throw new NotFoundError('Location QR Secret', locationId);
    }

    const qrToken = generateRotatingQrToken(locationId, secret);
    const expiresInSeconds = 30 - Math.floor((Date.now() % 30000) / 1000);

    return {
      data: {
        locationId,
        qrToken,
        expiresInSeconds,
      },
      statusCode: 200,
    };
  },
});
