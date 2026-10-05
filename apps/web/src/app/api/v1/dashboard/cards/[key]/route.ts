import { z } from 'zod';
import { createNextRoute, DashboardService, type DashboardCardKey } from '@hrms/core';

const dashboardService = new DashboardService();

const getDashboardCardSchema = z.object({
  key: z.enum([
    'employee_clock',
    'leave_balances',
    'upcoming_holidays',
    'pending_requests',
    'team_presence',
    'team_leave',
    'hr_headcount',
    'hr_attendance_rate',
    'admin_system_health',
  ]),
});

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: getDashboardCardSchema,
  handler: async (input, ctx) => {
    const result = await dashboardService.getCard(ctx, input.key as DashboardCardKey);
    return { data: result };
  },
});
