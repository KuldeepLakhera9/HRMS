import { z } from 'zod';
import { createNextRoute, LocationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const locationService = new LocationService();

export const DELETE = createNextRoute({
  permission: PERMISSIONS.ATTENDANCE_LOCATION_ASSIGN,
  schema: z.object({
    id: z.string().uuid(),
  }),
  handler: async (input, ctx) => {
    const result = await locationService.deleteEmployeeLocation(ctx, input.id);
    return { data: result, statusCode: 200 };
  },
});
