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

const getLocationSchema = z.object({
  id: z.string().uuid('Location ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_READ,
  schema: getLocationSchema,
  handler: async (input, ctx) => {
    const location = await orgService.getLocation(ctx, input.id);
    return { data: location };
  },
});

const updateLocationSchema = z.object({
  id: z.string().uuid('Location ID must be a valid UUID.'),
  name: z.string().min(1).optional(),
  code: z.string().min(1).max(20).optional(),
  address: addressSchema.optional(),
  timezone: z.string().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  radiusMeters: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export const PUT = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_MANAGE,
  schema: updateLocationSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const location = await orgService.updateLocation(ctx, id, data);
    return { data: location };
  },
});

const deleteLocationSchema = z.object({
  id: z.string().uuid('Location ID must be a valid UUID.'),
});

export const DELETE = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_MANAGE,
  schema: deleteLocationSchema,
  handler: async (input, ctx) => {
    await orgService.deleteLocation(ctx, input.id);
    return { success: true, message: 'Work location deleted successfully.' };
  },
});
