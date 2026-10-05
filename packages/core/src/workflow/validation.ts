import { z } from 'zod';

export const approverResolverSchema = z.object({
  type: z.enum(['reporting_manager', 'managers_manager', 'department_head', 'role', 'user', 'field_ref']),
  roleName: z.string().optional(),
  userId: z.string().uuid().optional(),
  fieldPath: z.string().optional(),
});

export const conditionRuleSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    field: z.string().optional(),
    op: z.enum(['==', '!=', '>', '<', '>=', '<=', 'in', 'contains', 'and', 'or', 'not']),
    value: z.unknown().optional(),
    rules: z.array(z.lazy(() => conditionRuleSchema)).optional(),
  }),
);

export const workflowStepDefinitionSchema = z.object({
  stepIndex: z.number().int().min(0),
  name: z.string().min(1).max(100),
  mode: z.enum(['any', 'all']).default('any'),
  resolver: approverResolverSchema,
  condition: conditionRuleSchema.nullable().optional(),
  selfApproval: z.enum(['allow', 'skip', 'escalate']).default('allow'),
  slaHours: z.number().int().min(1).max(720).optional(),
  reminderHours: z.number().int().min(1).max(72).optional(),
});

export const createWorkflowDefinitionSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Code must be snake_case alphanumeric'),
  name: z.string().min(2).max(100),
  entityType: z.string().min(2).max(50),
  steps: z.array(workflowStepDefinitionSchema).min(1, 'At least one step required'),
});

export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;

export const simulateWorkflowSchema = z.object({
  definitionCode: z.string().optional(),
  steps: z.array(workflowStepDefinitionSchema).optional(),
  payload: z.record(z.unknown()),
});

export type SimulateWorkflowInput = z.infer<typeof simulateWorkflowSchema>;
