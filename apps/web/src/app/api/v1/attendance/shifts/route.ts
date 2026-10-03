import { z } from 'zod';
import {
  createNextRoute,
  ShiftService,
  createShiftSchema,
} from '@hrms/core';

const shiftService = new ShiftService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const shifts = await shiftService.listShifts(ctx);
    return { data: shifts, statusCode: 200 };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: createShiftSchema,
  handler: async (input, ctx) => {
    const parsed = createShiftSchema.parse(input);
    const shift = await shiftService.createShift(ctx, parsed);
    return { data: shift, statusCode: 201 };
  },
});
