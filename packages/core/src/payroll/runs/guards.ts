import { and, eq, sql } from 'drizzle-orm';
import { Database, payrollPeriods, payrollInputs } from '@hrms/db';
import { PERMISSIONS, ValidationError } from '@hrms/shared';
import { getUserAuthorization } from '../../rbac/effective-permissions.js';
import { AttendanceLockService } from '../../attendance/lock-service.js';

/**
 * True when the skip flag may be honoured. It is only ever honoured outside production so that
 * test environments can exercise the machine without fixtures for the attendance module.
 */
export function canSkipAttendanceLockCheck(requested: boolean | undefined): boolean {
  return Boolean(requested) && process.env.NODE_ENV !== 'production';
}

/**
 * Preconditions for DRAFT -> INPUTS_READY (PHASE4_SPEC section 6):
 *  - the payroll period exists in this tenant;
 *  - the attendance period covering the payroll period is locked (unless explicitly skipped outside production);
 *  - no payroll input for the period is still pending approval.
 * Throws ValidationError describing every failed precondition.
 */
export async function assertInputsReadyPreconditions(
  db: Database,
  companyId: string,
  periodId: string,
  options: { skipAttendanceLockCheck?: boolean | undefined } = {},
): Promise<void> {
  const [period] = await db
    .select({
      period: payrollPeriods.period,
      startDate: payrollPeriods.startDate,
      endDate: payrollPeriods.endDate,
    })
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.companyId, companyId), eq(payrollPeriods.id, periodId)));

  if (!period) {
    throw new ValidationError('Payroll period for this run does not exist');
  }

  const failures: string[] = [];

  if (!canSkipAttendanceLockCheck(options.skipAttendanceLockCheck)) {
    // Both ends of the payroll period must fall inside a locked attendance period.
    const attendanceLocks = new AttendanceLockService();
    const [startLocked, endLocked] = await Promise.all([
      attendanceLocks.isDateLocked(companyId, period.startDate),
      attendanceLocks.isDateLocked(companyId, period.endDate),
    ]);
    if (!startLocked || !endLocked) {
      failures.push('attendance period is not locked');
    }
  }

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payrollInputs)
    .where(
      and(
        eq(payrollInputs.companyId, companyId),
        eq(payrollInputs.forPeriod, period.period),
        eq(payrollInputs.status, 'pending'),
        sql`${payrollInputs.deletedAt} IS NULL`,
      ),
    );

  if ((pending?.count ?? 0) > 0) {
    failures.push(`${pending?.count} payroll input(s) are still pending approval`);
  }

  if (failures.length > 0) {
    throw new ValidationError(`Run cannot move to inputs_ready: ${failures.join('; ')}`);
  }
}

/**
 * Verifies the unlock second approver is a real user of this tenant who holds `payroll.run.unlock`.
 * Unknown, cross-tenant and unauthorised users all fail with the same message (no enumeration).
 */
export async function assertSecondApproverCanUnlock(
  companyId: string,
  secondApproverId: string,
): Promise<void> {
  const auth = await getUserAuthorization(companyId, secondApproverId);
  if (!auth.permissions.includes(PERMISSIONS.PAYROLL_RUN_UNLOCK)) {
    throw new ValidationError('Second approver is not authorised to approve an unlock');
  }
}
