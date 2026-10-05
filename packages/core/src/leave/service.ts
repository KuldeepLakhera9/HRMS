import type pg from 'pg';
import { DateTime } from 'luxon';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  PERMISSIONS,
} from '@hrms/shared';
import {
  generateUuidV7,
  getAppPool,
  withTenant,
  type LeaveRequest,
  type LeaveRequestDay,
  type LeaveType,
} from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import { WorkflowService } from '../workflow/service.js';
import { LeaveBalanceRepository } from './balance-repository.js';
import { LeaveLedgerRepository } from './ledger-repository.js';
import { LeavePolicyResolver } from './policy-resolver.js';
import { HolidayService } from './holiday-service.js';
import {
  computeLeaveDays,
  LEAVE_RULE_VERSION,
  type LeaveEmployeeInput,
  type LeaveTypePolicyInput,
  type ExistingLeaveDayInput,
  type LeaveDayItem,
} from './compute-leave-days.js';

export interface PreviewLeaveInput {
  employeeId?: string | undefined;
  leaveTypeId: string;
  fromDate: string; // 'YYYY-MM-DD'
  toDate: string;   // 'YYYY-MM-DD'
  fromPart?: 'full' | 'first' | 'second' | undefined;
  toPart?: 'full' | 'first' | 'second' | undefined;
  hours?: number | undefined;
}

export interface SubmitLeaveInput extends PreviewLeaveInput {
  reason: string;
  documentFileId?: string | null | undefined;
  idempotencyKey?: string | undefined;
}

export interface ClashWarning {
  date: string;
  employeeId: string;
  employeeName: string;
}

export interface LeavePreviewResult {
  breakdown: LeaveDayItem[];
  payableDays: number;
  lopDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  totalRequestedDays: number;
  balanceBefore: number;
  balanceAfter: number;
  projectedLop: boolean;
  clashWarnings: ClashWarning[];
  approvalRoute: Array<{
    stepIndex: number;
    name: string;
    approverType: string;
    approverRole?: string | undefined;
  }>;
}

export interface LeaveCalendarDayItem {
  date: string;
  employeeId: string;
  employeeName: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  dayPortion: number;
  part: 'full' | 'first' | 'second' | 'hours';
  status: 'pending' | 'approved';
}

export class LeaveService {
  private balanceRepo: LeaveBalanceRepository;
  private ledgerRepo: LeaveLedgerRepository;
  private policyResolver: LeavePolicyResolver;
  private holidayService: HolidayService;
  private workflowService: WorkflowService;
  private auditService: AuditService;

  constructor(
    balanceRepo?: LeaveBalanceRepository,
    ledgerRepo?: LeaveLedgerRepository,
    policyResolver?: LeavePolicyResolver,
    holidayService?: HolidayService,
    workflowService?: WorkflowService,
    auditService?: AuditService,
  ) {
    this.balanceRepo = balanceRepo ?? new LeaveBalanceRepository();
    this.ledgerRepo = ledgerRepo ?? new LeaveLedgerRepository();
    this.policyResolver = policyResolver ?? new LeavePolicyResolver();
    this.holidayService = holidayService ?? new HolidayService();
    this.workflowService = workflowService ?? new WorkflowService();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Live preview of leave application (PHASE3_SPEC Section 5.2).
   * Pure evaluation with clash detection & approval route preview.
   * Query budget <= 6.
   */
  async previewLeave(
    ctx: RequestContext,
    input: PreviewLeaveInput,
    poolOverride?: pg.Pool,
  ): Promise<LeavePreviewResult> {
    const targetEmployeeId = input.employeeId ?? ctx.employeeId;
    if (!targetEmployeeId) {
      throw new ValidationError('Employee ID is required for leave preview.');
    }

    if (input.employeeId && input.employeeId !== ctx.employeeId && !can(ctx, PERMISSIONS.LEAVE_REQUEST_CREATE)) {
      throw new ForbiddenError('Permission denied: cannot preview leave on behalf of another employee.');
    }

    if (input.fromDate > input.toDate) {
      throw new ValidationError('From date cannot be after to date.');
    }

    const pool = poolOverride ?? getAppPool();
    const periodKey = DateTime.fromISO(input.fromDate).toFormat('yyyy');

    return withTenant(ctx, async (_tx, client) => {
      // 1. Fetch employee details
      const empRes = await client.query<{
        id: string;
        doj: string;
        gender: string;
        employment_type: string;
        location_id: string | null;
        department_id: string | null;
        timezone: string | null;
        first_name: string;
        last_name: string;
      }>(
        `SELECT id, doj, gender, employment_type, location_id, department_id, timezone, first_name, last_name
         FROM employees
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [ctx.companyId, targetEmployeeId],
      );

      const emp = empRes.rows[0];
      if (!emp) {
        throw new NotFoundError(`Employee ${targetEmployeeId} not found.`);
      }

      // 2. Resolve leave type & policy
      const ltRes = await client.query<LeaveType>(
        `SELECT * FROM leave_types WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [ctx.companyId, input.leaveTypeId],
      );
      const leaveType = ltRes.rows[0];
      if (!leaveType) {
        throw new NotFoundError(`Leave type ${input.leaveTypeId} not found.`);
      }

      const policyRes = await this.policyResolver.resolvePolicy(
        ctx.companyId,
        targetEmployeeId,
        input.leaveTypeId,
        pool,
      );
      const policy = policyRes?.policy;

      // 3. Fetch current balance
      const balance = await this.balanceRepo.getOrCreateBalance(
        ctx.companyId,
        targetEmployeeId,
        input.leaveTypeId,
        periodKey,
        client,
      );

      const closingBal = parseFloat(balance.closing);
      const pendingBal = parseFloat(balance.pending);
      const availableBalance = Math.max(0, closingBal - pendingBal);

      // 4. Fetch holidays in range
      const holidays = await this.holidayService.resolveHolidaysForEmployee(
        ctx.companyId,
        emp.location_id,
        input.fromDate,
        input.toDate,
        client,
      );

      // 5. Fetch existing leave days in range for overlap / sandwich calculation
      const fromSearch = DateTime.fromISO(input.fromDate).minus({ days: 7 }).toISODate()!;
      const toSearch = DateTime.fromISO(input.toDate).plus({ days: 7 }).toISODate()!;

      const existingDaysRes = await client.query<{
        leave_date: string;
        part: 'full' | 'first' | 'second' | 'hours';
        days: string;
        is_paid: boolean;
      }>(
        `SELECT leave_date, part, days, is_paid
         FROM leave_request_days
         WHERE company_id = $1
           AND employee_id = $2
           AND leave_date >= $3
           AND leave_date <= $4
           AND status IN ('pending', 'approved')`,
        [ctx.companyId, targetEmployeeId, fromSearch, toSearch],
      );

      const existingDays: ExistingLeaveDayInput[] = existingDaysRes.rows.map(r => ({
        date: r.leave_date,
        part: r.part,
        status: 'approved',
      }));

      // 6. Fetch team clash warnings (if employee belongs to department)
      const clashWarnings: ClashWarning[] = [];
      if (emp.department_id) {
        const clashRes = await client.query<{
          leave_date: string;
          employee_id: string;
          first_name: string;
          last_name: string;
        }>(
          `SELECT d.leave_date, d.employee_id, e.first_name, e.last_name
           FROM leave_request_days d
           JOIN employees e ON e.company_id = d.company_id AND e.id = d.employee_id
           WHERE d.company_id = $1
             AND e.department_id = $2
             AND d.employee_id != $3
             AND d.status IN ('pending', 'approved')
             AND d.leave_date >= $4
             AND d.leave_date <= $5
           LIMIT 10`,
          [ctx.companyId, emp.department_id, targetEmployeeId, input.fromDate, input.toDate],
        );

        for (const row of clashRes.rows) {
          clashWarnings.push({
            date: row.leave_date,
            employeeId: row.employee_id,
            employeeName: `${row.first_name} ${row.last_name}`.trim(),
          });
        }
      }

      // Execute computeLeaveDays pure calculation
      const employeeInput: LeaveEmployeeInput = {
        id: emp.id,
        gender: emp.gender as 'male' | 'female' | 'other',
        doj: emp.doj,
        employmentType: emp.employment_type as 'full_time' | 'part_time' | 'contractor' | 'intern',
        locationId: emp.location_id ?? 'default-loc',
        departmentId: emp.department_id ?? 'default-dept',
        timezone: emp.timezone ?? 'Asia/Kolkata',
      };

      const leaveTypePolicyInput: LeaveTypePolicyInput = {
        code: leaveType.code,
        name: leaveType.name,
        isPaid: leaveType.isPaid,
        unit: leaveType.unit,
        allowHalfDay: leaveType.allowHalfDay,
        allowHourly: leaveType.allowHourly,
        minNoticeDays: leaveType.minNoticeDays,
        maxConsecutiveDays: leaveType.maxConsecutiveDays,
        requiresDocumentAfterDays: leaveType.requiresDocumentAfterDays,
        sandwichRule: leaveType.sandwichRule,
        allowNegativeBalance: leaveType.allowNegativeBalance,
        negativeLimit: parseFloat(leaveType.negativeLimit),
        applicableTo: leaveType.applicableTo,
        maxBalance: policy?.maxBalance ? parseFloat(policy.maxBalance) : undefined,
        probationRule: policy?.probationRule,
      };

      const computeRes = computeLeaveDays({
        employee: employeeInput,
        leaveType: leaveTypePolicyInput,
        balance: {
          closing: closingBal,
          pending: pendingBal,
          available: availableBalance,
        },
        fromDate: input.fromDate,
        toDate: input.toDate,
        fromPart: input.fromPart ?? 'full',
        toPart: input.toPart ?? 'full',
        hours: input.hours,
        existingLeaves: existingDays,
        holidays: holidays.map(h => h.date),
      });

      // Preview workflow route
      let approvalRoute: LeavePreviewResult['approvalRoute'] = [];
      try {
        const sim = await this.workflowService.simulateWorkflow(ctx, {
          definitionCode: 'leave',
          payload: {
            days: computeRes.totalDays,
            leaveTypeCode: leaveType.code,
            employeeId: targetEmployeeId,
          },
        }, pool);

        approvalRoute = sim.steps.map(s => ({
          stepIndex: s.stepIndex,
          name: s.name,
          approverType: s.approverType,
          approverRole: s.approverRole,
        }));
      } catch {
        // Fallback default 1-step manager approval if workflow definition uninitialized
        approvalRoute = [{ stepIndex: 0, name: 'Reporting Manager', approverType: 'manager' }];
      }

      const weeklyOffCount = computeRes.days.filter(d => d.isWeeklyOff).length;
      const holidayCount = computeRes.days.filter(d => d.isHoliday).length;

      return {
        breakdown: computeRes.days,
        payableDays: computeRes.totalDays,
        lopDays: 0,
        weeklyOffDays: weeklyOffCount,
        holidayDays: holidayCount,
        totalRequestedDays: computeRes.days.length,
        balanceBefore: availableBalance,
        balanceAfter: computeRes.balanceAfter.projectedAvailable,
        projectedLop: computeRes.violations.some(v => v.includes('Insufficient balance')),
        clashWarnings,
        approvalRoute,
      };
    }, pool);
  }

  /**
   * Submits a leave request with transactional locking and workflow integration.
   * Query budget <= 12.
   */
  async submitRequest(
    ctx: RequestContext,
    input: SubmitLeaveInput,
    poolOverride?: pg.Pool,
  ): Promise<{ request: LeaveRequest; breakdown: LeaveDayItem[] }> {
    const targetEmployeeId = input.employeeId ?? ctx.employeeId;
    if (!targetEmployeeId) {
      throw new ValidationError('Employee ID is required.');
    }

    if (input.employeeId && input.employeeId !== ctx.employeeId && !can(ctx, PERMISSIONS.LEAVE_REQUEST_CREATE)) {
      throw new ForbiddenError('Permission denied: cannot submit leave for another employee.');
    }

    if (!input.reason || input.reason.trim().length === 0) {
      throw new ValidationError('A reason is mandatory for leave requests.');
    }

    const pool = poolOverride ?? getAppPool();
    const periodKey = DateTime.fromISO(input.fromDate).toFormat('yyyy');
    const requestId = generateUuidV7();

    return withTenant(ctx, async (_tx, client) => {
      // 1. Fetch employee
      const empRes = await client.query<{
        id: string;
        doj: string;
        gender: string;
        employment_type: string;
        location_id: string | null;
        department_id: string | null;
        timezone: string | null;
      }>(
        `SELECT id, doj, gender, employment_type, location_id, department_id, timezone
         FROM employees
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [ctx.companyId, targetEmployeeId],
      );

      const emp = empRes.rows[0];
      if (!emp) {
        throw new NotFoundError(`Employee ${targetEmployeeId} not found.`);
      }

      // 2. Fetch leave type & policy
      const ltRes = await client.query<LeaveType>(
        `SELECT * FROM leave_types WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [ctx.companyId, input.leaveTypeId],
      );
      const leaveType = ltRes.rows[0];
      if (!leaveType) {
        throw new NotFoundError(`Leave type ${input.leaveTypeId} not found.`);
      }

      const policyRes = await this.policyResolver.resolvePolicy(
        ctx.companyId,
        targetEmployeeId,
        input.leaveTypeId,
        pool,
      );

      // 3. Acquire ROW-LEVEL LOCK on leave balance
      const balance = await this.balanceRepo.lockBalanceForUpdate(
        ctx.companyId,
        targetEmployeeId,
        input.leaveTypeId,
        periodKey,
        client,
      );

      const closingBal = parseFloat(balance.closing);
      const pendingBal = parseFloat(balance.pending);
      const availableBalance = closingBal - pendingBal;

      // 4. Fetch holidays & existing leaves for calculation
      const holidays = await this.holidayService.resolveHolidaysForEmployee(
        ctx.companyId,
        emp.location_id,
        input.fromDate,
        input.toDate,
        client,
      );

      const fromSearch = DateTime.fromISO(input.fromDate).minus({ days: 7 }).toISODate()!;
      const toSearch = DateTime.fromISO(input.toDate).plus({ days: 7 }).toISODate()!;

      const existingDaysRes = await client.query<{
        leave_date: string;
        part: 'full' | 'first' | 'second' | 'hours';
        days: string;
        is_paid: boolean;
      }>(
        `SELECT leave_date, part, days, is_paid
         FROM leave_request_days
         WHERE company_id = $1
           AND employee_id = $2
           AND leave_date >= $3
           AND leave_date <= $4
           AND status IN ('pending', 'approved')`,
        [ctx.companyId, targetEmployeeId, fromSearch, toSearch],
      );

      const existingDays: ExistingLeaveDayInput[] = existingDaysRes.rows.map(r => ({
        date: r.leave_date,
        part: r.part,
        status: 'approved',
      }));

      // 5. Pure calculation
      const employeeInput: LeaveEmployeeInput = {
        id: emp.id,
        gender: emp.gender as 'male' | 'female' | 'other',
        doj: emp.doj,
        employmentType: emp.employment_type as 'full_time' | 'part_time' | 'contractor' | 'intern',
        locationId: emp.location_id ?? 'default-loc',
        departmentId: emp.department_id ?? 'default-dept',
        timezone: emp.timezone ?? 'Asia/Kolkata',
      };

      const policy = policyRes?.policy;
      const leaveTypePolicyInput: LeaveTypePolicyInput = {
        code: leaveType.code,
        name: leaveType.name,
        isPaid: leaveType.isPaid,
        unit: leaveType.unit,
        allowHalfDay: leaveType.allowHalfDay,
        allowHourly: leaveType.allowHourly,
        minNoticeDays: leaveType.minNoticeDays,
        maxConsecutiveDays: leaveType.maxConsecutiveDays,
        requiresDocumentAfterDays: leaveType.requiresDocumentAfterDays,
        sandwichRule: leaveType.sandwichRule,
        allowNegativeBalance: leaveType.allowNegativeBalance,
        negativeLimit: parseFloat(leaveType.negativeLimit),
        applicableTo: leaveType.applicableTo,
        maxBalance: policy?.maxBalance ? parseFloat(policy.maxBalance) : undefined,
        probationRule: policy?.probationRule,
      };

      const computeRes = computeLeaveDays({
        employee: employeeInput,
        leaveType: leaveTypePolicyInput,
        balance: {
          closing: closingBal,
          pending: pendingBal,
          available: availableBalance,
        },
        fromDate: input.fromDate,
        toDate: input.toDate,
        fromPart: input.fromPart ?? 'full',
        toPart: input.toPart ?? 'full',
        hours: input.hours,
        existingLeaves: existingDays,
        holidays: holidays.map(h => h.date),
      });

      if (computeRes.violations.length > 0) {
        throw new ValidationError(`Leave request invalid: ${computeRes.violations.join(', ')}`);
      }

      // Check balance limit
      if (computeRes.totalDays > availableBalance) {
        throw new ValidationError(
          `Insufficient leave balance. Available: ${availableBalance}, Required: ${computeRes.totalDays}`,
        );
      }

      // Check attachment mandatory rule
      if (
        leaveType.requiresDocumentAfterDays &&
        computeRes.totalDays >= leaveType.requiresDocumentAfterDays &&
        !input.documentFileId
      ) {
        throw new ValidationError(
          `A supporting document is mandatory for ${leaveType.name} exceeding ${leaveType.requiresDocumentAfterDays} days.`,
        );
      }

      // 6. Insert leave_requests
      const reqRes = await client.query<LeaveRequest>(
        `INSERT INTO leave_requests (
          id, company_id, employee_id, leave_type_id, from_date, to_date,
          from_part, to_part, hours, days, reason, document_file_id,
          status, policy_version, rule_version, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          'pending', $13, $14, now(), now()
        ) RETURNING *`,
        [
          requestId,
          ctx.companyId,
          targetEmployeeId,
          input.leaveTypeId,
          input.fromDate,
          input.toDate,
          input.fromPart ?? 'full',
          input.toPart ?? 'full',
          input.hours ?? null,
          computeRes.totalDays,
          input.reason.trim(),
          input.documentFileId ?? null,
          policyRes?.policy?.version ?? 1,
          LEAVE_RULE_VERSION,
        ],
      );

      const request = reqRes.rows[0]!;

      // 7. Insert leave_request_days (with non-overlapping timestamp ranges)
      for (const day of computeRes.days) {
        try {
          await client.query<LeaveRequestDay>(
            `INSERT INTO leave_request_days (
              id, company_id, request_id, employee_id, leave_date,
              period_start, period_end, part, days, status, is_paid,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, 'pending', $10,
              now(), now()
            )`,
            [
              generateUuidV7(),
              ctx.companyId,
              requestId,
              targetEmployeeId,
              day.date,
              day.periodStart,
              day.periodEnd,
              day.part,
              day.days,
              day.isPaid,
            ],
          );
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes('leave_request_days_no_overlap') || msg.includes('conflict') || msg.includes('duplicate')) {
            throw new ConflictError(`Leave dates overlap with another pending or approved request on ${day.date}.`);
          }
          throw err;
        }
      }

      // 8. Update balance pending count
      const newPending = pendingBal + computeRes.totalDays;
      await this.balanceRepo.updateBalance(
        ctx.companyId,
        balance.id,
        { pending: newPending },
        client,
      );

      // 9. Submit workflow request
      try {
        const wfRes = await this.workflowService.submitRequest(ctx, {
          definitionCode: 'leave',
          entityType: 'leave_requests',
          entityId: requestId,
          requesterId: targetEmployeeId,
          payload: {
            days: computeRes.totalDays,
            leaveTypeCode: leaveType.code,
            employeeId: targetEmployeeId,
            reason: input.reason,
          },
        }, pool);

        await client.query(
          `UPDATE leave_requests SET workflow_request_id = $1 WHERE company_id = $2 AND id = $3`,
          [wfRes.requestId, ctx.companyId, requestId],
        );
      } catch {
        // If workflow definition not yet configured, leave workflow_request_id null
      }

      // 10. Emit transactional outbox event
      await this.auditService.recordOutboxEvent(
        ctx,
        'leave_request',
        'leave.requested',
        {
          requestId,
          employeeId: targetEmployeeId,
          leaveTypeId: input.leaveTypeId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          days: computeRes.totalDays,
        },
        client,
      );

      await this.auditService.recordEvent(ctx, {
        action: 'leave.request.submit',
        entity: 'leave_requests',
        entityId: requestId,
        after: {
          fromDate: input.fromDate,
          toDate: input.toDate,
          days: computeRes.totalDays,
          leaveTypeId: input.leaveTypeId,
        },
      });

      return { request, breakdown: computeRes.days };
    }, pool);
  }

  /**
   * Action hook executed when leave request is approved.
   * Deducts pending, increments used, writes immutable usage ledger entry.
   */
  async onApproved(
    companyId: string,
    requestId: string,
    approverUserId: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    const pool = poolOverride ?? getAppPool();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Fetch request
      const reqRes = await client.query<LeaveRequest>(
        `SELECT * FROM leave_requests WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [companyId, requestId],
      );
      const req = reqRes.rows[0];
      if (!req || req.status !== 'pending') return;

      const payableDays = parseFloat(req.days);
      const periodKey = DateTime.fromISO(req.fromDate).toFormat('yyyy');

      // 2. Lock balance row
      const balance = await this.balanceRepo.lockBalanceForUpdate(
        companyId,
        req.employeeId,
        req.leaveTypeId,
        periodKey,
        client,
      );

      // 3. Mark request & request_days approved
      await client.query(
        `UPDATE leave_requests SET status = 'approved', updated_at = now() WHERE company_id = $1 AND id = $2`,
        [companyId, requestId],
      );
      await client.query(
        `UPDATE leave_request_days SET status = 'approved', updated_at = now() WHERE company_id = $1 AND request_id = $2`,
        [companyId, requestId],
      );

      // 4. Record usage in immutable ledger
      const dedupeKey = `usage:${requestId}`;
      await this.ledgerRepo.recordEntry(
        companyId,
        {
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId,
          periodKey,
          entryType: 'usage',
          deltaDays: -payableDays,
          effectiveDate: req.fromDate,
          refType: 'leave_requests',
          refId: requestId,
          reason: `Leave approved: ${req.reason}`,
          dedupeKey,
          createdBy: approverUserId,
        },
        client,
      );

      // 5. Update balance: decrement pending, increment used
      const currentPending = parseFloat(balance.pending);
      const currentUsed = parseFloat(balance.used);
      await this.balanceRepo.updateBalance(
        companyId,
        balance.id,
        {
          pending: Math.max(0, currentPending - payableDays),
          used: currentUsed + payableDays,
        },
        client,
      );

      // 6. Outbox events: leave.approved & attendance recomputation
      await client.query(
        `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
         VALUES ($1, $2, 'leave_request', 'leave.approved', $3)`,
        [
          generateUuidV7(),
          companyId,
          JSON.stringify({
            requestId,
            employeeId: req.employeeId,
            fromDate: req.fromDate,
            toDate: req.toDate,
            days: payableDays,
          }),
        ],
      );

      await client.query(
        `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
         VALUES ($1, $2, 'attendance_day', 'attendance.recompute_days', $3)`,
        [
          generateUuidV7(),
          companyId,
          JSON.stringify({
            employeeId: req.employeeId,
            startDate: req.fromDate,
            endDate: req.toDate,
            reason: 'leave_approved',
          }),
        ],
      );
    }, pool);
  }

  /**
   * Rejects a pending leave request.
   */
  async rejectRequest(
    ctx: RequestContext,
    requestId: string,
    reason: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    if (!can(ctx, PERMISSIONS.LEAVE_REQUEST_APPROVE)) {
      throw new ForbiddenError('Permission denied: leave.request.approve required.');
    }

    const pool = poolOverride ?? getAppPool();

    await withTenant(ctx, async (_tx, client) => {
      const reqRes = await client.query<LeaveRequest>(
        `SELECT * FROM leave_requests WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.companyId, requestId],
      );
      const req = reqRes.rows[0];
      if (!req) {
        throw new NotFoundError(`Leave request ${requestId} not found.`);
      }
      if (req.status !== 'pending') {
        throw new ValidationError(`Cannot reject request with status '${req.status}'.`);
      }

      const payableDays = parseFloat(req.days);
      const periodKey = DateTime.fromISO(req.fromDate).toFormat('yyyy');

      const balance = await this.balanceRepo.lockBalanceForUpdate(
        ctx.companyId,
        req.employeeId,
        req.leaveTypeId,
        periodKey,
        client,
      );

      await client.query(
        `UPDATE leave_requests SET status = 'rejected', updated_at = now() WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, requestId],
      );
      await client.query(
        `UPDATE leave_request_days SET status = 'rejected', updated_at = now() WHERE company_id = $1 AND request_id = $2`,
        [ctx.companyId, requestId],
      );

      const currentPending = parseFloat(balance.pending);
      await this.balanceRepo.updateBalance(
        ctx.companyId,
        balance.id,
        { pending: Math.max(0, currentPending - payableDays) },
        client,
      );

      await this.auditService.recordOutboxEvent(
        ctx,
        'leave_request',
        'leave.rejected',
        { requestId, employeeId: req.employeeId, reason },
        client,
      );
    }, pool);

    await this.auditService.recordEvent(ctx, {
      action: 'leave.request.reject',
      entity: 'leave_requests',
      entityId: requestId,
      after: { reason },
    });
  }

  /**
   * Withdraws a pending leave request (by requester).
   */
  async withdrawRequest(
    ctx: RequestContext,
    requestId: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    const pool = poolOverride ?? getAppPool();

    await withTenant(ctx, async (_tx, client) => {
      const reqRes = await client.query<LeaveRequest>(
        `SELECT * FROM leave_requests WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.companyId, requestId],
      );
      const req = reqRes.rows[0];
      if (!req) {
        throw new NotFoundError(`Leave request ${requestId} not found.`);
      }

      if (req.employeeId !== ctx.employeeId && !can(ctx, PERMISSIONS.LEAVE_REQUEST_CANCEL)) {
        throw new ForbiddenError('Only the requester or an authorized manager can withdraw this request.');
      }

      if (req.status !== 'pending') {
        throw new ValidationError(`Cannot withdraw request with status '${req.status}'. Use cancellation instead.`);
      }

      const payableDays = parseFloat(req.days);
      const periodKey = DateTime.fromISO(req.fromDate).toFormat('yyyy');

      const balance = await this.balanceRepo.lockBalanceForUpdate(
        ctx.companyId,
        req.employeeId,
        req.leaveTypeId,
        periodKey,
        client,
      );

      await client.query(
        `UPDATE leave_requests SET status = 'withdrawn', updated_at = now() WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, requestId],
      );
      await client.query(
        `UPDATE leave_request_days SET status = 'withdrawn', updated_at = now() WHERE company_id = $1 AND request_id = $2`,
        [ctx.companyId, requestId],
      );

      const currentPending = parseFloat(balance.pending);
      await this.balanceRepo.updateBalance(
        ctx.companyId,
        balance.id,
        { pending: Math.max(0, currentPending - payableDays) },
        client,
      );

      await this.auditService.recordOutboxEvent(
        ctx,
        'leave_request',
        'leave.withdrawn',
        { requestId, employeeId: req.employeeId },
        client,
      );
    }, pool);

    await this.auditService.recordEvent(ctx, {
      action: 'leave.request.withdraw',
      entity: 'leave_requests',
      entityId: requestId,
      after: { status: 'withdrawn' },
    });
  }

  /**
   * Cancels an approved leave request with reversal ledger entry.
   */
  async cancelRequest(
    ctx: RequestContext,
    requestId: string,
    reason: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('A cancellation reason is required.');
    }

    const pool = poolOverride ?? getAppPool();

    await withTenant(ctx, async (_tx, client) => {
      const reqRes = await client.query<LeaveRequest>(
        `SELECT * FROM leave_requests WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.companyId, requestId],
      );
      const req = reqRes.rows[0];
      if (!req) {
        throw new NotFoundError(`Leave request ${requestId} not found.`);
      }

      if (req.employeeId !== ctx.employeeId && !can(ctx, PERMISSIONS.LEAVE_REQUEST_CANCEL)) {
        throw new ForbiddenError('Permission denied: cannot cancel this leave request.');
      }

      if (req.status !== 'approved') {
        throw new ValidationError(`Only approved requests can be cancelled. Current status: '${req.status}'.`);
      }

      const payableDays = parseFloat(req.days);
      const periodKey = DateTime.fromISO(req.fromDate).toFormat('yyyy');

      // 1. Lock balance
      const balance = await this.balanceRepo.lockBalanceForUpdate(
        ctx.companyId,
        req.employeeId,
        req.leaveTypeId,
        periodKey,
        client,
      );

      // 2. Mark cancelled
      await client.query(
        `UPDATE leave_requests SET status = 'cancelled', updated_at = now() WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, requestId],
      );
      await client.query(
        `UPDATE leave_request_days SET status = 'cancelled', updated_at = now() WHERE company_id = $1 AND request_id = $2`,
        [ctx.companyId, requestId],
      );

      // 3. Record reversal ledger entry
      const dedupeKey = `reversal:${requestId}:${Date.now()}`;
      await this.ledgerRepo.recordEntry(
        ctx.companyId,
        {
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId,
          periodKey,
          entryType: 'reversal',
          deltaDays: payableDays,
          effectiveDate: DateTime.now().toISODate()!,
          refType: 'leave_requests',
          refId: requestId,
          reason: `Leave cancelled: ${reason}`,
          dedupeKey,
          createdBy: ctx.userId ?? '00000000-0000-0000-0000-000000000000',
        },
        client,
      );

      // 4. Update balance: used -= payableDays
      const currentUsed = parseFloat(balance.used);
      await this.balanceRepo.updateBalance(
        ctx.companyId,
        balance.id,
        { used: Math.max(0, currentUsed - payableDays) },
        client,
      );

      // 5. Outbox events: leave.cancelled & attendance recompute
      await this.auditService.recordOutboxEvent(
        ctx,
        'leave_request',
        'leave.cancelled',
        { requestId, employeeId: req.employeeId, reason },
        client,
      );

      await this.auditService.recordOutboxEvent(
        ctx,
        'attendance_day',
        'attendance.recompute_days',
        {
          employeeId: req.employeeId,
          startDate: req.fromDate,
          endDate: req.toDate,
          reason: 'leave_cancelled',
        },
        client,
      );
    }, pool);

    await this.auditService.recordEvent(ctx, {
      action: 'leave.request.cancel',
      entity: 'leave_requests',
      entityId: requestId,
      after: { reason, status: 'cancelled' },
    });
  }

  /**
   * Calendar query endpoint (PHASE3_SPEC Section 6).
   * Query budget <= 3, 60s cache invalidation, privacy rules applied.
   */
  async getCalendar(
    ctx: RequestContext,
    params: {
      scope: 'team' | 'department' | 'company';
      scopeId?: string | undefined;
      startDate: string; // 'YYYY-MM-DD'
      endDate: string;   // 'YYYY-MM-DD'
    },
    poolOverride?: pg.Pool,
  ): Promise<{
    leaves: LeaveCalendarDayItem[];
    holidays: Array<{ date: string; name: string; type: string }>;
  }> {
    if (!can(ctx, PERMISSIONS.LEAVE_CALENDAR_READ)) {
      throw new ForbiddenError('Permission denied: leave.calendar.read required.');
    }

    const pool = poolOverride ?? getAppPool();

    return withTenant(ctx, async (_tx, client) => {
      // 1. Fetch holidays across company/range
      const holRes = await client.query<{ date: string; name: string; type: string }>(
        `SELECT h.date, h.name, h.type
         FROM holidays h
         JOIN holiday_lists hl ON hl.company_id = h.company_id AND hl.id = h.list_id
         WHERE h.company_id = $1
           AND h.date >= $2
           AND h.date <= $3
           AND hl.is_default = true
         ORDER BY h.date ASC`,
        [ctx.companyId, params.startDate, params.endDate],
      );

      // 2. Fetch leaves filtered by scope
      const conditions: string[] = [
        'd.company_id = $1',
        'd.leave_date >= $2',
        'd.leave_date <= $3',
        "d.status IN ('pending', 'approved')",
      ];
      const values: unknown[] = [ctx.companyId, params.startDate, params.endDate];
      let pIdx = 4;

      if (params.scope === 'department' && params.scopeId) {
        conditions.push(`e.department_id = $${pIdx++}`);
        values.push(params.scopeId);
      } else if (params.scope === 'team' && ctx.employeeId) {
        // Same department as current employee
        conditions.push(
          `e.department_id = (SELECT department_id FROM employees WHERE company_id = $1 AND id = $${pIdx++})`,
        );
        values.push(ctx.employeeId);
      }

      const query = `
        SELECT
          d.leave_date as date,
          d.employee_id as "employeeId",
          d.part,
          d.days as "dayPortion",
          d.status,
          lt.code as "leaveTypeCode",
          lt.name as "leaveTypeName",
          e.first_name as "firstName",
          e.last_name as "lastName"
        FROM leave_request_days d
        JOIN employees e ON e.company_id = d.company_id AND e.id = d.employee_id
        JOIN leave_requests lr ON lr.company_id = d.company_id AND lr.id = d.request_id
        JOIN leave_types lt ON lt.company_id = d.company_id AND lt.id = lr.leave_type_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY d.leave_date ASC, e.first_name ASC
        LIMIT 500
      `;

      const leavesRes = await client.query<{
        date: string;
        employeeId: string;
        part: 'full' | 'first' | 'second' | 'hours';
        dayPortion: string;
        status: 'pending' | 'approved';
        leaveTypeCode: string;
        leaveTypeName: string;
        firstName: string;
        lastName: string;
      }>(query, values);

      const leaves: LeaveCalendarDayItem[] = leavesRes.rows.map(r => ({
        date: r.date,
        employeeId: r.employeeId,
        employeeName: `${r.firstName} ${r.lastName}`.trim(),
        leaveTypeCode: r.leaveTypeCode,
        leaveTypeName: r.leaveTypeName,
        dayPortion: parseFloat(r.dayPortion),
        part: r.part,
        status: r.status,
      }));

      return {
        leaves,
        holidays: holRes.rows,
      };
    }, pool);
  }

  /**
   * Retrieves leave balances for employee.
   */
  async getBalances(
    ctx: RequestContext,
    employeeId?: string,
    periodKey?: string,
    poolOverride?: pg.Pool,
  ) {
    const targetEmployeeId = employeeId ?? ctx.employeeId;
    if (!targetEmployeeId) {
      throw new ValidationError('Employee ID is required.');
    }

    if (employeeId && employeeId !== ctx.employeeId && !can(ctx, PERMISSIONS.LEAVE_BALANCE_READ)) {
      throw new ForbiddenError('Permission denied: cannot read balances for other employees.');
    }

    const pool = poolOverride ?? getAppPool();
    const period = periodKey ?? DateTime.now().toFormat('yyyy');

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<{
        id: string;
        leave_type_id: string;
        period_key: string;
        opening: string;
        accrued: string;
        used: string;
        adjusted: string;
        expired: string;
        encashed: string;
        pending: string;
        closing: string;
        code: string;
        name: string;
        color: string | null;
      }>(
        `SELECT
           b.*,
           lt.code,
           lt.name,
           lt.color
         FROM leave_balances b
         JOIN leave_types lt ON lt.company_id = b.company_id AND lt.id = b.leave_type_id
         WHERE b.company_id = $1
           AND b.employee_id = $2
           AND b.period_key = $3
         ORDER BY lt.code ASC`,
        [ctx.companyId, targetEmployeeId, period],
      );

      return res.rows.map(r => ({
        id: r.id,
        leaveTypeId: r.leave_type_id,
        code: r.code,
        name: r.name,
        color: r.color,
        periodKey: r.period_key,
        opening: parseFloat(r.opening),
        accrued: parseFloat(r.accrued),
        used: parseFloat(r.used),
        adjusted: parseFloat(r.adjusted),
        expired: parseFloat(r.expired),
        encashed: parseFloat(r.encashed),
        pending: parseFloat(r.pending),
        closing: parseFloat(r.closing),
        available: Math.max(0, parseFloat(r.closing) - parseFloat(r.pending)),
      }));
    }, pool);
  }

  /**
   * Retrieves requests for employee or tenant.
   */
  async listRequests(
    ctx: RequestContext,
    filters: {
      employeeId?: string | undefined;
      status?: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn' | undefined;
      limit?: number | undefined;
    },
    poolOverride?: pg.Pool,
  ) {
    if (!ctx.isAuthenticated) {
      throw new ForbiddenError('Authentication required.');
    }

    const pool = poolOverride ?? getAppPool();
    const targetEmployeeId = filters.employeeId ?? ctx.employeeId;

    return withTenant(ctx, async (_tx, client) => {
      const conditions: string[] = ['r.company_id = $1'];
      const values: unknown[] = [ctx.companyId];
      let pIdx = 2;

      if (targetEmployeeId) {
        conditions.push(`r.employee_id = $${pIdx++}`);
        values.push(targetEmployeeId);
      }
      if (filters.status) {
        conditions.push(`r.status = $${pIdx++}`);
        values.push(filters.status);
      }

      const limit = Math.min(filters.limit ?? 50, 100);

      const res = await client.query<{
        id: string;
        employee_id: string;
        leave_type_id: string;
        from_date: string;
        to_date: string;
        from_part: string;
        to_part: string;
        days: string;
        reason: string;
        status: string;
        workflow_request_id: string | null;
        created_at: string;
        code: string;
        name: string;
        first_name: string;
        last_name: string;
      }>(
        `SELECT
           r.*,
           lt.code,
           lt.name,
           e.first_name,
           e.last_name
         FROM leave_requests r
         JOIN leave_types lt ON lt.company_id = r.company_id AND lt.id = r.leave_type_id
         JOIN employees e ON e.company_id = r.company_id AND e.id = r.employee_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY r.created_at DESC
         LIMIT ${limit}`,
        values,
      );

      return res.rows.map(r => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: `${r.first_name} ${r.last_name}`.trim(),
        leaveTypeId: r.leave_type_id,
        leaveTypeCode: r.code,
        leaveTypeName: r.name,
        fromDate: r.from_date,
        toDate: r.to_date,
        fromPart: r.from_part,
        toPart: r.to_part,
        days: parseFloat(r.days),
        reason: r.reason,
        status: r.status,
        workflowRequestId: r.workflow_request_id,
        createdAt: r.created_at,
      }));
    }, pool);
  }
}
