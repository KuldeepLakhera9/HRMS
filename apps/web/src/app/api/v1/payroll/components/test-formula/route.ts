import { z } from 'zod';
import { createNextRoute, evaluateFormula, parseFormula } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const testFormulaSchema = z.object({
  formula: z.string().min(1, 'Formula cannot be empty'),
  sampleVariables: z.record(z.union([z.number(), z.string()])).default({}),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_COMPONENT_READ,
  schema: testFormulaSchema,
  handler: async body => {
    try {
      const ast = parseFormula(body.formula);
      const result = evaluateFormula(body.formula, body.sampleVariables);

      return {
        data: {
          valid: true,
          result: result.toFixed(2),
          ast,
        },
      };
    } catch (err: unknown) {
      const errorObj = err as { message: string; position?: number; name?: string };
      return {
        data: {
          valid: false,
          error: errorObj.message || 'Formula evaluation failed',
          position: errorObj.position,
        },
      };
    }
  },
});
