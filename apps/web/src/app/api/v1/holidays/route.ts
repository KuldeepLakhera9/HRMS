import {
  createNextRoute,
  HolidayService,
  HolidayQuerySchema,
  CreateHolidaySchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const holidayService = new HolidayService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: HolidayQuerySchema,
  handler: async (query, ctx) => {
    const holidays = await holidayService.listAllHolidays(ctx, query);
    return { data: holidays };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.HOLIDAY_MANAGE,
  skipTenantTransaction: true,
  schema: CreateHolidaySchema,
  handler: async (input, ctx) => {
    const holiday = await holidayService.addHoliday(ctx, input.holidayListId, {
      name: input.name,
      date: input.date,
      type: input.isOptional ? 'optional' : 'public',
    });
    return { data: holiday, statusCode: 201 };
  },
});
