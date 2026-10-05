import {
  createNextRoute,
  LeaveService,
  SubmitLeaveRequestSchema,
  ListLeaveRequestsQuerySchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const leaveService = new LeaveService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_REQUEST_READ,
  skipTenantTransaction: true,
  schema: ListLeaveRequestsQuerySchema,
  handler: async (query, ctx) => {
    const result = await leaveService.listRequests(ctx, query);
    return { data: result };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_REQUEST_CREATE,
  skipTenantTransaction: true,
  schema: SubmitLeaveRequestSchema,
  handler: async (input, ctx) => {
    const result = await leaveService.submitRequest(ctx, input);
    return { data: result, statusCode: 201 };
  },
});
