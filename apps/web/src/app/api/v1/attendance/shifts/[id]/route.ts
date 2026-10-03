import { z } from 'zod';
import {
  createNextRoute,
  ShiftService,
  updateShiftSchema,
} from '@hrms/core';

const shiftService = new ShiftService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
  }),
  handler: async (input, ctx) => {
    const shift = await shiftService.getShift(ctx, input.id);
    return { data: shift, statusCode: 200 };
  },
});

export const PATCH = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: updateShiftSchema.extend({
    id: z.string().uuid(),
  }),
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const updated = await shiftService.updateShift(ctx, id, data);
    return { data: updated, statusCode: 200 };
  },
});
