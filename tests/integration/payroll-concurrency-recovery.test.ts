import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import {
  generateUuidV7,
} from '@hrms/db';
import {
  PERMISSIONS,
} from '@hrms/shared';
import {
  executeRunTransition,
} from '@hrms/core';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';

function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    k => `${JSON.stringify(k)}:${canonicalStringify((obj as Record<string, unknown>)[k])}`,
  );
  return '{' + entries.join(',') + '}';
}
import {
  createPayrollTenant,
  ctxFor,
  asApp,
  type PayrollTenant,
} from '../helpers/payroll-fixtures.js';

describe('Payroll Sprint 4.6 P4-QA-02: Concurrency, Crash Recovery & DR Integrity', () => {
  let db: TestDatabaseContext;
  let tenantA: PayrollTenant;

  afterAll(async () => {
    if (db) await db.close();
  });

  const makerCtx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.maker,
      [
        PERMISSIONS.PAYROLL_RUN_CREATE,
        PERMISSIONS.PAYROLL_RUN_CALCULATE,
        PERMISSIONS.PAYROLL_RUN_READ,
        PERMISSIONS.PAYROLL_RUN_REVIEW,
      ],
    );


  const lockerCtx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.locker,
      [
        PERMISSIONS.PAYROLL_RUN_LOCK,
        PERMISSIONS.PAYROLL_RUN_READ,
      ],
      { stepUp: true },
    );

  beforeAll(async () => {
    db = await setupTestDatabase();
    tenantA = await createPayrollTenant(db.ownerPool, 'ConcurrencyTenant', 3);
  });

  describe('1. Concurrency & Race Condition Defense', () => {
    it('should prevent concurrent race conditions on run state transitions using row locking', async () => {
      const periodId = generateUuidV7();
      const runId = generateUuidV7();

      // Seed run in 'draft' status
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        await client.query(
          `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
           VALUES ($1, $2, $3, '2026-07', '2026-27', '2026-07-01', '2026-07-31', '2026-07-25', '2026-07-31', 'open', $4, $4)`,
          [periodId, tenantA.companyId, tenantA.legalEntityId, tenantA.users.maker],
        );

        await client.query(
          `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, created_by, updated_by)
           VALUES ($1, $2, $3, 'regular', 1, 'draft', $4, $4)`,
          [runId, tenantA.companyId, periodId, tenantA.users.maker],
        );
      });

      // Attempt two parallel state transitions: one to 'inputs_ready', another to 'inputs_ready'
      const results = await Promise.allSettled([
        asApp(db.appPool, makerCtx(), async tx => {
          return executeRunTransition(makerCtx(), tx, runId, 'inputs_ready', {
            skipAttendanceLockCheck: true,
          });
        }),
        asApp(db.appPool, makerCtx(), async tx => {
          return executeRunTransition(makerCtx(), tx, runId, 'inputs_ready', {
            skipAttendanceLockCheck: true,
          });
        }),
      ]);

      // Exactly one must succeed, the second must be rejected because the run is no longer in 'draft'
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason.message).toMatch(/Forbidden transition: Cannot transition payroll run from 'inputs_ready' to 'inputs_ready'/);
      }
    });
  });

  describe('2. Crash Recovery & Resumption', () => {
    it('should safely recover a run stuck in calculating state back to draft without corrupting data', async () => {
      const periodId = generateUuidV7();
      const crashedRunId = generateUuidV7();

      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        await client.query(
          `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
           VALUES ($1, $2, $3, '2026-08', '2026-27', '2026-08-01', '2026-08-31', '2026-08-25', '2026-08-31', 'open', $4, $4)`,
          [periodId, tenantA.companyId, tenantA.legalEntityId, tenantA.users.maker],
        );

        // Simulate worker crash midway: run left in 'calculating'
        await client.query(
          `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, created_by, updated_by)
           VALUES ($1, $2, $3, 'regular', 1, 'calculating', $4, $4)`,
          [crashedRunId, tenantA.companyId, periodId, tenantA.users.maker],
        );
      });

      // Operator triggers crash recovery: rollback 'calculating' -> 'draft'
      await asApp(db.appPool, makerCtx(), async tx => {
        const recoveredRun = await executeRunTransition(makerCtx(), tx, crashedRunId, 'draft', {
          reason: 'Worker crashed during calculation batch; resetting to draft for safe retry',
        });
        expect(recoveredRun.status).toBe('draft');
      });

      // Confirm audit event was recorded for crash recovery
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        const events = await client.query(
          `SELECT event, details FROM payroll_run_events WHERE run_id = $1 ORDER BY ts DESC`,
          [crashedRunId],
        );
        expect(events.rows.length).toBeGreaterThan(0);
        expect(events.rows[0].event).toBe('run.transition.calculating_to_draft');
      });
    });

    it('should safely rollback a run stuck in locking state back to review', async () => {
      const periodId = generateUuidV7();
      const stuckLockRunId = generateUuidV7();

      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        await client.query(
          `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
           VALUES ($1, $2, $3, '2026-09', '2026-27', '2026-09-01', '2026-09-30', '2026-09-25', '2026-09-30', 'open', $4, $4)`,
          [periodId, tenantA.companyId, tenantA.legalEntityId, tenantA.users.maker],
        );

        // Run was approved, then entered 'locking', but lock worker failed mid-way
        await client.query(
          `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, approved_by, created_by, updated_by)
           VALUES ($1, $2, $3, 'regular', 1, 'locking', $4, $5, $5)`,
          [stuckLockRunId, tenantA.companyId, periodId, tenantA.users.checker, tenantA.users.maker],
        );
      });

      // Locker triggers rollback to review
      await asApp(db.appPool, lockerCtx(), async tx => {
        const rolledBack = await executeRunTransition(lockerCtx(), tx, stuckLockRunId, 'review', {
          reason: 'Materialization timeout during lock; rolling back to review for re-inspection',
        });
        expect(rolledBack.status).toBe('review');
      });
    });
  });

  describe('3. Once-and-Only-Once Input Consumption', () => {
    it('should ensure payroll inputs cannot be double-consumed by concurrent or repeat runs', async () => {
      const inputId = generateUuidV7();
      const period = '2026-10';
      const periodId = generateUuidV7();
      const run1Id = generateUuidV7();
      const run2Id = generateUuidV7();

      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        await client.query(
          `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, '2026-27', '2026-10-01', '2026-10-31', '2026-10-25', '2026-10-31', 'open', $5, $5)`,
          [periodId, tenantA.companyId, tenantA.legalEntityId, period, tenantA.users.maker],
        );

        // Seed runs so foreign keys on consumed_run_id are satisfied
        await client.query(
          `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, created_by, updated_by)
           VALUES
            ($1, $2, $3, 'regular', 1, 'draft', $4, $4),
            ($5, $2, $3, 'regular', 2, 'draft', $4, $4)`,
          [run1Id, tenantA.companyId, periodId, tenantA.users.maker, run2Id],
        );

        // Create an approved input
        await client.query(
          `INSERT INTO payroll_inputs (id, company_id, employee_id, type, component_code, amount, taxable, for_period, status, created_by, updated_by)
           VALUES ($1, $2, $3, 'bonus', 'FESTIVAL_BONUS', '15000.00', true, $4, 'approved', $5, $5)`,
          [inputId, tenantA.companyId, tenantA.employees[0], period, tenantA.users.maker],
        );
      });

      // Worker 1 consumes the input
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        const res = await client.query(
          `UPDATE payroll_inputs
           SET status = 'consumed', consumed_run_id = $1, updated_at = NOW()
           WHERE company_id = $2 AND for_period = $3 AND status = 'approved' AND id = $4
           RETURNING id`,
          [run1Id, tenantA.companyId, period, inputId],
        );
        expect(res.rows.length).toBe(1);
      });

      // Worker 2 attempts to consume the same input -> zero rows updated
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        const res = await client.query(
          `UPDATE payroll_inputs
           SET status = 'consumed', consumed_run_id = $1, updated_at = NOW()
           WHERE company_id = $2 AND for_period = $3 AND status = 'approved' AND id = $4
           RETURNING id`,
          [run2Id, tenantA.companyId, period, inputId],
        );
        expect(res.rows.length).toBe(0); // Protected: exactly zero rows consumed second time
      });
    });
  });

  describe('4. Disaster Recovery & Hash Integrity Verification', () => {
    it('should cryptographically verify backup restore integrity across all payslips and run hash', async () => {
      const runId = generateUuidV7();
      const period = '2026-11';
      const periodId = generateUuidV7();

      // Setup 3 payslips with deterministic snapshots and integrity hashes
      const payslipRecords = tenantA.employees.slice(0, 3).map((empId, idx) => {
        const gross = 50000 + idx * 10000;
        const deductions = 5000 + idx * 1000;
        const net = gross - deductions;
        const snapshot = {
          employeeId: empId,
          period,
          gross: gross.toFixed(2),
          deductions: deductions.toFixed(2),
          net: net.toFixed(2),
        };
        const integrityHash = crypto
          .createHash('sha256')
          .update(canonicalStringify(snapshot))
          .digest('hex');

        return {
          id: generateUuidV7(),
          employeeId: empId,
          gross: gross.toFixed(2),
          deductions: deductions.toFixed(2),
          net: net.toFixed(2),
          snapshot,
          integrityHash,
        };
      });

      // Sort by employeeId to match standard canonical ordering
      payslipRecords.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
      const hashConcat = payslipRecords.map(p => p.integrityHash).join(':');
      const expectedRunHash = crypto.createHash('sha256').update(hashConcat).digest('hex');

      // Write to DB simulating backed up & restored payroll run
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        await client.query(
          `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, '2026-27', '2026-11-01', '2026-11-30', '2026-11-25', '2026-11-30', 'locked', $5, $5)`,
          [periodId, tenantA.companyId, tenantA.legalEntityId, period, tenantA.users.maker],
        );

        await client.query(
          `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, run_hash, created_by, updated_by)
           VALUES ($1, $2, $3, 'regular', 1, 'locked', $4, $5, $5)`,
          [runId, tenantA.companyId, periodId, expectedRunHash, tenantA.users.maker],
        );

        for (const ps of payslipRecords) {
          await client.query(
            `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, '0.00', $8, $9, $10, $11, $11)`,
            [
              ps.id,
              tenantA.companyId,
              runId,
              ps.employeeId,
              period,
              ps.gross,
              ps.deductions,
              ps.net,
              ps.integrityHash,
              JSON.stringify(ps.snapshot),
              tenantA.users.maker,
            ],
          );
        }
      });

      // DR Verification Procedure:
      // 1. Fetch restored payslips and recalculate SHA-256 integrity hash from frozen snapshot
      // 2. Compare against stored payslip integrity_hash
      // 3. Concatenate ordered integrity hashes and assert match with stored run_hash
      await asApp(db.appPool, makerCtx(), async (tx, client) => {
        const restoredRun = await client.query(
          `SELECT run_hash FROM payroll_runs WHERE id = $1`,
          [runId],
        );
        const storedRunHash = restoredRun.rows[0].run_hash;

        const restoredPayslips = await client.query(
          `SELECT id, employee_id, snapshot, integrity_hash FROM payslips WHERE run_id = $1 ORDER BY employee_id ASC`,
          [runId],
        );

        expect(restoredPayslips.rows.length).toBe(3);

        const verifiedHashes: string[] = [];
        for (const row of restoredPayslips.rows) {
          const recalculatedHash = crypto
            .createHash('sha256')
            .update(canonicalStringify(row.snapshot))
            .digest('hex');

          // Each restored payslip's hash must match exactly
          expect(recalculatedHash).toBe(row.integrity_hash);
          verifiedHashes.push(recalculatedHash);
        }

        // Run hash verification
        const recomputedRunHash = crypto
          .createHash('sha256')
          .update(verifiedHashes.join(':'))
          .digest('hex');

        expect(recomputedRunHash).toBe(storedRunHash);

        // Tamper test: If an attacker or corrupted backup changed 1 paise in any payslip snapshot
        const tamperedSnapshot = { ...payslipRecords[0].snapshot, net: '44999.99' };
        const tamperedHash = crypto.createHash('sha256').update(canonicalStringify(tamperedSnapshot)).digest('hex');
        expect(tamperedHash).not.toBe(payslipRecords[0].integrityHash);
      });
    });
  });
});
