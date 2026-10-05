import { z } from 'zod';
import {
  createNextRoute,
  WorkflowService,
  createWorkflowDefinitionSchema,
  type WorkflowStepDefinition,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const workflowService = new WorkflowService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const definitions = await workflowService.listDefinitions(ctx);
    return {
      data: definitions,
      statusCode: 200,
    };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.WORKFLOW_DEFINITION_MANAGE,
  skipTenantTransaction: true,
  schema: createWorkflowDefinitionSchema,
  handler: async (input, ctx) => {
    const result = await workflowService.createDefinition(ctx, {
      code: input.code,
      name: input.name,
      entityType: input.entityType,
      steps: input.steps as unknown as WorkflowStepDefinition[],
    });

    return {
      data: result,
      statusCode: 201,
    };
  },
});
