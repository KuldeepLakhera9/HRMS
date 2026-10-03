import {
  createNextRoute,
  AttendancePunchService,
  recordPunchSchema,
} from '@hrms/core';

const punchService = new AttendancePunchService();

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: recordPunchSchema,
  handler: async (input, ctx) => {
    const parsed = recordPunchSchema.parse(input);
    const result = await punchService.recordPunch(ctx, parsed);

    if (!result.success) {
      return {
        data: result,
        statusCode: 422,
      };
    }

    return {
      data: result,
      statusCode: result.isReplay ? 200 : 201,
    };
  },
});
