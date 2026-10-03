import { z } from 'zod';
import { createNextRoute, CustomFieldService, updateCustomFieldSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const customFieldService = new CustomFieldService();

const updateParamsSchema = updateCustomFieldSchema.extend({
  id: z.string().uuid(),
});

const deleteParamsSchema = z.object({
  id: z.string().uuid(),
});

export const PATCH = createNextRoute({
  permission: PERMISSIONS.ORG_CUSTOMFIELD_MANAGE,
  schema: updateParamsSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const updated = await customFieldService.updateDefinition(ctx, id, data);
    return { data: updated };
  },
});

export const DELETE = createNextRoute({
  permission: PERMISSIONS.ORG_CUSTOMFIELD_MANAGE,
  schema: deleteParamsSchema,
  handler: async (input, ctx) => {
    const result = await customFieldService.deleteDefinition(ctx, input.id);
    return { data: result };
  },
});
