import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

const addressSchema = z.object({
  line1: z.string().min(1, 'Address line 1 is required.'),
  line2: z.string().nullable().optional(),
  city: z.string().min(1, 'City is required.'),
  state: z.string().min(1, 'State is required.'),
  country: z.string().min(1, 'Country is required.'),
  postalCode: z.string().min(1, 'Postal code is required.'),
});

const listLocationsSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_READ,
  schema: listLocationsSchema,
  handler: async (input, ctx) => {
    const filters = input.active ? { active: input.active === 'true' } : undefined;
    const locations = await orgService.listLocations(ctx, filters);
    return { data: locations };
  },
});

const createLocationSchema = z.object({
  name: z.string().min(1, 'Location name is required.'),
  code: z.string().min(1, 'Location code is required.').max(20),
  address: addressSchema,
  timezone: z.string().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  radiusMeters: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_MANAGE,
  schema: createLocationSchema,
  handler: async (input, ctx) => {
    const location = await orgService.createLocation(ctx, input);
    return { data: location };
  },
});
