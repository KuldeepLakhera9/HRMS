import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
import { assertStepUp } from '../crypto/cipher.js';
import { assertInputsReadyPreconditions, assertSecondApproverCanUnlock } from './guards.js';

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

/**
 * Permissions accepted for each target status (any one suffices). The unlock transition
 * (locked -> review) and the lock-rollback (locking -> review) are handled separately below.
 * There is no dedicated "pay" permission in the Phase 4 catalog, so `paid` requires
 * `payroll.run.publish` until bank-file permissions land (see docs/decisions).
 */
const TARGET_PERMISSIONS: Record<PayrollRunStatus, string[]> = {
  draft: [PERMISSIONS.PAYROLL_RUN_CREATE, PERMISSIONS.PAYROLL_RUN_CALCULATE],
  inputs_ready: [PERMISSIONS.PAYROLL_RUN_CREATE, PERMISSIONS.PAYROLL_RUN_CALCULATE],
  calculating: [PERMISSIONS.PAYROLL_RUN_CALCULATE],
  calculated: [PERMISSIONS.PAYROLL_RUN_CALCULATE],
  review: [PERMISSIONS.PAYROLL_RUN_REVIEW, PERMISSIONS.PAYROLL_RUN_CALCULATE],
  approved: [PERMISSIONS.PAYROLL_RUN_APPROVE],
  locking: [PERMISSIONS.PAYROLL_RUN_LOCK],
  locked: [PERMISSIONS.PAYROLL_RUN_LOCK],
  published: [PERMISSIONS.PAYROLL_RUN_PUBLISH],
  paid: [PERMISSIONS.PAYROLL_RUN_PUBLISH],
  cancelled: [PERMISSIONS.PAYROLL_RUN_CREATE, PERMISSIONS.PAYROLL_RUN_APPROVE],
};

export interface TransitionOptions {
  reason?: string;
  secondApproverId?: string;
  /** Honoured only outside production (test fixtures); production always enforces the attendance lock. */
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

function assertHasAnyPermission(ctx: RequestContext, required: string[]): void {
  if (!required.some(p => ctx.permissions?.includes(p))) {
    throw new ForbiddenError(`Permission denied: ${required.join(' or ')} required`);
  }
}

/**
 * Executes a guarded transition on a payroll run with PostgreSQL row locking (SELECT ... FOR UPDATE),
 * permission checks per target state, Segregation of Duties, step-up for approve/unlock,
 * preconditions, and immutable audit event appending. Runs inside the caller's tenant transaction.
 * Permission: depends on the target state (see TARGET_PERMISSIONS).
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

  // 1. Acquire exclusive row lock using SELECT ... FOR UPDATE (tenant-scoped; RLS enforces it again)
  const [lockedRun] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)))
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

  // 3. Permission, SoD and precondition guards per transition
  const updates: Partial<typeof payrollRuns.$inferInsert> = {
    status: toStatus,
    updatedBy: userId,
    updatedAt: new Date(),
  };

  const isUnlock = currentStatus === 'locked' && toStatus === 'review';
  const isLockRollback = currentStatus === 'locking' && toStatus === 'review';

  if (isUnlock) {
    assertHasAnyPermission(ctx, [PERMISSIONS.PAYROLL_RUN_UNLOCK]);
  } else if (isLockRollback) {
    assertHasAnyPermission(ctx, [PERMISSIONS.PAYROLL_RUN_LOCK]);
  } else {
    assertHasAnyPermission(ctx, TARGET_PERMISSIONS[toStatus]);
  }

  if (toStatus === 'inputs_ready' && currentStatus === 'draft') {
    await assertInputsReadyPreconditions(db, ctx.companyId, lockedRun.periodId, {
      skipAttendanceLockCheck: options.skipAttendanceLockCheck,
    });
  }

  if (toStatus === 'approved') {
    assertStepUp(ctx, 'approve a payroll run');
    // Segregation of Duties: Creator cannot approve
    assertSegregationOfDuties(lockedRun.createdBy, userId, 'payroll run approval');
    const counts = lockedRun.counts as { errors?: number } | null;
    if ((counts?.errors ?? 0) > 0) {
      throw new ValidationError(
        'Run has unresolved calculation errors; resolve or hold the affected employees before approval',
      );
    }
    updates.approvedBy = userId;
  }

  if (toStatus === 'locking' || toStatus === 'locked') {
    // Segregation of Duties: Locker cannot be the approver or the creator
    assertSegregationOfDuties(lockedRun.approvedBy, userId, 'payroll run lock');
    if (lockedRun.createdBy && lockedRun.createdBy === userId) {
      throw new ForbiddenError('Segregation of duties violation: Creator cannot lock the payroll run');
    }
  }

  if (toStatus === 'locked') {
    updates.lockedBy = userId;
    updates.lockedAt = new Date();

    // Run hash scaffolding: Sprint 4.3 replaces this with a hash over all payslip integrity hashes.
    updates.runHash = options.runHash || crypto
      .createHash('sha256')
      .update(`${lockedRun.id}:${lockedRun.periodId}:${new Date().toISOString()}`)
      .digest('hex');
  }

  if (isUnlock) {
    // Unlock Guard: step-up, reason, distinct second approver who also holds the unlock permission
    assertStepUp(ctx, 'unlock a payroll run');
    if (!options.reason || options.reason.trim().length === 0) {
      throw new ValidationError('A non-empty justification reason is strictly required to unlock a locked run');
    }
    if (!options.secondApproverId || options.secondApproverId === userId) {
      throw new ValidationError('A distinct second approver is required to unlock a locked run');
    }
    await assertSecondApproverCanUnlock(ctx.companyId, options.secondApproverId);
  }

  if (options.notes) {
    updates.notes = options.notes;
  }

  // 4. Atomically update payroll run
  const [updatedRun] = await db
    .update(payrollRuns)
    .set(updates)
    .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)))
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
