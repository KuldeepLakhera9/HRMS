import type pg from 'pg';
import { DateTime } from 'luxon';
import {
  ForbiddenError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import { getAppPool, withTenant, type LeaveType } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import { LeaveLedgerRepository } from './ledger-repository.js';
import { LeaveBalanceRepository } from './balance-repository.js';
import { LeavePolicyResolver } from './policy-resolver.js';

export interface AccrualJobResult {
  totalProcessed: number;
  accruedCount: number;
  skippedCount: number;
  errors: string[];
}

export interface PeriodEndJobResult {
  totalProcessed: number;
  carriedForwardCount: number;
  expiredCount: number;
  errors: string[];
}

export interface ReconciliationDiscrepancy {
  employeeId: string;
  leaveTypeId: string;
  periodKey: string;
  balanceClosing: number;
  ledgerSum: number;
  discrepancy: number;
}

export interface ManualAdjustmentInput {
  employeeId: string;
  leaveTypeId: string;
  periodKey: string;
  deltaDays: number;
  reason: string;
  effectiveDate?: string | undefined; // 'YYYY-MM-DD'
}

export class LeaveJobsService {
  private ledgerRepo: LeaveLedgerRepository;
  private balanceRepo: LeaveBalanceRepository;
  private policyResolver: LeavePolicyResolver;
  private auditService: AuditService;

  constructor(
    ledgerRepo?: LeaveLedgerRepository,
    balanceRepo?: LeaveBalanceRepository,
    policyResolver?: LeavePolicyResolver,
    auditService?: AuditService,
  ) {
    this.ledgerRepo = ledgerRepo ?? new LeaveLedgerRepository();
    this.balanceRepo = balanceRepo ?? new LeaveBalanceRepository();
    this.policyResolver = policyResolver ?? new LeavePolicyResolver();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Executes scheduled leave accrual with deduplication keys (PHASE3_SPEC Section 5.3).
   * Supports monthly, quarterly, yearly accrual with pro-rata joiner calculation.
   */
  async runAccrual(
    companyId: string,
    periodKey: string,
    runDateISO?: string,
    poolOverride?: pg.Pool,
  ): Promise<AccrualJobResult> {
    const pool = poolOverride ?? getAppPool();
    const result: AccrualJobResult = {
      totalProcessed: 0,
      accruedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    const effectiveDate = runDateISO ?? DateTime.now().toISODate()!;
    const runDt = DateTime.fromISO(effectiveDate);

    // 1. Fetch all active employees and leave types
    const { employees, leaveTypes } = await withTenant({ companyId }, async (_tx, client) => {
      const empRes = await client.query<{ id: string; doj: string; timezone: string | null }>(
        `SELECT id, doj, timezone FROM employees WHERE company_id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [companyId],
      );
      const ltRes = await client.query<LeaveType>(
        `SELECT * FROM leave_types WHERE company_id = $1 AND active = true AND deleted_at IS NULL`,
        [companyId],
      );
      return { employees: empRes.rows, leaveTypes: ltRes.rows };
    }, pool);

    // 2. Process accrual for each employee & leave type
    for (const emp of employees) {
      for (const lt of leaveTypes) {
        result.totalProcessed++;

        try {
          const policyRes = await this.policyResolver.resolvePolicy(
            companyId,
            emp.id,
            lt.id,
            pool,
          );

          if (!policyRes || !policyRes.policy) {
            result.skippedCount++;
            continue;
          }

          const policy = policyRes.policy;
          const accrualConfig = policy.accrual as {
            frequency: 'monthly' | 'quarterly' | 'yearly' | 'on_joining';
            amount: number;
            proRata?: boolean;
            rounding?: number;
          };

          if (!accrualConfig || accrualConfig.amount <= 0) {
            result.skippedCount++;
            continue;
          }

          // Calculate pro-rata accrual for mid-period joiners
          let amountToAccrue = accrualConfig.amount;
          const dojDt = DateTime.fromISO(emp.doj);

          if (accrualConfig.proRata && dojDt.isValid && dojDt > runDt.startOf('year')) {
            // Joiner in current year: calculate fraction of month / period
            if (dojDt.month === runDt.month && dojDt.year === runDt.year) {
              const daysInMonth = runDt.daysInMonth ?? 30;
              const remainingDays = Math.max(1, daysInMonth - dojDt.day + 1);
              const fraction = remainingDays / daysInMonth;
              const rawAmount = accrualConfig.amount * fraction;
              const rounding = accrualConfig.rounding ?? 0.5;
              amountToAccrue = Math.round(rawAmount / rounding) * rounding;
            }
          }

          const dedupeKey = `accrual:${emp.id}:${lt.id}:${periodKey}:${runDt.month}`;

          await withTenant({ companyId }, async (_tx, client) => {
            // Lock balance row FOR UPDATE
            const balance = await this.balanceRepo.lockBalanceForUpdate(
              companyId,
              emp.id,
              lt.id,
              periodKey,
              client,
            );

            // Record immutable ledger entry with dedupe key
            await this.ledgerRepo.recordEntry(
              companyId,
              {
                employeeId: emp.id,
                leaveTypeId: lt.id,
                periodKey,
                entryType: 'accrual',
                deltaDays: amountToAccrue,
                effectiveDate,
                refType: 'accrual_job',
                reason: `Automated accrual for period ${periodKey}`,
                dedupeKey,
                createdBy: '00000000-0000-0000-0000-000000000000',
              },
              client,
            );

            // If entry was inserted now (or was previously inserted), update balance cache
            const newAccrued = parseFloat(balance.accrued) + amountToAccrue;
            await this.balanceRepo.updateBalance(
              companyId,
              balance.id,
              { accrued: newAccrued },
              client,
            );

            result.accruedCount++;
          }, pool);
        } catch (err) {
          result.errors.push(
            `Error accruing leave for employee ${emp.id}, type ${lt.code}: ${(err as Error).message}`,
          );
        }
      }
    }

    return result;
  }

  /**
   * Executes year/period end carry-forward and expiry (PHASE3_SPEC Section 5.3).
   */
  async runPeriodEnd(
    companyId: string,
    oldPeriodKey: string,
    newPeriodKey: string,
    poolOverride?: pg.Pool,
  ): Promise<PeriodEndJobResult> {
    const pool = poolOverride ?? getAppPool();
    const result: PeriodEndJobResult = {
      totalProcessed: 0,
      carriedForwardCount: 0,
      expiredCount: 0,
      errors: [],
    };

    const balances = await withTenant({ companyId }, async (_tx, client) => {
      return this.balanceRepo.listBalances(companyId, { periodKey: oldPeriodKey }, client);
    }, pool);

    const todayISO = DateTime.now().toISODate()!;

    for (const b of balances) {
      result.totalProcessed++;
      try {
        const policyRes = await this.policyResolver.resolvePolicy(
          companyId,
          b.employeeId,
          b.leaveTypeId,
          pool,
        );

        const carryForward = (policyRes?.policy?.carryForward as {
          enabled?: boolean;
          maxDays?: number;
          expiryDays?: number;
        }) ?? { enabled: false };

        const closingBalance = parseFloat(b.closing);
        if (closingBalance <= 0) continue;

        let carryForwardDays = 0;
        let expiredDays = 0;

        if (carryForward.enabled) {
          const maxCarry = carryForward.maxDays ?? 0;
          carryForwardDays = Math.min(closingBalance, maxCarry);
          expiredDays = Math.max(0, closingBalance - carryForwardDays);
        } else {
          expiredDays = closingBalance;
        }

        await withTenant({ companyId }, async (_tx, client) => {
          // 1. Expire excess balance in old period
          if (expiredDays > 0) {
            await this.ledgerRepo.recordEntry(
              companyId,
              {
                employeeId: b.employeeId,
                leaveTypeId: b.leaveTypeId,
                periodKey: oldPeriodKey,
                entryType: 'expiry',
                deltaDays: -expiredDays,
                effectiveDate: todayISO,
                refType: 'period_end_job',
                reason: `Period-end expiry for period ${oldPeriodKey}`,
                dedupeKey: `expiry:${b.employeeId}:${b.leaveTypeId}:${oldPeriodKey}`,
                createdBy: '00000000-0000-0000-0000-000000000000',
              },
              client,
            );

            await this.balanceRepo.updateBalance(
              companyId,
              b.id,
              { expired: parseFloat(b.expired) + expiredDays },
              client,
            );
            result.expiredCount++;
          }

          // 2. Open new period with carried forward balance
          if (carryForwardDays > 0) {
            const newBal = await this.balanceRepo.lockBalanceForUpdate(
              companyId,
              b.employeeId,
              b.leaveTypeId,
              newPeriodKey,
              client,
            );

            await this.ledgerRepo.recordEntry(
              companyId,
              {
                employeeId: b.employeeId,
                leaveTypeId: b.leaveTypeId,
                periodKey: newPeriodKey,
                entryType: 'opening',
                deltaDays: carryForwardDays,
                effectiveDate: todayISO,
                refType: 'period_end_job',
                reason: `Carried forward from ${oldPeriodKey}`,
                dedupeKey: `opening:${b.employeeId}:${b.leaveTypeId}:${newPeriodKey}`,
                createdBy: '00000000-0000-0000-0000-000000000000',
              },
              client,
            );

            await this.balanceRepo.updateBalance(
              companyId,
              newBal.id,
              { opening: carryForwardDays },
              client,
            );
            result.carriedForwardCount++;
          }
        }, pool);
      } catch (err) {
        result.errors.push(`Period end error for balance ${b.id}: ${(err as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Reconciles leave_balances.closing against SUM(leave_ledger.delta_days).
   * Invariant: closing == sum(ledger).
   */
  async reconcileBalances(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<ReconciliationDiscrepancy[]> {
    const pool = poolOverride ?? getAppPool();

    return withTenant({ companyId }, async (_tx, client) => {
      const res = await client.query<{
        employeeId: string;
        leaveTypeId: string;
        periodKey: string;
        balanceClosing: string;
        ledgerSum: string;
      }>(
        `SELECT
           b.employee_id as "employeeId",
           b.leave_type_id as "leaveTypeId",
           b.period_key as "periodKey",
           b.closing as "balanceClosing",
           COALESCE(l.ledger_sum, 0) as "ledgerSum"
         FROM leave_balances b
         LEFT JOIN (
           SELECT
             company_id,
             employee_id,
             leave_type_id,
             period_key,
             SUM(delta_days) as ledger_sum
           FROM leave_ledger
           WHERE company_id = $1
           GROUP BY company_id, employee_id, leave_type_id, period_key
         ) l ON l.company_id = b.company_id
            AND l.employee_id = b.employee_id
            AND l.leave_type_id = b.leave_type_id
            AND l.period_key = b.period_key
         WHERE b.company_id = $1
           AND ABS(b.closing - COALESCE(l.ledger_sum, 0)) > 0.001`,
        [companyId],
      );

      return res.rows.map(r => ({
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        periodKey: r.periodKey,
        balanceClosing: parseFloat(r.balanceClosing),
        ledgerSum: parseFloat(r.ledgerSum),
        discrepancy: Math.round((parseFloat(r.balanceClosing) - parseFloat(r.ledgerSum)) * 1000) / 1000,
      }));
    }, pool);
  }

  /**
   * Manual leave balance adjustment (HR role only, step-up auth required, audited).
   */
  async adjustBalance(
    ctx: RequestContext,
    input: ManualAdjustmentInput,
    poolOverride?: pg.Pool,
  ) {
    if (!can(ctx, PERMISSIONS.LEAVE_BALANCE_ADJUST)) {
      throw new ForbiddenError('Permission denied: leave.balance.adjust required.');
    }

    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError('A mandatory reason is required for manual balance adjustments.');
    }

    if (input.deltaDays === 0) {
      throw new ValidationError('Adjustment deltaDays must be non-zero.');
    }

    const pool = poolOverride ?? getAppPool();
    const effectiveDate = input.effectiveDate ?? DateTime.now().toISODate()!;
    const dedupeKey = `adjustment:${input.employeeId}:${input.leaveTypeId}:${input.periodKey}:${Date.now()}`;

    const result = await withTenant(ctx, async (_tx, client) => {
      // 1. Lock balance row
      const balance = await this.balanceRepo.lockBalanceForUpdate(
        ctx.companyId,
        input.employeeId,
        input.leaveTypeId,
        input.periodKey,
        client,
      );

      // 2. Append immutable ledger entry
      const ledgerEntry = await this.ledgerRepo.recordEntry(
        ctx.companyId,
        {
          employeeId: input.employeeId,
          leaveTypeId: input.leaveTypeId,
          periodKey: input.periodKey,
          entryType: 'adjustment',
          deltaDays: input.deltaDays,
          effectiveDate,
          refType: 'manual_adjustment',
          reason: input.reason,
          dedupeKey,
          createdBy: ctx.userId ?? '00000000-0000-0000-0000-000000000000',
        },
        client,
      );

      // 3. Update balance cache
      const newAdjusted = parseFloat(balance.adjusted) + input.deltaDays;
      const updatedBalance = await this.balanceRepo.updateBalance(
        ctx.companyId,
        balance.id,
        { adjusted: newAdjusted },
        client,
      );

      return { balance: updatedBalance, ledgerEntry };
    }, pool);

    await this.auditService.recordEvent(ctx, {
      action: 'leave.balance.adjust',
      entity: 'leave_balances',
      entityId: result.balance.id,
      after: {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        deltaDays: input.deltaDays,
        reason: input.reason,
        closing: result.balance.closing,
      },
    });

    return result;
  }
}
