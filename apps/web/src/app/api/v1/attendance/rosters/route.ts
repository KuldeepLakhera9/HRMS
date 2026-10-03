import { z } from 'zod';
import {
  createNextRoute,
  ShiftService,
  assignRosterSchema,
  bulkAssignRosterSchema,
  rosterQuerySchema,
} from '@hrms/core';

const shiftService = new ShiftService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: rosterQuerySchema,
  handler: async (input, ctx) => {
    const rosters = await shiftService.getRosterRange(ctx, input);
    return { data: rosters, statusCode: 200 };
  },
});

const postRosterSchema = z.union([
  assignRosterSchema,
  bulkAssignRosterSchema,
]);

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: postRosterSchema,
  handler: async (input, ctx) => {
    if ('assignments' in input) {
      const parsed = bulkAssignRosterSchema.parse(input);
      const result = await shiftService.bulkAssignRosters(ctx, parsed);
      return { data: result, statusCode: 201 };
    } else {
      const parsed = assignRosterSchema.parse(input);
      const result = await shiftService.assignRoster(ctx, parsed);
      return { data: result, statusCode: 201 };
    }
  },
});
