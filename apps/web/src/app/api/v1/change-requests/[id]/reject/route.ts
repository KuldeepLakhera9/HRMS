import { z } from 'zod';
import { createNextRoute, ChangeRequestService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const changeRequestService = new ChangeRequestService();

const rejectChangeRequestSchema = z.object({
  id: z.string().uuid('Change request ID must be a valid UUID.'),
  comment: z.string().max(500).optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_CHANGEREQUEST_APPROVE,
  schema: rejectChangeRequestSchema,
  handler: async (input, ctx) => {
    const res = await changeRequestService.decideChangeRequest(
      ctx,
      input.id,
      {
        decision: 'rejected',
        comment: input.comment,
      },
    );
    return { data: res };
  },
});
