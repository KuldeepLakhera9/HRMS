import {
  createNextRoute,
  WorkflowService,
  simulateWorkflowSchema,
  type WorkflowStepDefinition,
} from '@hrms/core';

const workflowService = new WorkflowService();

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: simulateWorkflowSchema,
  handler: async (input, ctx) => {
    const result = await workflowService.simulateWorkflow(ctx, {
      definitionCode: input.definitionCode,
      steps: input.steps as unknown as WorkflowStepDefinition[] | undefined,
      payload: input.payload,
    });

    return {
      data: result,
      statusCode: 200,
    };
  },
});
