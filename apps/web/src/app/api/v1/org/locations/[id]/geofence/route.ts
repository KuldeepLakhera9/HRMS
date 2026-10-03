import { z } from 'zod';
import { createNextRoute, LocationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const locationService = new LocationService();

const updateGeofenceSchema = z.object({
  id: z.string().uuid(),
  geofenceType: z.enum(['radius', 'polygon']),
  radiusMeters: z.number().int().positive().nullable().optional(),
  polygonGeoJson: z.record(z.unknown()).nullable().optional(),
  center: z
    .object({
      longitude: z.number().min(-180).max(180),
      latitude: z.number().min(-90).max(90),
    })
    .nullable()
    .optional(),
  wifiBssids: z.array(z.string()).optional(),
  qrSecret: z.string().nullable().optional(),
  timezone: z.string().optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_MANAGE,
  schema: updateGeofenceSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const result = await locationService.updateGeofence(ctx, {
      ...data,
      locationId: id,
    });
    return { data: result };
  },
});
