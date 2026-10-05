import {
  createNextRoute,
  RegularizationService,
  CreateRegularizationInputSchema,
  ListRegularizationsQuerySchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const regularizationService = new RegularizationService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: ListRegularizationsQuerySchema,
  handler: async (query, ctx) => {
    const records = await regularizationService.listRequests(ctx, query);
    return { data: records };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_REGULARIZATION_CREATE,
  skipTenantTransaction: true,
  schema: CreateRegularizationInputSchema,
  handler: async (input, ctx) => {
    const record = await regularizationService.submitRequest(ctx, input);
    return { data: record, statusCode: 201 };
  },
});
