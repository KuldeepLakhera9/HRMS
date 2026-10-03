import { z } from 'zod';
import { createNextRoute, ChangeRequestService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const changeRequestService = new ChangeRequestService();

const createChangeRequestRouteSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
  phone: z.string().optional(),
  emailPersonal: z.string().email().optional(),
  maritalStatus: z.string().optional(),
  addresses: z.record(z.unknown()).optional(),
  emergencyContacts: z.array(z.record(z.unknown())).optional(),
}).refine(data => {
  const { id: _id, ...changes } = data;
  return Object.keys(changes).length > 0;
}, {
  message: 'At least one field change must be specified.',
});

export const POST = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_CHANGEREQUEST_CREATE,
  schema: createChangeRequestRouteSchema,
  handler: async (input, ctx) => {
    const { id, ...changes } = input;
    const req = await changeRequestService.submitChangeRequest(ctx, id, changes);
    return { data: req };
  },
});
