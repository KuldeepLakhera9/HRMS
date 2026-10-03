import { z } from 'zod';
import { createNextRoute, LocationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const locationService = new LocationService();

const assignLocationSchema = z.object({
  employeeId: z.string().uuid(),
  locationId: z.string().uuid(),
  assignmentType: z.enum(['fixed', 'flexible', 'remote', 'field']),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD date format.'),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD date format.').nullable().optional(),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_LOCATION_READ,
  schema: z.object({
    employeeId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
  }),
  handler: async (input, ctx) => {
    const list = await locationService.listEmployeeLocations(ctx, input);
    return { data: list, statusCode: 200 };
  },
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ATTENDANCE_LOCATION_ASSIGN,
  schema: assignLocationSchema,
  handler: async (input, ctx) => {
    const result = await locationService.assignEmployeeLocation(ctx, input);
    return { data: result, statusCode: 201 };
  },
});

