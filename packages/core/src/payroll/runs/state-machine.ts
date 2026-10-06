import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  Database,
  payrollRuns,
  payrollRunEvents,
  PayrollRun,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { assertSegregationOfDuties } from '../maker-checker.js';

export type PayrollRunStatus =
  | 'draft'
  | 'inputs_ready'
  | 'calculating'
  | 'calculated'
  | 'review'
  | 'approved'
  | 'locking'
  | 'locked'
  | 'published'
  | 'paid'
  | 'cancelled';

export const ALLOWED_TRANSITIONS: Record<PayrollRunStatus, PayrollRunStatus[]> = {
  draft: ['inputs_ready', 'cancelled'],
  inputs_ready: ['calculating', 'draft', 'cancelled'],
  calculating: ['calculated', 'draft'],
  calculated: ['review', 'draft', 'cancelled'],
  review: ['approved', 'draft', 'cancelled'],
  approved: ['locking'],
  locking: ['locked', 'review'],
  locked: ['published', 'review'], // 'review' is the unlock transition
  published: ['paid'],
  paid: [],
  cancelled: [],
};

export interface TransitionOptions {
  reason?: string;
  secondApproverId?: string;
  skipAttendanceLockCheck?: boolean;
  notes?: string;
  runHash?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Validates whether a state transition from `from` to `to` is permitted in the state machine.
 */
export function isAllowedTransition(from: PayrollRunStatus, to: PayrollRunStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * Executes a guarded transition on a payroll run with PostgreSQL row locking (SELECT ... FOR UPDATE),
 * Segregation of Duties validation, precondition verification, and immutable audit event appending.
 */
export async function executeRunTransition(
  ctx: RequestContext,
  db: Database,
  runId: string,
  toStatus: PayrollRunStatus,
  options: TransitionOptions = {},
): Promise<PayrollRun> {
  const userId = ctx.userId;
  if (!userId) {
    throw new ForbiddenError('User authentication required to transition payroll run state');
  }

  // 1. Acquire exclusive row lock using SELECT ... FOR UPDATE
  const [lockedRun] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.id, runId))
    .for('update');

  if (!lockedRun) {
    throw new NotFoundError(`Payroll run with id '${runId}' not found`);
  }

  const currentStatus = lockedRun.status as PayrollRunStatus;

  // 2. Validate allowed transition in the state machine
  if (!isAllowedTransition(currentStatus, toStatus)) {
    throw new ValidationError(
      `Forbidden transition: Cannot transition payroll run from '${currentStatus}' to '${toStatus}'`,
    );
  }

  // 3. Precondition & Security Guards per Transition
  const updates: Partial<typeof payrollRuns.$inferInsert> = {
    status: toStatus,
    updatedBy: userId,
    updatedAt: new Date(),
  };

  if (toStatus === 'inputs_ready') {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_CREATE) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_CALCULATE)) {
      throw new ForbiddenError('Permission denied: payroll.run.create or calculate required');
    }
  }

  if (toStatus === 'approved') {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_APPROVE)) {
      throw new ForbiddenError('Permission denied: payroll.run.approve required');
    }
    // Segregation of Duties: Creator cannot approve
    assertSegregationOfDuties(lockedRun.createdBy, userId, 'payroll run approval');
    updates.approvedBy = userId;
  }

  if (toStatus === 'locked') {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_LOCK)) {
      throw new ForbiddenError('Permission denied: payroll.run.lock required');
    }
    // Segregation of Duties: Locker cannot be the approver or the creator
    assertSegregationOfDuties(lockedRun.approvedBy, userId, 'payroll run lock');
    if (lockedRun.createdBy && lockedRun.createdBy === userId) {
      throw new ForbiddenError('Segregation of duties violation: Creator cannot lock the payroll run');
    }

    updates.lockedBy = userId;
    updates.lockedAt = new Date();

    // Compute run hash if not passed
    updates.runHash = options.runHash || crypto
      .createHash('sha256')
      .update(`${lockedRun.id}:${lockedRun.periodId}:${new Date().toISOString()}`)
      .digest('hex');
  }

  if (currentStatus === 'locked' && toStatus === 'review') {
    // Unlock Guard: requires unlock permission, reason, and second approver
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_UNLOCK)) {
      throw new ForbiddenError('Permission denied: payroll.run.unlock required to unlock payroll run');
    }
    if (!options.reason || options.reason.trim().length === 0) {
      throw new ValidationError('A non-empty justification reason is strictly required to unlock a locked run');
    }
    if (!options.secondApproverId || options.secondApproverId === userId) {
      throw new ValidationError('A distinct second approver is required to unlock a locked run');
    }
  }

  if (toStatus === 'published') {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_PUBLISH)) {
      throw new ForbiddenError('Permission denied: payroll.run.publish required');
    }
  }

  if (options.notes) {
    updates.notes = options.notes;
  }

  // 4. Atomically update payroll run
  const [updatedRun] = await db
    .update(payrollRuns)
    .set(updates)
    .where(eq(payrollRuns.id, runId))
    .returning();

  if (!updatedRun) {
    throw new Error('Failed to update payroll run state');
  }

  // 5. Append immutable audit event to payroll_run_events
  await db.insert(payrollRunEvents).values({
    companyId: ctx.companyId,
    runId,
    actorId: userId,
    fromStatus: currentStatus,
    toStatus,
    event: `run.transition.${currentStatus}_to_${toStatus}`,
    details: {
      reason: options.reason || null,
      secondApproverId: options.secondApproverId || null,
      notes: options.notes || null,
      runHash: updates.runHash || null,
      ...options.metadata,
    },
  });

  return updatedRun;
}
