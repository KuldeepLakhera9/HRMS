import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  generateUuidV7,
  withTenant,
} from '@hrms/db';
import {
  PERMISSIONS,
  ConflictError,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@hrms/shared';
import {
  SalaryService,
  SalaryRevisionService,
  LoanService,
  PayrollInputService,
  PayrollRunService,
} from '@hrms/core';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import {
  createPayrollTenant,
  ctxFor,
  asApp,
  settle,
  type PayrollTenant,
} from '../helpers/payroll-fixtures.js';

describe('Payroll Sprint 4.2 Integration Tests (P4-SAL-03, P4-SAL-04, P4-RUN-01, P4-RUN-02)', () => {
  let db: TestDatabaseContext;
  let tenantA: PayrollTenant;
  let tenantB: PayrollTenant;

  // Shared run and input IDs for cross-suite testing (e.g. IDOR)
  let run11Id: string;
  let pendingInputId: string;

  const salaryService = new SalaryService();
  const revisionService = new SalaryRevisionService();
  const loanService = new LoanService();
  const inputService = new PayrollInputService();
  const runService = new PayrollRunService();

  beforeAll(async () => {
    db = await setupTestDatabase();
    tenantA = await createPayrollTenant(db.ownerPool, 'Sprint 4.2 Alpha', 8);
    tenantB = await createPayrollTenant(db.ownerPool, 'Sprint 4.2 Beta', 2);
  });

  afterAll(async () => {
    await db.close();
  });

  // Helper context generators
  const makerCtxA = () =>
    ctxFor(tenantA.companyId, tenantA.users.maker, [
      PERMISSIONS.PAYROLL_SALARY_ASSIGN,
      PERMISSIONS.PAYROLL_SALARY_VIEW,
      PERMISSIONS.PAYROLL_INPUT_CREATE,
      PERMISSIONS.PAYROLL_INPUT_READ,
      PERMISSIONS.PAYROLL_RUN_CREATE,
      PERMISSIONS.PAYROLL_RUN_CALCULATE,
      PERMISSIONS.PAYROLL_RUN_READ,
      PERMISSIONS.PAYROLL_STRUCTURE_READ,
      PERMISSIONS.PAYROLL_RUN_LOCK,
      PERMISSIONS.PAYROLL_LOAN_MANAGE,
      PERMISSIONS.PAYROLL_LOAN_READ,
    ]);

  const checkerCtxA = (opts: { stepUp?: boolean } = { stepUp: true }) =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.checker,
      [
        PERMISSIONS.PAYROLL_SALARY_APPROVE,
        PERMISSIONS.PAYROLL_SALARY_VIEW,
        PERMISSIONS.PAYROLL_INPUT_APPROVE,
        PERMISSIONS.PAYROLL_INPUT_READ,
        PERMISSIONS.PAYROLL_RUN_REVIEW,
        PERMISSIONS.PAYROLL_RUN_APPROVE,
        PERMISSIONS.PAYROLL_RUN_LOCK,
        PERMISSIONS.PAYROLL_RUN_PUBLISH,
        PERMISSIONS.PAYROLL_RUN_READ,
        PERMISSIONS.PAYROLL_LOAN_MANAGE,
        PERMISSIONS.PAYROLL_LOAN_READ,
      ],
      opts,
    );

  const lockerCtxA = () =>
    ctxFor(tenantA.companyId, tenantA.users.locker, [
      PERMISSIONS.PAYROLL_RUN_LOCK,
      PERMISSIONS.PAYROLL_RUN_READ,
    ]);

  const unlockerCtxA = (opts: { stepUp?: boolean } = { stepUp: true }) =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.unlocker,
      [PERMISSIONS.PAYROLL_RUN_UNLOCK, PERMISSIONS.PAYROLL_RUN_READ],
      opts,
    );

  const makerCtxB = () =>
    ctxFor(tenantB.companyId, tenantB.users.maker, [
      PERMISSIONS.PAYROLL_SALARY_ASSIGN,
      PERMISSIONS.PAYROLL_SALARY_VIEW,
      PERMISSIONS.PAYROLL_INPUT_CREATE,
      PERMISSIONS.PAYROLL_INPUT_APPROVE,
      PERMISSIONS.PAYROLL_INPUT_READ,
      PERMISSIONS.PAYROLL_RUN_CREATE,
      PERMISSIONS.PAYROLL_RUN_READ,
    ]);

  // =========================================================================
  // 1. Overlap Suite (P4-SAL-03)
  // =========================================================================
  describe('1. Salary Overlap & Exclusion Constraints', () => {
    it('allows adjacent non-overlapping salary assignments', async () => {
      const empId = tenantA.employees[0]!;

      // Period 1: 2026-04-01 to 2026-06-30
      const asgn1 = await asApp(db.appPool, makerCtxA(), async tx =>
        salaryService.assignSalary(makerCtxA(), tx, {
          employeeId: empId,
          structureId: tenantA.structureId,
          structureVersion: 1,
          ctcAnnual: '600000.00',
          effectiveFrom: '2026-04-01',
          effectiveTo: '2026-06-30',
          reason: 'join',
        }),
      );

      const approved1 = await asApp(db.appPool, checkerCtxA(), async tx =>
        salaryService.approveSalaryAssignment(checkerCtxA(), tx, asgn1.id),
      );
      expect(approved1.status).toBe('approved');

      // Period 2: 2026-07-01 to null (adjacent, not overlapping)
      const asgn2 = await asApp(db.appPool, makerCtxA(), async tx =>
        salaryService.assignSalary(makerCtxA(), tx, {
          employeeId: empId,
          structureId: tenantA.structureId,
          structureVersion: 1,
          ctcAnnual: '720000.00',
          effectiveFrom: '2026-07-01',
          reason: 'revision',
        }),
      );

      const approved2 = await asApp(db.appPool, checkerCtxA(), async tx =>
        salaryService.approveSalaryAssignment(checkerCtxA(), tx, asgn2.id),
      );
      expect(approved2.status).toBe('approved');
    });

    it('rejects approval of overlapping salary assignment with ConflictError', async () => {
      const empId = tenantA.employees[0]!;

      // Overlaps existing approved 2026-07-01..open assignment
      const asgnOverlap = await asApp(db.appPool, makerCtxA(), async tx =>
        salaryService.assignSalary(makerCtxA(), tx, {
          employeeId: empId,
          structureId: tenantA.structureId,
          structureVersion: 1,
          ctcAnnual: '800000.00',
          effectiveFrom: '2026-08-01',
          effectiveTo: '2026-10-31',
          reason: 'revision',
        }),
      );

      await expect(
        asApp(db.appPool, checkerCtxA(), async tx =>
          salaryService.approveSalaryAssignment(checkerCtxA(), tx, asgnOverlap.id),
        ),
      ).rejects.toThrow(ConflictError);
    });

    it('does not conflict with soft-deleted approved assignments', async () => {
      const empId = tenantA.employees[1]!;

      const asgn = await asApp(db.appPool, makerCtxA(), async tx =>
        salaryService.assignSalary(makerCtxA(), tx, {
          employeeId: empId,
          structureId: tenantA.structureId,
          structureVersion: 1,
          ctcAnnual: '500000.00',
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31',
          reason: 'join',
        }),
      );
      await asApp(db.appPool, checkerCtxA(), async tx =>
        salaryService.approveSalaryAssignment(checkerCtxA(), tx, asgn.id),
      );

      // Soft delete the approved assignment
      await asApp(db.appPool, checkerCtxA(), async (tx, client) => {
        await client.query(
          `UPDATE employee_salary SET deleted_at = NOW() WHERE id = $1 AND company_id = $2`,
          [asgn.id, tenantA.companyId],
        );
      });

      // Now create and approve an overlapping assignment for the same period
      const asgnNew = await asApp(db.appPool, makerCtxA(), async tx =>
        salaryService.assignSalary(makerCtxA(), tx, {
          employeeId: empId,
          structureId: tenantA.structureId,
          structureVersion: 1,
          ctcAnnual: '550000.00',
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31',
          reason: 'revision',
        }),
      );

      const approvedNew = await asApp(db.appPool, checkerCtxA(), async tx =>
        salaryService.approveSalaryAssignment(checkerCtxA(), tx, asgnNew.id),
      );
      expect(approvedNew.status).toBe('approved');
    });

    it('handles concurrent approvals of overlapping draft assignments (race: exactly 1 succeeds)', async () => {
      const empId = tenantA.employees[2]!;

      const [d1, d2] = await Promise.all([
        asApp(db.appPool, makerCtxA(), async tx =>
          salaryService.assignSalary(makerCtxA(), tx, {
            employeeId: empId,
            structureId: tenantA.structureId,
            structureVersion: 1,
            ctcAnnual: '600000.00',
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30',
            reason: 'join',
          }),
        ),
        asApp(db.appPool, makerCtxA(), async tx =>
          salaryService.assignSalary(makerCtxA(), tx, {
            employeeId: empId,
            structureId: tenantA.structureId,
            structureVersion: 1,
            ctcAnnual: '650000.00',
            effectiveFrom: '2026-03-01',
            effectiveTo: '2026-09-30',
            reason: 'revision',
          }),
        ),
      ]);

      const outcomes = await settle([
        asApp(db.appPool, checkerCtxA(), async tx =>
          salaryService.approveSalaryAssignment(checkerCtxA(), tx, d1.id),
        ),
        asApp(db.appPool, checkerCtxA(), async tx =>
          salaryService.approveSalaryAssignment(checkerCtxA(), tx, d2.id),
        ),
      ]);

      expect(outcomes.fulfilled.length).toBe(1);
      expect(outcomes.rejected.length).toBe(1);
      expect(outcomes.rejected[0]).toBeInstanceOf(ConflictError);
    });
  });

  // =========================================================================
  // 2. Arrears Suite (P4-SAL-03 / P4-SAL-04)
  // =========================================================================
  describe('2. Bulk Revision & Arrears Generation', () => {
    let revisionBatchDbId: string;

    it('calculates and generates arrears as idempotent payroll inputs on backdated revision', async () => {
      const empId = tenantA.employees[3]!;

      // 1. Establish initial active salary: 600,000 from 2026-04-01
      const initialAsgn = await asApp(db.appPool, makerCtxA(), async tx =>
        salaryService.assignSalary(makerCtxA(), tx, {
          employeeId: empId,
          structureId: tenantA.structureId,
          structureVersion: 1,
          ctcAnnual: '600000.00',
          effectiveFrom: '2026-04-01',
          reason: 'join',
        }),
      );
      await asApp(db.appPool, checkerCtxA(), async tx =>
        salaryService.approveSalaryAssignment(checkerCtxA(), tx, initialAsgn.id),
      );

      // 2. Maker creates revision batch for 720,000 effective 2026-07-01
      const batch = await asApp(db.appPool, makerCtxA(), async tx =>
        revisionService.createRevisionBatch(makerCtxA(), tx, {
          batchId: 'BATCH-2026-Q3-TEST',
          effectiveFrom: '2026-07-01',
          items: [{ employeeId: empId, newCtcAnnual: '720000.00' }],
        }),
      );
      revisionBatchDbId = batch.id;

      // 3. Checker approves with currentPeriod = 2026-10 -> 3 arrears months: 2026-07, 2026-08, 2026-09
      const result = await asApp(db.appPool, checkerCtxA(), async tx =>
        revisionService.approveRevisionBatch(checkerCtxA(), tx, batch.id, '2026-10'),
      );

      expect(result.batch.status).toBe('applied');
      expect(result.arrearsGenerated).toBe(3);

      // 4. Verify payroll_inputs in DB
      await asApp(db.appPool, makerCtxA(), async (tx, client) => {
        const res = await client.query<{
          amount: string;
          for_period: string;
          type: string;
          component_code: string;
          source_type: string;
        }>(
          `SELECT amount, for_period, type, component_code, source_type
           FROM payroll_inputs
           WHERE company_id = $1 AND employee_id = $2 AND type = 'arrear'
           ORDER BY source_id ASC`,
          [tenantA.companyId, empId],
        );
        expect(res.rows.length).toBe(3);
        const total = res.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
        expect(total).toBeCloseTo(30000.0, 2);
        for (const row of res.rows) {
          expect(row.for_period).toBe('2026-10');
          expect(row.source_type).toBe('salary_revision');
          expect(row.component_code).toBe('ARREAR');
        }
      });
    });

    it('rejects re-approval of already applied batch with ValidationError', async () => {
      await expect(
        asApp(db.appPool, checkerCtxA(), async tx =>
          revisionService.approveRevisionBatch(checkerCtxA(), tx, revisionBatchDbId, '2026-10'),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('enforces idempotency on duplicate arrears inputs at DB constraint level', async () => {
      const empId = tenantA.employees[3]!;
      // Direct insertion with an existing source_id raises unique constraint violation
      await expect(
        asApp(db.appPool, makerCtxA(), async (tx, client) => {
          await client.query(
            `INSERT INTO payroll_inputs (id, company_id, employee_id, type, component_code, amount, taxable, for_period, source_type, source_id, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'arrear', 'ARREAR', '10000.00', true, '2026-10', 'salary_revision', $4, 'approved', $5, $5)`,
            [
              generateUuidV7(),
              tenantA.companyId,
              empId,
              `BATCH-2026-Q3-TEST:${empId}:2026-07`,
              tenantA.users.maker,
            ],
          );
        }),
      ).rejects.toThrow(/duplicate key value|uq_payroll_inputs_source/);
    });
  });

  // =========================================================================
  // 3. Loans Suite (P4-SAL-04 / P4-RUN-01)
  // =========================================================================
  describe('3. Loans, Installments & EMI Recovery', () => {
    let loanPeriodId: string;
    let loanRunId: string;

    it('creates loan with schedule and generates EMI inputs idempotently', async () => {
      const empId = tenantA.employees[4]!;

      // 1. Create loan of 9000 over 3 months starting 2026-10
      const { loan: createdLoan, installments } = await asApp(db.appPool, makerCtxA(), async tx =>
        loanService.createLoan(makerCtxA(), tx, {
          employeeId: empId,
          principal: '9000.00',
          installmentsCount: 3,
          startPeriod: '2026-10',
          interestType: 'none',
        }),
      );

      expect(createdLoan.status).toBe('active');
      expect(createdLoan.principal).toBe('9000.00');
      expect(installments.length).toBe(3);

      // 2. Generate EMI inputs for 2026-10 -> 1 input generated
      const gen1 = await asApp(db.appPool, makerCtxA(), async tx =>
        loanService.generateEmiInputsForPeriod(makerCtxA(), tx, '2026-10'),
      );
      expect(gen1.inputsGenerated).toBe(1);

      // 3. Run generate again for 2026-10 -> 0 new inputs (idempotent)
      const gen2 = await asApp(db.appPool, makerCtxA(), async tx =>
        loanService.generateEmiInputsForPeriod(makerCtxA(), tx, '2026-10'),
      );
      expect(gen2.inputsGenerated).toBe(0);
    });

    it('handles concurrent EMI input generation safely (race: exactly 1 created)', async () => {
      // 3 concurrent generations for 2026-11
      const results = await Promise.all([
        asApp(db.appPool, makerCtxA(), async tx =>
          loanService.generateEmiInputsForPeriod(makerCtxA(), tx, '2026-11'),
        ),
        asApp(db.appPool, makerCtxA(), async tx =>
          loanService.generateEmiInputsForPeriod(makerCtxA(), tx, '2026-11'),
        ),
        asApp(db.appPool, makerCtxA(), async tx =>
          loanService.generateEmiInputsForPeriod(makerCtxA(), tx, '2026-11'),
        ),
      ]);

      const totalCreated = results.reduce((sum, r) => sum + r.inputsGenerated, 0);
      expect(totalCreated).toBe(1);
    });

    it('recovers installments and consumes inputs for a run idempotently under concurrency', async () => {
      // Create period and run for 2026-10
      const period = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.createPeriod(makerCtxA(), tx, {
          legalEntityId: tenantA.legalEntityId,
          period: '2026-10',
          fy: '2026-2027',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          cutoffDate: '2026-10-25',
          payDate: '2026-10-31',
        }),
      );
      loanPeriodId = period.id;

      const run = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.createRun(makerCtxA(), tx, { periodId: loanPeriodId }),
      );
      loanRunId = run.id;

      // Concurrently run recoverInstallmentsForRun 2 times
      const recoveryOutcomes = await Promise.all([
        asApp(db.appPool, lockerCtxA(), async tx =>
          loanService.recoverInstallmentsForRun(lockerCtxA(), tx, loanRunId, '2026-10'),
        ),
        asApp(db.appPool, lockerCtxA(), async tx =>
          loanService.recoverInstallmentsForRun(lockerCtxA(), tx, loanRunId, '2026-10'),
        ),
      ]);

      const totalRecovered = recoveryOutcomes.reduce((sum, r) => sum + r.installmentsRecovered, 0);
      expect(totalRecovered).toBe(1);

      // Verify the installment is marked 'recovered' with recovered_run_id
      await asApp(db.appPool, makerCtxA(), async (tx, client) => {
        const inst = await client.query<{ status: string; recovered_run_id: string }>(
          `SELECT status, recovered_run_id FROM loan_installments
           WHERE company_id = $1 AND due_period = '2026-10'`,
          [tenantA.companyId],
        );
        expect(inst.rows[0]?.status).toBe('recovered');
        expect(inst.rows[0]?.recovered_run_id).toBe(loanRunId);

        // And payroll input is marked 'consumed' with consumed_run_id
        const inp = await client.query<{ status: string; consumed_run_id: string }>(
          `SELECT status, consumed_run_id FROM payroll_inputs
           WHERE company_id = $1 AND for_period = '2026-10' AND type = 'loan_emi'`,
          [tenantA.companyId],
        );
        expect(inp.rows[0]?.status).toBe('consumed');
        expect(inp.rows[0]?.consumed_run_id).toBe(loanRunId);
      });
    });
  });

  // =========================================================================
  // 4. State Machine Suite (P4-RUN-01 / P4-RUN-02)
  // =========================================================================
  describe('4. Payroll Run State Machine & Precondition Guards', () => {
    let period11Id: string;

    it('enforces attendance lock precondition before moving draft -> inputs_ready', async () => {
      const period = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.createPeriod(makerCtxA(), tx, {
          legalEntityId: tenantA.legalEntityId,
          period: '2026-11',
          fy: '2026-2027',
          startDate: '2026-11-01',
          endDate: '2026-11-30',
          cutoffDate: '2026-11-25',
          payDate: '2026-11-30',
        }),
      );
      period11Id = period.id;

      const run = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.createRun(makerCtxA(), tx, { periodId: period11Id }),
      );
      run11Id = run.id;

      // Without attendance lock in DB -> transition must fail
      await expect(
        asApp(db.appPool, makerCtxA(), async tx =>
          runService.transitionRun(makerCtxA(), tx, run11Id, 'inputs_ready'),
        ),
      ).rejects.toThrow(/attendance period is not locked/i);
    });

    it('enforces pending input precondition before moving draft -> inputs_ready', async () => {
      // 1. Insert attendance lock for 2026-11-01 to 2026-11-30
      await db.ownerPool.query(
        `INSERT INTO attendance_period_locks (id, company_id, period_start, period_end, is_locked, locked_by, reason, created_by, updated_by)
         VALUES ($1, $2, '2026-11-01', '2026-11-30', true, $3, 'Test lock for Nov 2026', $3, $3)`,
        [generateUuidV7(), tenantA.companyId, tenantA.users.checker],
      );

      // 2. Create a pending input for 2026-11
      const input = await asApp(db.appPool, makerCtxA(), async tx =>
        inputService.createInput(makerCtxA(), tx, {
          employeeId: tenantA.employees[5]!,
          type: 'bonus',
          amount: '5000.00',
          forPeriod: '2026-11',
          note: 'Performance bonus pending approval',
        }),
      );
      pendingInputId = input.id;
      expect(input.status).toBe('pending');

      // 3. Attempting transition to inputs_ready must fail because of pending input
      await expect(
        asApp(db.appPool, makerCtxA(), async tx =>
          runService.transitionRun(makerCtxA(), tx, run11Id, 'inputs_ready'),
        ),
      ).rejects.toThrow(/pending approval/i);

      // 4. Approve the pending input
      await asApp(db.appPool, checkerCtxA(), async tx =>
        inputService.approveInput(checkerCtxA(), tx, pendingInputId),
      );

      // 5. Now transition to inputs_ready must succeed!
      const updated = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.transitionRun(makerCtxA(), tx, run11Id, 'inputs_ready'),
      );
      expect(updated.status).toBe('inputs_ready');
    });

    it('rejects forbidden state machine edges', async () => {
      // inputs_ready cannot jump straight to approved or published
      await expect(
        asApp(db.appPool, checkerCtxA(), async tx =>
          runService.transitionRun(checkerCtxA(), tx, run11Id, 'published'),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('enforces Step-Up and Segregation of Duties on approve and lock', async () => {
      // Move inputs_ready -> calculating -> calculated -> review
      await asApp(db.appPool, makerCtxA(), async tx =>
        runService.transitionRun(makerCtxA(), tx, run11Id, 'calculating'),
      );
      await asApp(db.appPool, makerCtxA(), async tx =>
        runService.transitionRun(makerCtxA(), tx, run11Id, 'calculated'),
      );
      await asApp(db.appPool, makerCtxA(), async tx =>
        runService.transitionRun(makerCtxA(), tx, run11Id, 'review'),
      );

      // 1. Try to approve without step-up -> UnauthorizedError
      await expect(
        asApp(db.appPool, checkerCtxA({ stepUp: false }), async tx =>
          runService.transitionRun(checkerCtxA({ stepUp: false }), tx, run11Id, 'approved'),
        ),
      ).rejects.toThrow(UnauthorizedError);

      // 2. Try to approve as Maker (creator of run) with step-up -> ForbiddenError (SoD)
      const makerWithStepUp = ctxFor(
        tenantA.companyId,
        tenantA.users.maker,
        [PERMISSIONS.PAYROLL_RUN_APPROVE],
        { stepUp: true },
      );
      await expect(
        asApp(db.appPool, makerWithStepUp, async tx =>
          runService.transitionRun(makerWithStepUp, tx, run11Id, 'approved'),
        ),
      ).rejects.toThrow(ForbiddenError);

      // 3. Checker approves with step-up -> succeeds
      const approvedRun = await asApp(db.appPool, checkerCtxA({ stepUp: true }), async tx =>
        runService.transitionRun(checkerCtxA({ stepUp: true }), tx, run11Id, 'approved'),
      );
      expect(approvedRun.status).toBe('approved');
      expect(approvedRun.approvedBy).toBe(tenantA.users.checker);

      // 4. Maker cannot lock (SoD: Creator cannot lock)
      await expect(
        asApp(db.appPool, makerCtxA(), async tx =>
          runService.transitionRun(makerCtxA(), tx, run11Id, 'locking'),
        ),
      ).rejects.toThrow(ForbiddenError);

      // 5. Checker cannot lock (SoD: Approver cannot lock)
      await expect(
        asApp(db.appPool, checkerCtxA(), async tx =>
          runService.transitionRun(checkerCtxA(), tx, run11Id, 'locking'),
        ),
      ).rejects.toThrow(ForbiddenError);

      // 6. Distinct Locker moves approved -> locking -> locked
      await asApp(db.appPool, lockerCtxA(), async tx =>
        runService.transitionRun(lockerCtxA(), tx, run11Id, 'locking'),
      );
      const lockedRun = await asApp(db.appPool, lockerCtxA(), async tx =>
        runService.transitionRun(lockerCtxA(), tx, run11Id, 'locked'),
      );
      expect(lockedRun.status).toBe('locked');
      expect(lockedRun.lockedBy).toBe(tenantA.users.locker);
      expect(lockedRun.runHash).toBeTruthy();
    });

    it('enforces multi-approver guard and justification for unlocking a locked run', async () => {
      // 1. Unlock without justification -> ValidationError
      await expect(
        asApp(db.appPool, unlockerCtxA(), async tx =>
          runService.transitionRun(unlockerCtxA(), tx, run11Id, 'review', {
            secondApproverId: tenantA.users.secondApprover,
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // 2. Unlock with same user as second approver -> ValidationError
      await expect(
        asApp(db.appPool, unlockerCtxA(), async tx =>
          runService.transitionRun(unlockerCtxA(), tx, run11Id, 'review', {
            reason: 'Correction needed',
            secondApproverId: tenantA.users.unlocker,
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // 3. Unlock with second approver lacking PAYROLL_RUN_UNLOCK permission -> ValidationError
      await expect(
        asApp(db.appPool, unlockerCtxA(), async tx =>
          runService.transitionRun(unlockerCtxA(), tx, run11Id, 'review', {
            reason: 'Correction needed',
            secondApproverId: tenantA.users.noUnlockPerm,
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // 4. Valid unlock with second approver who has the role & permission -> succeeds!
      const unlockedRun = await asApp(db.appPool, unlockerCtxA(), async tx =>
        runService.transitionRun(unlockerCtxA(), tx, run11Id, 'review', {
          reason: 'Authorized unlock for manual adjustment',
          secondApproverId: tenantA.users.secondApprover,
        }),
      );
      expect(unlockedRun.status).toBe('review');
    });

    it('preserves immutable audit log in payroll_run_events and rejects modifications', async () => {
      // List events: draft->inputs_ready, inputs_ready->calculating, calculating->calculated,
      // calculated->review, review->approved, approved->locking, locking->locked, locked->review (8 events)
      const events = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.listRunEvents(makerCtxA(), tx, run11Id),
      );
      expect(events.length).toBeGreaterThanOrEqual(7);

      // Attempt UPDATE as hrms_app -> rejected by SQL permissions (REVOKE UPDATE)
      await expect(
        asApp(db.appPool, makerCtxA(), async (tx, client) => {
          await client.query(
            `UPDATE payroll_run_events SET event = 'tampered' WHERE run_id = $1`,
            [run11Id],
          );
        }),
      ).rejects.toThrow(/permission denied for table payroll_run_events/);

      // Attempt UPDATE as hrms_owner -> rejected by immutable trigger
      await expect(
        withTenant(
          { companyId: tenantA.companyId },
          async (_tx, client) => {
            await client.query(
              `UPDATE payroll_run_events SET event = 'tampered' WHERE run_id = $1`,
              [run11Id],
            );
          },
          db.ownerPool,
        ),
      ).rejects.toThrow(/append-only|immutable/i);
    });

    it('handles concurrent state transitions safely via row locks (race: exactly 1 succeeds)', async () => {
      // Create fresh period and run for concurrency test
      const period = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.createPeriod(makerCtxA(), tx, {
          legalEntityId: tenantA.legalEntityId,
          period: '2026-12',
          fy: '2026-2027',
          startDate: '2026-12-01',
          endDate: '2026-12-31',
          cutoffDate: '2026-12-25',
          payDate: '2026-12-31',
        }),
      );

      const run = await asApp(db.appPool, makerCtxA(), async tx =>
        runService.createRun(makerCtxA(), tx, { periodId: period.id }),
      );

      // Insert lock for Dec 2026 so inputs_ready is eligible
      await db.ownerPool.query(
        `INSERT INTO attendance_period_locks (id, company_id, period_start, period_end, is_locked, locked_by, reason, created_by, updated_by)
         VALUES ($1, $2, '2026-12-01', '2026-12-31', true, $3, 'Dec 2026 lock', $3, $3)`,
        [generateUuidV7(), tenantA.companyId, tenantA.users.checker],
      );

      // Concurrently race two transitions to inputs_ready:
      // The row lock (FOR UPDATE) serializes them. The first moves draft -> inputs_ready.
      // The second sees current status is inputs_ready, from which inputs_ready is forbidden -> ValidationError!
      const outcomes = await settle([
        asApp(db.appPool, makerCtxA(), async tx =>
          runService.transitionRun(makerCtxA(), tx, run.id, 'inputs_ready'),
        ),
        asApp(db.appPool, makerCtxA(), async tx =>
          runService.transitionRun(makerCtxA(), tx, run.id, 'inputs_ready'),
        ),
      ]);

      expect(outcomes.fulfilled.length).toBe(1);
      expect(outcomes.rejected.length).toBe(1);
      expect(outcomes.rejected[0]).toBeInstanceOf(ValidationError);
    });
  });

  // =========================================================================
  // 5. Tenant Isolation, RLS & IDOR Protection
  // =========================================================================
  describe('5. Multi-Tenant Isolation & Row-Level Security', () => {
    it('ensures Tenant B sees 0 rows of Tenant A across Phase 4 tables', async () => {
      await asApp(db.appPool, makerCtxB(), async (tx, client) => {
        const [salaries, inputs, installments, runs, events] = await Promise.all([
          client.query(`SELECT count(*)::int as c FROM employee_salary WHERE company_id = $1`, [tenantA.companyId]),
          client.query(`SELECT count(*)::int as c FROM payroll_inputs WHERE company_id = $1`, [tenantA.companyId]),
          client.query(`SELECT count(*)::int as c FROM loan_installments WHERE company_id = $1`, [tenantA.companyId]),
          client.query(`SELECT count(*)::int as c FROM payroll_runs WHERE company_id = $1`, [tenantA.companyId]),
          client.query(`SELECT count(*)::int as c FROM payroll_run_events WHERE company_id = $1`, [tenantA.companyId]),
        ]);

        expect(salaries.rows[0]?.c).toBe(0);
        expect(inputs.rows[0]?.c).toBe(0);
        expect(installments.rows[0]?.c).toBe(0);
        expect(runs.rows[0]?.c).toBe(0);
        expect(events.rows[0]?.c).toBe(0);
      });
    });

    it('rejects cross-tenant insert with RLS policy check violation', async () => {
      await expect(
        asApp(db.appPool, makerCtxB(), async (tx, client) => {
          await client.query(
            `INSERT INTO payroll_inputs (id, company_id, employee_id, type, amount, for_period, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'bonus', '500.00', '2026-10', 'pending', $4, $4)`,
            [generateUuidV7(), tenantA.companyId, tenantB.employees[0]!, tenantB.users.maker],
          );
        }),
      ).rejects.toThrow(/row-level security/i);
    });

    it('rejects cross-tenant references via composite foreign keys', async () => {
      // Tenant B tries to assign salary to Tenant A's employee
      await expect(
        asApp(db.appPool, makerCtxB(), async tx =>
          salaryService.assignSalary(makerCtxB(), tx, {
            employeeId: tenantA.employees[0]!, // Foreign tenant employee!
            structureId: tenantB.structureId,
            structureVersion: 1,
            ctcAnnual: '400000.00',
            effectiveFrom: '2026-01-01',
            reason: 'join',
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('returns NotFound when accessing Tenant A resources with Tenant B credentials (IDOR)', async () => {
      // Tenant B tries to list/get Tenant A's run
      await expect(
        asApp(db.appPool, makerCtxB(), async tx =>
          runService.getRun(makerCtxB(), tx, run11Id),
        ),
      ).rejects.toThrow(NotFoundError);

      // Tenant B tries to approve Tenant A's input
      await expect(
        asApp(db.appPool, makerCtxB(), async tx =>
          inputService.approveInput(makerCtxB(), tx, pendingInputId),
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // =========================================================================
  // 6. Salary View Auditing & Default Masking
  // =========================================================================
  describe('6. Salary View Auditing & Default Masking', () => {
    it('enforces step-up authentication, masks CTC by default, and logs audit access', async () => {
      const empId = tenantA.employees[0]!;

      // 1. Without step-up -> UnauthorizedError
      await expect(
        asApp(db.appPool, checkerCtxA({ stepUp: false }), async tx =>
          salaryService.getEmployeeSalary(checkerCtxA({ stepUp: false }), tx, empId, '2026-08-01'),
        ),
      ).rejects.toThrow(UnauthorizedError);

      // 2. With step-up, default unmask: false -> masked CTC (e.g. contains *)
      const maskedSalary = await asApp(db.appPool, checkerCtxA({ stepUp: true }), async tx =>
        salaryService.getEmployeeSalary(checkerCtxA({ stepUp: true }), tx, empId, '2026-08-01'),
      );
      expect(maskedSalary).not.toBeNull();
      expect(maskedSalary?.ctcAnnual).toMatch(/[•*]/);

      // 3. With step-up, unmask: true -> real unmasked CTC
      const unmaskedSalary = await asApp(db.appPool, checkerCtxA({ stepUp: true }), async tx =>
        salaryService.getEmployeeSalary(checkerCtxA({ stepUp: true }), tx, empId, '2026-08-01', { unmask: true }),
      );
      expect(unmaskedSalary).not.toBeNull();
      expect(unmaskedSalary?.ctcAnnual).toBe('720000.00');

      // 4. Verify audit_logs table contains 'payroll.salary.view' entry
      await asApp(db.appPool, checkerCtxA(), async (tx, client) => {
        const auditRes = await client.query<{ action: string; entity: string }>(
          `SELECT action, entity FROM audit_logs
           WHERE company_id = $1 AND action = 'payroll.salary.view'
           ORDER BY ts DESC LIMIT 1`,
          [tenantA.companyId],
        );
        expect(auditRes.rows.length).toBe(1);
        expect(auditRes.rows[0]?.action).toBe('payroll.salary.view');
        expect(auditRes.rows[0]?.entity).toBe('employee_salary');
      });
    });
  });

  // =========================================================================
  // 7. Query Budgets
  // =========================================================================
  describe('7. Query Budgets', () => {
    function trackQueries(client: pg.PoolClient) {
      let count = 0;
      const originalQuery = client.query.bind(client);
      const targetClient = client as unknown as Record<string, unknown>;
      targetClient.query = async function (this: unknown, ...args: unknown[]) {
        count++;
        return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
      };
      return {
        count: () => count,
        reset: () => {
          count = 0;
        },
      };
    }

    it('asserts query budgets for critical payroll operations', async () => {
      const empId = tenantA.employees[6]!;

      // 1. createInput budget <= 1
      let createdInputId = '';
      await asApp(db.appPool, makerCtxA(), async (tx, client) => {
        const tracker = trackQueries(client);
        tracker.reset();
        const inp = await inputService.createInput(makerCtxA(), tx, {
          employeeId: empId,
          type: 'incentive',
          amount: '1200.00',
          forPeriod: '2026-10',
        });
        createdInputId = inp.id;
        expect(tracker.count()).toBeLessThanOrEqual(1);
      });

      // 2. approveInput budget <= 2 (1 lock select + 1 update)
      await asApp(db.appPool, checkerCtxA(), async (tx, client) => {
        const tracker = trackQueries(client);
        tracker.reset();
        await inputService.approveInput(checkerCtxA(), tx, createdInputId);
        expect(tracker.count()).toBeLessThanOrEqual(2);
      });

      // 3. listInputs budget <= 1
      await asApp(db.appPool, makerCtxA(), async (tx, client) => {
        const tracker = trackQueries(client);
        tracker.reset();
        await inputService.listInputs(makerCtxA(), tx, { forPeriod: '2026-10', limit: 20 });
        expect(tracker.count()).toBeLessThanOrEqual(1);
      });

      // 4. generateEmiInputsForPeriod budget <= 2 (1 select installments + 1 bulk insert)
      await asApp(db.appPool, makerCtxA(), async (tx, client) => {
        const tracker = trackQueries(client);
        tracker.reset();
        await loanService.generateEmiInputsForPeriod(makerCtxA(), tx, '2026-12');
        expect(tracker.count()).toBeLessThanOrEqual(2);
      });

      // 5. getEmployeeSalary budget <= 1 inside transaction (+ audit write)
      await asApp(db.appPool, checkerCtxA({ stepUp: true }), async (tx, client) => {
        const tracker = trackQueries(client);
        tracker.reset();
        await salaryService.getEmployeeSalary(checkerCtxA({ stepUp: true }), tx, empId, '2026-10-01');
        expect(tracker.count()).toBeLessThanOrEqual(1);
      });
    });
  });

  // =========================================================================
  // 8. Database Query Plans (EXPLAIN Index Verification)
  // =========================================================================
  describe('8. Query Plans & Index Usage', () => {
    it('verifies that critical payroll query paths use index scans with seqscan disabled', async () => {
      await asApp(db.appPool, makerCtxA(), async (tx, client) => {
        // Disable sequential scan for the transaction to ensure index viability
        await client.query('SET LOCAL enable_seqscan = off');

        // Path 1: payroll_inputs by status & for_period
        const explainInputs = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT * FROM payroll_inputs
           WHERE company_id = $1 AND status = 'pending' AND for_period = '2026-11' AND deleted_at IS NULL`,
          [tenantA.companyId],
        );
        const planInputs = explainInputs.rows.map(r => r['QUERY PLAN']).join('\n');
        expect(planInputs).toMatch(/Index.*Scan/i);

        // Path 2: loan_installments by due_period
        const explainLoans = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT * FROM loan_installments
           WHERE company_id = $1 AND due_period = '2026-10' AND status = 'due'`,
          [tenantA.companyId],
        );
        const planLoans = explainLoans.rows.map(r => r['QUERY PLAN']).join('\n');
        expect(planLoans).toMatch(/Index.*Scan/i);

        // Path 3: payroll_runs by period_id
        const explainRuns = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT * FROM payroll_runs
           WHERE company_id = $1 AND period_id = $2`,
          [tenantA.companyId, generateUuidV7()],
        );
        const planRuns = explainRuns.rows.map(r => r['QUERY PLAN']).join('\n');
        expect(planRuns).toMatch(/Index.*Scan/i);
      });
    });
  });
});
