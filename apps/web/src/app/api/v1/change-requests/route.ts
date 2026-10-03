import { z } from 'zod';
import { createNextRoute, ChangeRequestService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const changeRequestService = new ChangeRequestService();

const listChangeRequestsSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  employeeId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_CHANGEREQUEST_APPROVE,
  schema: listChangeRequestsSchema,
  handler: async (input, ctx) => {
    const res = await changeRequestService.listChangeRequests(ctx, input);
    return { data: res.items, nextCursor: res.nextCursor };
  },
});
