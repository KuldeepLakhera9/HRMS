import { z } from 'zod';
import { createNextRoute, LocationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const locationService = new LocationService();

const testCoordinateSchema = z.object({
  id: z.string().uuid(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  accuracyMeters: z.number().min(0).default(10),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_READ,
  schema: testCoordinateSchema,
  handler: async (input, ctx) => {
    const result = await locationService.testCoordinate(
      ctx,
      input.id,
      input.longitude,
      input.latitude,
      input.accuracyMeters,
    );
    return { data: result };
  },
});
