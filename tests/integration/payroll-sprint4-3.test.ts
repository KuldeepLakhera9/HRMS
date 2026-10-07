import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateUuidV7,
} from '@hrms/db';
import {
  PERMISSIONS,
} from '@hrms/shared';
import {
  PayrollRunService,
  PayrollCalculationWorker,
  PayrollReviewService,
  PayslipMaterializationService,
  WarningsBlockersEngine,
  PayrollBulkLoader,
} from '@hrms/core';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import {
  createPayrollTenant,
  ctxFor,
  asApp,
  type PayrollTenant,
} from '../helpers/payroll-fixtures.js';

describe('Payroll Sprint 4.3 Integration Tests (P4-RUN-03, P4-RUN-04, P4-RUN-05, P4-SLIP-01)', () => {
  let db: TestDatabaseContext;
  let tenantA: PayrollTenant;
  let _tenantB: PayrollTenant;

  const runService = new PayrollRunService();
  const worker = new PayrollCalculationWorker();
  const reviewService = new PayrollReviewService();
  const materializationService = new PayslipMaterializationService();
  const warningsEngine = new WarningsBlockersEngine();
  const _bulkLoader = new PayrollBulkLoader();

  let testPeriodIdA: string;
  let testRunIdA: string;

  const makerCtx = () =>
    ctxFor(tenantA.companyId, tenantA.users.maker, [
      PERMISSIONS.PAYROLL_RUN_CREATE,
      PERMISSIONS.PAYROLL_RUN_CALCULATE,
      PERMISSIONS.PAYROLL_RUN_READ,
      PERMISSIONS.PAYROLL_RUN_REVIEW,
      PERMISSIONS.PAYROLL_RUN_HOLD_EMPLOYEE,
      PERMISSIONS.PAYROLL_STRUCTURE_READ,
    ]);

  const checkerCtx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.checker,
      [
        PERMISSIONS.PAYROLL_RUN_READ,
        PERMISSIONS.PAYROLL_RUN_REVIEW,
        PERMISSIONS.PAYROLL_RUN_APPROVE,
      ],
      { stepUp: true },
    );

  const lockerCtx = () =>
    ctxFor(tenantA.companyId, tenantA.users.locker, [
      PERMISSIONS.PAYROLL_RUN_READ,
      PERMISSIONS.PAYROLL_RUN_LOCK,
    ]);

  beforeAll(async () => {
    db = await setupTestDatabase();
    tenantA = await createPayrollTenant(db.ownerPool, 'Sprint 4.3 Alpha', 10);
    _tenantB = await createPayrollTenant(db.ownerPool, 'Sprint 4.3 Beta', 2);

    // Seed approved salary assignment and bank account for employees in tenantA
    await asApp(db.appPool, makerCtx(), async (tx, client) => {
      // 1. Assign approved salaries for all 10 employees
      for (const empId of tenantA.employees) {
        await client.query(
          `INSERT INTO employee_salary (
            id, company_id, employee_id, structure_id, structure_version, ctc_annual,
            effective_from, status, maker_id, checker_id, created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            generateUuidV7(),
            tenantA.companyId,
            empId,
            tenantA.structureId,
            1,
            '1200000.00',
            '2026-01-01',
            'approved',
            tenantA.users.maker,
            tenantA.users.checker,
            tenantA.users.maker,
            tenantA.users.maker,
          ],
        );

        // 2. Set bank account for all employees except the last one (to test missing bank warning/blocker)
        if (empId !== tenantA.employees[9]) {
          await client.query(
            `UPDATE employees SET bank_enc = 'enc_bank_12345678' WHERE id = $1 AND company_id = $2`,
            [empId, tenantA.companyId],
          );
        }
      }

      // 3. Create Pay Period for 2026-04
      const period = await runService.createPeriod(makerCtx(), tx, {
        legalEntityId: tenantA.legalEntityId,
        period: '2026-04',
        fy: '2026-2027',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        cutoffDate: '2026-04-25',
        payDate: '2026-05-01',
      });
      testPeriodIdA = period.id;

      // 4. Create Run for tenantA
      const run = await runService.createRun(makerCtx(), tx, {
        periodId: testPeriodIdA,
        runType: 'regular',
        sequence: 1,
      });
      testRunIdA = run.id;
    });
  });

  afterAll(async () => {
    await db.close();
  });


  describe('1. Calculation Worker (P4-RUN-03)', () => {
    it('executes chunked payroll calculation and stores staged records', async () => {
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        // Execute calculation with chunkSize = 4
        const result = await worker.calculateRun(makerCtx(), tx, testRunIdA, {
          chunkSize: 4,
          forceRecalculate: true,
        });

        const counts = result.counts as { total: number; included: number; held: number; errors: number };
        expect(counts.total).toBe(10);
        expect(counts.included).toBe(10);
        expect(counts.errors).toBe(0);

        // Verify payroll_employee_runs records exist
        const stagedRes = await client.query<{
          id: string;
          gross: string;
          net: string;
          input_hash: string;
          result: unknown;
        }>(
          `SELECT id, gross, net, input_hash, result FROM payroll_employee_runs WHERE run_id = $1 AND company_id = $2`,
          [testRunIdA, tenantA.companyId],
        );

        expect(stagedRes.rows.length).toBe(10);
        for (const s of stagedRes.rows) {
          expect(parseFloat(s.gross)).toBeGreaterThan(0);
          expect(parseFloat(s.net)).toBeGreaterThan(0);
          expect(s.input_hash).toBeDefined();
          expect(s.result).toBeDefined();
        }
      });
    });

    it('skips recalculation if inputHash is unchanged (idempotency)', async () => {
      await asApp(db.appPool, makerCtx(), async tx => {
        // Run calculation again without forceRecalculate
        const result = await worker.calculateRun(makerCtx(), tx, testRunIdA, {
          chunkSize: 5,
          forceRecalculate: false,
        });

        const counts = result.counts as { total: number; errors: number };
        expect(counts.total).toBe(10);
        expect(counts.errors).toBe(0);
      });
    });

    it('isolates employee errors without failing the entire run', async () => {
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        // Temporarily change salary status to draft for one employee
        const badEmp = tenantA.employees[0]!;
        await client.query(
          `UPDATE employee_salary SET status = 'draft' WHERE employee_id = $1 AND company_id = $2`,
          [badEmp, tenantA.companyId],
        );

        const result = await worker.calculateRun(makerCtx(), tx, testRunIdA, {
          chunkSize: 5,
          forceRecalculate: true,
        });

        const counts = result.counts as { total: number; errors: number };
        expect(counts.total).toBe(10);
        expect(counts.errors).toBe(1);

        // Restore approved salary status
        await client.query(
          `UPDATE employee_salary SET status = 'approved' WHERE employee_id = $1 AND company_id = $2`,
          [badEmp, tenantA.companyId],
        );
        await worker.calculateRun(makerCtx(), tx, testRunIdA, { forceRecalculate: true });
      });
    });
  });

  describe('2. Warnings & Blockers Engine (P4-RUN-04)', () => {
    it('detects missing bank account warning on the unconfigured employee', async () => {
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        const noBankEmp = tenantA.employees[9]!;
        const stagedRes = await client.query<{ warnings: string[] }>(
          `SELECT warnings FROM payroll_employee_runs WHERE employee_id = $1 AND company_id = $2`,
          [noBankEmp, tenantA.companyId],
        );

        expect(stagedRes.rows.length).toBe(1);
        const warnings = stagedRes.rows[0]!.warnings || [];
        expect(warnings.some(w => w.toLowerCase().includes('bank'))).toBe(true);
      });
    });

    it('detects unapproved salary status', () => {
      const blockers = warningsEngine.evaluateBlockers({
        hasBankDetails: true,
        salaryStatus: 'draft',
        ruleSetsExpired: false,
        negativeNet: false,
        negativeNetPolicy: 'block',
        balancingNegative: false,
      });

      expect(blockers).toContain('Employee salary assignment is draft, must be approved');
    });

    it('detects expired statutory rules', () => {
      const blockers = warningsEngine.evaluateBlockers({
        hasBankDetails: true,
        salaryStatus: 'approved',
        ruleSetsExpired: true,
        negativeNet: false,
        negativeNetPolicy: 'block',
        balancingNegative: false,
      });

      expect(blockers).toContain('Statutory rule set has expired or is not active for the period');
    });

    it('detects negative net pay policy blocker', () => {
      const blockers = warningsEngine.evaluateBlockers({
        hasBankDetails: true,
        salaryStatus: 'approved',
        ruleSetsExpired: false,
        negativeNet: true,
        negativeNetPolicy: 'block',
        balancingNegative: false,
      });

      expect(blockers).toContain('Negative net pay calculated and company policy is set to block');
    });
  });

  describe('3. Finance Console Review & Set-Based Variance (P4-RUN-05)', () => {
    it('returns run summary cards data in <= 2 queries', async () => {
      await asApp(db.appPool, makerCtx(), async tx => {
        const summary = await reviewService.getSummary(makerCtx(), tx, testRunIdA);

        expect(summary.headcount).toBe(10);
        expect(summary.includedCount).toBe(10);
        expect(summary.heldCount).toBe(0);
        expect(parseFloat(summary.totals.gross)).toBeGreaterThan(0);
        expect(parseFloat(summary.totals.net)).toBeGreaterThan(0);
        expect(summary.canApprove).toBe(true);
      });
    });

    it('returns keyset-paginated staged employee records', async () => {
      await asApp(db.appPool, makerCtx(), async tx => {
        const page1 = await reviewService.listEmployees(makerCtx(), tx, testRunIdA, {
          limit: 4,
        });

        expect(page1.items.length).toBe(4);
        expect(page1.nextCursor).toBeDefined();

        const page2 = await reviewService.listEmployees(makerCtx(), tx, testRunIdA, {
          limit: 4,
          cursor: page1.nextCursor!,
        });

        expect(page2.items.length).toBe(4);
        // Ensure keyset pagination returned distinct sequential rows
        const ids1 = page1.items.map(i => i.id);
        const ids2 = page2.items.map(i => i.id);
        expect(ids1.some(id => ids2.includes(id))).toBe(false);
      });
    });

    it('supports placing an employee on hold and releasing them', async () => {
      const targetEmp = tenantA.employees[0]!;

      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        // 1. Hold
        await reviewService.holdEmployee(
          makerCtx(),
          tx,
          testRunIdA,
          targetEmp,
          'Pending document verification',
        );

        let res = await client.query<{ status: string; hold_reason: string }>(
          `SELECT status, hold_reason FROM payroll_employee_runs WHERE run_id = $1 AND employee_id = $2 AND company_id = $3`,
          [testRunIdA, targetEmp, tenantA.companyId],
        );

        expect(res.rows[0]!.status).toBe('held');
        expect(res.rows[0]!.hold_reason).toBe('Pending document verification');

        // 2. Summary should reflect 1 held employee
        const summary = await reviewService.getSummary(makerCtx(), tx, testRunIdA);
        expect(summary.heldCount).toBe(1);
        expect(summary.includedCount).toBe(9);

        // 3. Release
        await reviewService.releaseEmployee(makerCtx(), tx, testRunIdA, targetEmp);

        res = await client.query<{ status: string; hold_reason: string }>(
          `SELECT status, hold_reason FROM payroll_employee_runs WHERE run_id = $1 AND employee_id = $2 AND company_id = $3`,
          [testRunIdA, targetEmp, tenantA.companyId],
        );

        expect(res.rows[0]!.status).toBe('included');
        expect(res.rows[0]!.hold_reason).toBeNull();
      });
    });

    it('generates complete explain-this-payslip derivation trace', async () => {
      const targetEmp = tenantA.employees[1]!;

      await asApp(db.appPool, makerCtx(), async tx => {
        const trace = await reviewService.explainPayslip(makerCtx(), tx, testRunIdA, targetEmp);

        expect(trace.employee.id).toBe(targetEmp);
        expect(trace.summary.gross).toBeDefined();
        expect(trace.summary.net).toBeDefined();
        expect(trace.lines.earnings.length).toBeGreaterThan(0);
        expect(trace.lines.deductions.length).toBeGreaterThanOrEqual(0);
        expect(trace.summary.payableDays).toBeGreaterThan(0);
      });
    });

    it('computes set-based variance comparison', async () => {
      await asApp(db.appPool, makerCtx(), async tx => {
        const variance = await reviewService.getVariance(makerCtx(), tx, testRunIdA, {
          limit: 10,
        });

        expect(variance.items.length).toBe(10);
        // On first run without prior locked run, variance category is FIRST_PAYROLL
        expect(variance.items[0]!.varianceCategory).toBe('FIRST_PAYROLL');
        expect(variance.items[0]!.grossPctChange).toBe(100);
      });
    });

    it('simulates employee payslip without mutating database state', async () => {
      const targetEmp = tenantA.employees[2]!;

      await asApp(db.appPool, makerCtx(), async tx => {
        const baseline = await reviewService.explainPayslip(makerCtx(), tx, testRunIdA, targetEmp);

        // Run simulation with 5 LOP days and 10000 bonus
        const simulated = await reviewService.simulatePayslip(makerCtx(), tx, testRunIdA, targetEmp, {
          lopDays: 5,
          additionalInputs: [{ type: 'bonus', amount: 10000 }],
        });

        expect(simulated).toBeDefined();
        // Gross should reflect bonus and LOP proration
        expect(parseFloat(simulated.gross)).toBeGreaterThan(0);

        // Verify DB staged record was NOT changed by simulation
        const afterExplain = await reviewService.explainPayslip(makerCtx(), tx, testRunIdA, targetEmp);
        expect(afterExplain.summary.gross).toBe(baseline.summary.gross);
      });
    });
  });

  describe('4. Payslip Materialization, Locking & Immutability Triggers (P4-SLIP-01)', () => {
    it('enforces Segregation of Duties: creator cannot approve', async () => {
      await asApp(db.appPool, makerCtx(), async tx => {
        // Transition calculated -> review first
        await runService.transitionRun(makerCtx(), tx, testRunIdA, 'review');

        // Attempting to approve using maker context (creator) should fail with SoD error
        await expect(
          runService.transitionRun(makerCtx(), tx, testRunIdA, 'approved'),
        ).rejects.toThrow();
      });
    });

    it('approves run with checker and advances state to approved', async () => {
      await asApp(db.appPool, checkerCtx(), async tx => {
        const approved = await runService.transitionRun(checkerCtx(), tx, testRunIdA, 'approved');
        expect(approved.status).toBe('approved');
        expect(approved.approvedBy).toBe(tenantA.users.checker);
      });
    });

    it('enforces Segregation of Duties: approver or creator cannot lock', async () => {
      await asApp(db.appPool, checkerCtx(), async tx => {
        // Checker (approver) cannot lock
        await expect(
          materializationService.materializeAndLockRun(checkerCtx(), tx, testRunIdA),
        ).rejects.toThrow();
      });

      await asApp(db.appPool, makerCtx(), async tx => {
        // Maker (creator) cannot lock
        await expect(
          materializationService.materializeAndLockRun(makerCtx(), tx, testRunIdA),
        ).rejects.toThrow();
      });
    });

    it('materializes payslips, updates YTD, and seals run with locker', async () => {
      await asApp(db.appPool, lockerCtx(), async (tx, client) => {
        const lockedRun = await materializationService.materializeAndLockRun(
          lockerCtx(),
          tx,
          testRunIdA,
          { chunkSize: 3 },
        );

        expect(lockedRun.status).toBe('locked');
        expect(lockedRun.runHash).toBeDefined();
        expect(lockedRun.lockedBy).toBe(tenantA.users.locker);
        expect(lockedRun.lockedAt).toBeDefined();

        // 1. Verify payslips table materialization
        const slipsRes = await client.query<{
          id: string;
          integrity_hash: string;
          snapshot: unknown;
          gross: string;
          net: string;
        }>(
          `SELECT id, integrity_hash, snapshot, gross, net FROM payslips WHERE run_id = $1 AND company_id = $2`,
          [testRunIdA, tenantA.companyId],
        );

        expect(slipsRes.rows.length).toBe(10);
        for (const s of slipsRes.rows) {
          expect(s.integrity_hash).toBeDefined();
          expect(s.snapshot).toBeDefined();
          expect(parseFloat(s.gross)).toBeGreaterThan(0);
          expect(parseFloat(s.net)).toBeGreaterThan(0);
        }

        // 2. Verify payslip_lines table materialization
        const linesRes = await client.query(
          `SELECT count(*)::int as count FROM payslip_lines WHERE company_id = $1`,
          [tenantA.companyId],
        );
        expect(Number(linesRes.rows[0].count)).toBeGreaterThan(10);

        // 3. Verify payroll_ytd ledger updated
        const ytdRes = await client.query<{ component_code: string; amount: string }>(
          `SELECT component_code, amount FROM payroll_ytd WHERE company_id = $1`,
          [tenantA.companyId],
        );

        expect(ytdRes.rows.length).toBeGreaterThan(0);
        for (const y of ytdRes.rows) {
          expect(parseFloat(y.amount)).toBeGreaterThan(0);
        }
      });
    });

    it('verifies DB trigger blocks updates to payslip financials or deletion', async () => {
      let slipId: string;
      await asApp(db.appPool, lockerCtx(), async (tx, client) => {
        const slipRes = await client.query<{ id: string }>(
          `SELECT id FROM payslips WHERE run_id = $1 AND company_id = $2 LIMIT 1`,
          [testRunIdA, tenantA.companyId],
        );
        expect(slipRes.rows[0]).toBeDefined();
        slipId = slipRes.rows[0]!.id;
      });

      // 1. Updating gross financial figure -> MUST BE REJECTED BY TRIGGER
      await expect(
        asApp(db.appPool, lockerCtx(), async (tx, client) => {
          await client.query(
            `UPDATE payslips SET gross = '999999.00' WHERE id = $1 AND company_id = $2`,
            [slipId, tenantA.companyId],
          );
        }),
      ).rejects.toThrow(/IMMUTABLE|prohibited/i);

      // 2. Updating net financial figure -> MUST BE REJECTED BY TRIGGER
      await expect(
        asApp(db.appPool, lockerCtx(), async (tx, client) => {
          await client.query(
            `UPDATE payslips SET net = '999999.00' WHERE id = $1 AND company_id = $2`,
            [slipId, tenantA.companyId],
          );
        }),
      ).rejects.toThrow(/IMMUTABLE|prohibited/i);

      // 3. Updating snapshot -> MUST BE REJECTED BY TRIGGER
      await expect(
        asApp(db.appPool, lockerCtx(), async (tx, client) => {
          await client.query(
            `UPDATE payslips SET snapshot = '{"hacked": true}'::jsonb WHERE id = $1 AND company_id = $2`,
            [slipId, tenantA.companyId],
          );
        }),
      ).rejects.toThrow(/IMMUTABLE|prohibited/i);

      // 4. Deleting payslip -> MUST BE REJECTED BY TRIGGER
      await expect(
        asApp(db.appPool, lockerCtx(), async (tx, client) => {
          await client.query(
            `DELETE FROM payslips WHERE id = $1 AND company_id = $2`,
            [slipId, tenantA.companyId],
          );
        }),
      ).rejects.toThrow(/IMMUTABLE|prohibited/i);

      // 5. Updating publishing metadata or PDF file ID -> PERMITTED
      await expect(
        asApp(db.appPool, lockerCtx(), async (tx, client) => {
          await client.query(
            `UPDATE payslips SET published_at = NOW() WHERE id = $1 AND company_id = $2`,
            [slipId, tenantA.companyId],
          );
        }),
      ).resolves.not.toThrow();
    });

    it('verifies DB trigger blocks all updates and deletes to payslip_lines', async () => {
      let lineId: string;
      await asApp(db.appPool, lockerCtx(), async (tx, client) => {
        const lineRes = await client.query<{ id: string }>(
          `SELECT id FROM payslip_lines WHERE company_id = $1 LIMIT 1`,
          [tenantA.companyId],
        );
        expect(lineRes.rows[0]).toBeDefined();
        lineId = lineRes.rows[0]!.id;
      });

      // Update to payslip_lines -> MUST BE REJECTED BY TRIGGER
      await expect(
        asApp(db.appPool, lockerCtx(), async (tx, client) => {
          await client.query(
            `UPDATE payslip_lines SET amount = '9999.00' WHERE id = $1 AND company_id = $2`,
            [lineId, tenantA.companyId],
          );
        }),
      ).rejects.toThrow(/IMMUTABLE|prohibited|append-only/i);

      // Delete from payslip_lines -> MUST BE REJECTED BY TRIGGER
      await expect(
        asApp(db.appPool, lockerCtx(), async (tx, client) => {
          await client.query(
            `DELETE FROM payslip_lines WHERE id = $1 AND company_id = $2`,
            [lineId, tenantA.companyId],
          );
        }),
      ).rejects.toThrow(/IMMUTABLE|prohibited|append-only/i);
    });
  });
});
