import { z } from 'zod';
import { createNextRoute, CustomFieldService, createCustomFieldSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const customFieldService = new CustomFieldService();

const listQuerySchema = z.object({
  entity: z.enum(['employee', 'department', 'location']).default('employee'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_CUSTOMFIELD_READ,
  schema: listQuerySchema,
  handler: async (input, ctx) => {
    const entity = input.entity || 'employee';
    const definitions = await customFieldService.listDefinitions(ctx, entity);
    return { data: definitions };
  },
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_CUSTOMFIELD_MANAGE,
  schema: createCustomFieldSchema,
  handler: async (input, ctx) => {
    const definition = await customFieldService.createDefinition(ctx, input);
    return { data: definition };
  },
});
