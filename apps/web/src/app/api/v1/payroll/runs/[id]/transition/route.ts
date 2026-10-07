import { z } from 'zod';
import {
  createNextRoute,
  PayrollRunService,
  PayslipMaterializationService,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const runService = new PayrollRunService();
const materializationService = new PayslipMaterializationService();

const transitionRunSchema = z.object({
  id: z.string().uuid(),
  toStatus: z.enum([
    'draft',
    'inputs_ready',
    'calculating',
    'calculated',
    'review',
    'approved',
    'locking',
    'locked',
    'published',
    'paid',
    'cancelled',
  ]),
  reason: z.string().optional(),
  secondApproverId: z.string().uuid().optional(),
  notes: z.string().optional(),
  skipAttendanceLockCheck: z.boolean().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: transitionRunSchema,
  handler: async (body, ctx, tx) => {
    if (body.toStatus === 'locked') {
      const locked = await materializationService.materializeAndLockRun(ctx, tx!, body.id);
      return { data: locked };
    }
    const updated = await runService.transitionRun(ctx, tx!, body.id, body.toStatus, {
      reason: body.reason,
      secondApproverId: body.secondApproverId,
      notes: body.notes,
      skipAttendanceLockCheck: body.skipAttendanceLockCheck,
    });
    return { data: updated };
  },
});
