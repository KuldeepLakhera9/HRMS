import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateUuidV7,
} from '@hrms/db';
import {
  PERMISSIONS,
} from '@hrms/shared';
import {
  ReconciliationService,
} from '@hrms/core';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import {
  createPayrollTenant,
  ctxFor,
  asApp,
  type PayrollTenant,
} from '../helpers/payroll-fixtures.js';

describe('Payroll Sprint 4.6 Parallel Run Support (Cycles 2 & 3)', () => {
  let db: TestDatabaseContext;
  let tenantA: PayrollTenant;

  const reconService = new ReconciliationService();

  let cycle2RunId: string;
  let cycle3RunId: string;
  const cycle2Period = '2026-05';
  const cycle3Period = '2026-06';

  afterAll(async () => {
    if (db) await db.close();
  });

  const caCtx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.secondApprover,
      [
        PERMISSIONS.PAYROLL_RECON_MANAGE,
        PERMISSIONS.PAYROLL_RECON_SIGNOFF,
        PERMISSIONS.PAYROLL_RUN_READ,
      ],
      { stepUp: true },
    );

  const financeCtx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.unlocker,
      [
        PERMISSIONS.PAYROLL_RECON_MANAGE,
        PERMISSIONS.PAYROLL_RECON_SIGNOFF,
        PERMISSIONS.PAYROLL_RUN_READ,
      ],
      { stepUp: true },
    );

  beforeAll(async () => {
    db = await setupTestDatabase();
    tenantA = await createPayrollTenant(db.ownerPool, 'ParallelReconCorp', 4);

    const p2Id = generateUuidV7();
    const p3Id = generateUuidV7();
    cycle2RunId = generateUuidV7();
    cycle3RunId = generateUuidV7();

    await asApp(db.appPool, financeCtx(), async (tx, client) => {
      // 1. Insert Period 2 and Period 3
      await client.query(
        `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
         VALUES
          ($1, $2, $3, $4, '2026-27', '2026-05-01', '2026-05-31', '2026-05-25', '2026-05-31', 'locked', $5, $5),
          ($6, $2, $3, $7, '2026-27', '2026-06-01', '2026-06-30', '2026-06-25', '2026-06-30', 'locked', $5, $5)`,
        [p2Id, tenantA.companyId, tenantA.legalEntityId, cycle2Period, tenantA.users.maker, p3Id, cycle3Period],
      );

      // 2. Insert Run 2 and Run 3
      await client.query(
        `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, created_by, updated_by, locked_by)
         VALUES
          ($1, $2, $3, 'regular', 1, 'locked', $4, $4, $5),
          ($6, $2, $7, 'regular', 1, 'locked', $4, $4, $5)`,
        [cycle2RunId, tenantA.companyId, p2Id, tenantA.users.maker, tenantA.users.locker, cycle3RunId, p3Id],
      );

      // 3. Insert modern payslips and lines for 3 employees across both runs
      const empIds = tenantA.employees.slice(0, 3);
      for (const empId of empIds) {
        // Cycle 2 Payslip
        const ps2Id = generateUuidV7();
        await client.query(
          `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, '50000.00', '8000.00', '55000.00', '42000.00', 'hash_c2', '{}', $6, $6)`,
          [ps2Id, tenantA.companyId, cycle2RunId, empId, cycle2Period, tenantA.users.maker],
        );

        await client.query(
          `INSERT INTO payslip_lines (id, company_id, payslip_id, run_id, employee_id, component_code, kind, amount, taxable_amount, sort_order)
           VALUES
            (gen_random_uuid(), $1, $2, $3, $4, 'BASIC', 'earning', '30000.00', '30000.00', 0),
            (gen_random_uuid(), $1, $2, $3, $4, 'HRA', 'earning', '12000.00', '12000.00', 1),
            (gen_random_uuid(), $1, $2, $3, $4, 'SPECIAL', 'earning', '8000.00', '8000.00', 2),
            (gen_random_uuid(), $1, $2, $3, $4, 'PF_EE', 'deduction', '1800.00', '0.00', 3),
            (gen_random_uuid(), $1, $2, $3, $4, 'PT', 'deduction', '200.00', '0.00', 4),
            (gen_random_uuid(), $1, $2, $3, $4, 'TDS', 'deduction', '6000.00', '0.00', 5)`,
          [tenantA.companyId, ps2Id, cycle2RunId, empId],
        );

        // Cycle 3 Payslip
        const ps3Id = generateUuidV7();
        await client.query(
          `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, '50000.00', '8000.00', '55000.00', '42000.00', 'hash_c3', '{}', $6, $6)`,
          [ps3Id, tenantA.companyId, cycle3RunId, empId, cycle3Period, tenantA.users.maker],
        );

        await client.query(
          `INSERT INTO payslip_lines (id, company_id, payslip_id, run_id, employee_id, component_code, kind, amount, taxable_amount, sort_order)
           VALUES
            (gen_random_uuid(), $1, $2, $3, $4, 'BASIC', 'earning', '30000.00', '30000.00', 0),
            (gen_random_uuid(), $1, $2, $3, $4, 'HRA', 'earning', '12000.00', '12000.00', 1),
            (gen_random_uuid(), $1, $2, $3, $4, 'SPECIAL', 'earning', '8000.00', '8000.00', 2),
            (gen_random_uuid(), $1, $2, $3, $4, 'PF_EE', 'deduction', '1800.00', '0.00', 3),
            (gen_random_uuid(), $1, $2, $3, $4, 'PT', 'deduction', '200.00', '0.00', 4),
            (gen_random_uuid(), $1, $2, $3, $4, 'TDS', 'deduction', '6000.00', '0.00', 5)`,
          [tenantA.companyId, ps3Id, cycle3RunId, empId],
        );
      }
    });
  });

  describe('Parallel Run Cycle 2: Triage and Resolution of Differences', () => {
    it('should identify edge-case diffs in Cycle 2, track explanations, and complete dual sign-off', async () => {
      await asApp(db.appPool, financeCtx(), async (tx, client) => {
        const empCodes = await Promise.all(
          tenantA.employees.slice(0, 3).map(async id => {
            const res = await client.query('SELECT emp_code FROM employees WHERE id = $1', [id]);
            return res.rows[0].emp_code as string;
          }),
        );

        // 1. Create Cycle 2 Recon
        const cycle2 = await reconService.createCycle(financeCtx(), tx, {
          period: cycle2Period,
          runId: cycle2RunId,
          tolerance: 1.0,
        });

        expect(cycle2.status).toBe('open');

        // 2. Import Legacy Output for 3 employees:
        // emp0: exact match
        // emp1: PT difference (-50 from old slab)
        // emp2: TDS variance from old tax regime slab (-200 difference)
        const importResult = await reconService.importAndCompare(financeCtx(), tx, cycle2.id, {
          filename: 'legacy_payroll_cycle2_may2026.csv',
          columnMapping: {
            'Basic Pay': 'BASIC',
            'House Rent Allowance': 'HRA',
            'Special Allowance': 'SPECIAL',
            'Provident Fund': 'PF_EE',
            'Prof Tax': 'PT',
            'TDS Tax': 'TDS',
          },
          rows: [
            {
              empCode: empCodes[0],
              'Basic Pay': 30000,
              'House Rent Allowance': 12000,
              'Special Allowance': 8000,
              'Provident Fund': 1800,
              'Prof Tax': 200,
              'TDS Tax': 6000,
            },
            {
              empCode: empCodes[1],
              'Basic Pay': 30000,
              'House Rent Allowance': 12000,
              'Special Allowance': 8000,
              'Provident Fund': 1800,
              'Prof Tax': 150, // Diff: 50 variance
              'TDS Tax': 6000,
            },
            {
              empCode: empCodes[2],
              'Basic Pay': 30000,
              'House Rent Allowance': 12000,
              'Special Allowance': 8000,
              'Provident Fund': 1800,
              'Prof Tax': 200,
              'TDS Tax': 5800, // Diff: 200 variance
            },
          ],
        });

        expect(importResult.comparedEmployees).toBe(3);
        expect(importResult.summary.openDiffs).toBe(2);

        // 3. Retrieve open diffs
        const diffs = await reconService.getCycleDiffs(financeCtx(), tx, cycle2.id);
        expect(diffs.length).toBe(2);

        // 4. Attempt signoff with open diffs should fail
        await expect(
          reconService.signoffCycle(financeCtx(), tx, cycle2.id, 'finance'),
        ).rejects.toThrow(/Cannot sign off: There are 2 unexplained variances/);

        // 5. Triage and explain diff 1 (PT)
        const ptDiff = diffs.find(d => d.componentCode === 'PT')!;
        await reconService.explainDiff(financeCtx(), tx, ptDiff.id, {
          explanation: 'Legacy system applied old 2025 PT slabs; verified modern rule is compliant with revised state notification',
          category: 'rule_difference',
          status: 'explained',
        });

        // 6. Triage and explain diff 2 (TDS)
        const tdsDiff = diffs.find(d => d.componentCode === 'TDS')!;
        await reconService.explainDiff(financeCtx(), tx, tdsDiff.id, {
          explanation: 'Legacy TDS computed under old regime without verifying declared Sec 80C caps; modern engine correctly enforced ceiling',
          category: 'rule_difference',
          status: 'explained',
        });

        // 7. Finance signs off Cycle 2
        const financeSigned = await reconService.signoffCycle(financeCtx(), tx, cycle2.id, 'finance');
        expect(financeSigned.signedByFinance).toBeDefined();
        expect(financeSigned.status).toBe('in_review');

        // 8. CA signs off Cycle 2 -> cycle status transitions to 'signed'
        const caSigned = await reconService.signoffCycle(caCtx(), tx, cycle2.id, 'ca');
        expect(caSigned.signedByCa).toBeDefined();
        expect(caSigned.status).toBe('signed');
      });
    });
  });

  describe('Parallel Run Cycle 3: Zero Unexplained Variance (100% Match)', () => {
    it('should achieve 100% component match across all employees with zero open variances and sign off', async () => {
      await asApp(db.appPool, financeCtx(), async (tx, client) => {
        const empCodes = await Promise.all(
          tenantA.employees.slice(0, 3).map(async id => {
            const res = await client.query('SELECT emp_code FROM employees WHERE id = $1', [id]);
            return res.rows[0].emp_code as string;
          }),
        );

        // 1. Create Cycle 3 Recon
        const cycle3 = await reconService.createCycle(financeCtx(), tx, {
          period: cycle3Period,
          runId: cycle3RunId,
          tolerance: 0.50, // strict 50 paise tolerance
        });

        expect(cycle3.status).toBe('open');

        // 2. Import Legacy Output for Cycle 3 with 100% reconciled values
        const importResult = await reconService.importAndCompare(financeCtx(), tx, cycle3.id, {
          filename: 'legacy_payroll_cycle3_june2026_reconciled.csv',
          columnMapping: {
            'Basic Pay': 'BASIC',
            'House Rent Allowance': 'HRA',
            'Special Allowance': 'SPECIAL',
            'Provident Fund': 'PF_EE',
            'Prof Tax': 'PT',
            'TDS Tax': 'TDS',
          },
          rows: empCodes.map(code => ({
            empCode: code,
            'Basic Pay': 30000,
            'House Rent Allowance': 12000,
            'Special Allowance': 8000,
            'Provident Fund': 1800,
            'Prof Tax': 200,
            'TDS Tax': 6000,
          })),
        });

        expect(importResult.comparedEmployees).toBe(3);
        expect(importResult.totalDiffsCount).toBe(0);
        expect(importResult.summary.openDiffs).toBe(0);
        expect(importResult.summary.totalVariance).toBe('0.00');

        // 3. Confirm zero diffs created in DB
        const diffs = await reconService.getCycleDiffs(financeCtx(), tx, cycle3.id);
        expect(diffs.length).toBe(0);

        // 4. CA signs off first
        const caSigned = await reconService.signoffCycle(caCtx(), tx, cycle3.id, 'ca');
        expect(caSigned.signedByCa).toBeDefined();
        expect(caSigned.status).toBe('in_review');

        // 5. Finance signs off second -> status transitions to 'signed'
        const fullySigned = await reconService.signoffCycle(financeCtx(), tx, cycle3.id, 'finance');
        expect(fullySigned.signedByFinance).toBeDefined();
        expect(fullySigned.status).toBe('signed');
      });
    });
  });
});
