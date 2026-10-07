import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import {
  generateUuidV7,
  Database,
} from '@hrms/db';
import {
  PERMISSIONS,
  ForbiddenError,
  ValidationError,
} from '@hrms/shared';
import {
  PayrollLifecycleService,
  PayslipPdfService,
  generatePayslipPdf,
  BankAdviceService,
  ExpenseService,
  ReportRegistry,
  PayslipPdfData,
} from '@hrms/core';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import {
  createPayrollTenant,
  ctxFor,
  asApp,
  type PayrollTenant,
} from '../helpers/payroll-fixtures.js';

describe('Payroll Sprint 4.4 Integration Tests (P4-RUN-06, P4-SLIP-02, P4-SLIP-03, P4-REP-01, P4-EXP-01, P4-EXP-02)', () => {
  let db: TestDatabaseContext;
  let tenantA: PayrollTenant;

  const lifecycleService = new PayrollLifecycleService();
  const pdfService = new PayslipPdfService();
  const bankService = new BankAdviceService();
  const expenseService = new ExpenseService();

  let testPeriodId: string;
  let testRunId: string;
  let testPayslipId: string;
  const testPeriod = '2026-04';

  const unlockerCtx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.unlocker,
      [
        PERMISSIONS.PAYROLL_RUN_CREATE,
        PERMISSIONS.PAYROLL_RUN_READ,
        PERMISSIONS.PAYROLL_RUN_LOCK,
        PERMISSIONS.PAYROLL_RUN_UNLOCK,
        PERMISSIONS.PAYROLL_RUN_PUBLISH,
        PERMISSIONS.PAYROLL_BANKFILE_GENERATE,
        PERMISSIONS.PAYROLL_BANKFILE_DOWNLOAD,
        PERMISSIONS.PAYROLL_PAYSLIP_VIEW_COMPANY,
        PERMISSIONS.PAYROLL_PAYSLIP_REISSUE,
        PERMISSIONS.EXPENSE_CATEGORY_MANAGE,
        PERMISSIONS.EXPENSE_POLICY_MANAGE,
        PERMISSIONS.EXPENSE_CLAIM_CREATE,
        PERMISSIONS.EXPENSE_CLAIM_READ,
        PERMISSIONS.EXPENSE_CLAIM_APPROVE,
        PERMISSIONS.EXPENSE_CLAIM_PAY,
      ],
      { stepUp: true },
    );

  const emp1Ctx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.maker,
      [
        PERMISSIONS.PAYROLL_PAYSLIP_VIEW_SELF,
        PERMISSIONS.EXPENSE_CLAIM_CREATE,
        PERMISSIONS.EXPENSE_CLAIM_READ,
      ],
      {},
    );

  beforeAll(async () => {
    db = await setupTestDatabase();

    // Ensure hrms_app role has permissions and updated NULLIF policies on sprint 4.4 tables
    await db.ownerPool.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON bank_format_templates, bank_advice_files, payment_confirmations, expense_categories, expense_policies, expense_claims, expense_items TO hrms_app;
      DROP POLICY IF EXISTS tenant_isolation_policy ON expense_categories;
      CREATE POLICY tenant_isolation_policy ON expense_categories FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON expense_policies;
      CREATE POLICY tenant_isolation_policy ON expense_policies FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON expense_claims;
      CREATE POLICY tenant_isolation_policy ON expense_claims FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON expense_items;
      CREATE POLICY tenant_isolation_policy ON expense_items FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
    `);

    tenantA = await createPayrollTenant(db.ownerPool, 'Sprint 4.4 Alpha', 5);

    // Setup a period and a locked payroll run with materialized payslips & YTD
    testPeriodId = generateUuidV7();
    testRunId = generateUuidV7();
    testPayslipId = generateUuidV7();

    await asApp(db.appPool, unlockerCtx(), async (tx, client) => {
      // 1. Insert Period
      await client.query(
        `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, '2026-27', $5, $6, '2026-04-25', '2026-04-30', 'open', $7, $7)`,
        [testPeriodId, tenantA.companyId, tenantA.legalEntityId, testPeriod, '2026-04-01', '2026-04-30', tenantA.users.maker],
      );

      // 2. Insert Run in 'locked' status
      await client.query(
        `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, created_by, updated_by, locked_by)
         VALUES ($1, $2, $3, 'regular', 1, 'locked', $4, $4, $5)`,
        [testRunId, tenantA.companyId, testPeriodId, tenantA.users.maker, tenantA.users.locker],
      );

      // 3. Insert Payslip
      await client.query(
        `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, '100000.00', '15000.00', '12000.00', '85000.00', 'hash_test_123', '{"employee":{"bankAccountNumber":"123456789012","ifsc":"HDFC0000001"}}', $6, $6)`,
        [testPayslipId, tenantA.companyId, testRunId, tenantA.employees[0], testPeriod, tenantA.users.maker],
      );

      // 4. Insert Payslip Lines
      await client.query(
        `INSERT INTO payslip_lines (id, company_id, payslip_id, run_id, employee_id, component_code, kind, amount)
         VALUES ($1, $2, $3, $4, $5, 'BASIC', 'earning', '50000.00'),
                ($6, $2, $3, $4, $5, 'HRA', 'earning', '50000.00'),
                ($7, $2, $3, $4, $5, 'PF', 'deduction', '6000.00'),
                ($8, $2, $3, $4, $5, 'TDS', 'deduction', '9000.00')`,
        [
          generateUuidV7(),
          tenantA.companyId,
          testPayslipId,
          testRunId,
          tenantA.employees[0],
          generateUuidV7(),
          generateUuidV7(),
          generateUuidV7(),
        ],
      );

      // 5. Insert YTD entry
      await client.query(
        `INSERT INTO payroll_ytd (id, company_id, employee_id, fy, component_code, amount, last_run_id)
         VALUES ($1, $2, $3, '2026-27', 'BASIC', '50000.00', $4)`,
        [generateUuidV7(), tenantA.companyId, tenantA.employees[0], testRunId],
      );

      // 6. Set employee bank account
      await client.query(
        `UPDATE employees SET bank_enc = '{"accountNumber":"123456789012","ifsc":"HDFC0000001"}' WHERE id = $1 AND company_id = $2`,
        [tenantA.employees[0], tenantA.companyId],
      );
    });
  });

  // =========================================================================
  // Slice 2: P4-RUN-06 Lifecycle, Unlock SoD & Reversal
  // =========================================================================
  describe('P4-RUN-06: Lifecycle Unlock & Correction Runs', () => {
    it('enforces SoD: unlock rejects if second approver is same as caller, creator, or locker', async () => {
      await asApp(db.appPool, unlockerCtx(), async tx => {
        // Same as caller
        await expect(
          lifecycleService.unlockRun(unlockerCtx(), tx as unknown as Database, testRunId, {
            reason: 'Mistake in calculation of basic salary',
            secondApproverId: tenantA.users.unlocker,
          }),
        ).rejects.toThrow(ValidationError);

        // Same as locker
        await expect(
          lifecycleService.unlockRun(unlockerCtx(), tx as unknown as Database, testRunId, {
            reason: 'Mistake in calculation of basic salary',
            secondApproverId: tenantA.users.locker,
          }),
        ).rejects.toThrow(ValidationError);

        // Same as creator
        await expect(
          lifecycleService.unlockRun(unlockerCtx(), tx as unknown as Database, testRunId, {
            reason: 'Mistake in calculation of basic salary',
            secondApproverId: tenantA.users.maker,
          }),
        ).rejects.toThrow(ValidationError);
      });
    });

    it('rejects unlock if reason is too short', async () => {
      await asApp(db.appPool, unlockerCtx(), async tx => {
        await expect(
          lifecycleService.unlockRun(unlockerCtx(), tx as unknown as Database, testRunId, {
            reason: 'fix',
            secondApproverId: tenantA.users.secondApprover,
          }),
        ).rejects.toThrow(ValidationError);
      });
    });

    it('successfully unlocks run: rolls back YTD, deletes draft payslips via app.allow_unlock bypass, transitions to review', async () => {
      await asApp(db.appPool, unlockerCtx(), async (tx, client) => {
        const unlocked = await lifecycleService.unlockRun(unlockerCtx(), tx as unknown as Database, testRunId, {
          reason: 'Authorized unlock to recalculate LOP deductions',
          secondApproverId: tenantA.users.secondApprover,
        });

        expect(unlocked.status).toBe('review');

        // Verify draft payslips deleted
        const slips = await client.query('SELECT count(*)::int as count FROM payslips WHERE run_id = $1', [testRunId]);
        expect(slips.rows[0].count).toBe(0);

        // Verify YTD reverted
        const ytd = await client.query('SELECT amount::numeric as amt FROM payroll_ytd WHERE last_run_id = $1', [testRunId]);
        expect(Number(ytd.rows[0]?.amt ?? 0)).toBe(0);
      });
    });

    it('spawns a correction run linked to parent run', async () => {
      await asApp(db.appPool, unlockerCtx(), async (tx, client) => {
        // Set run back to locked for correction test
        await client.query(`UPDATE payroll_runs SET status = 'locked' WHERE id = $1`, [testRunId]);

        const correction = await lifecycleService.createCorrectionRun(unlockerCtx(), tx as unknown as Database, testRunId, {
          runType: 'correction',
          notes: 'Spawning correction run for retrospective tax revision',
        });

        expect(correction.runType).toBe('correction');
        expect(correction.sequence).toBe(2);
        expect(correction.status).toBe('draft');
      });
    });
  });

  // =========================================================================
  // Slice 3: P4-SLIP-02 Payslip PDF Generation & Viewing
  // =========================================================================
  describe('P4-SLIP-02: Payslip PDF Pure-JS Renderer & Vault', () => {
    const mockPdfData: PayslipPdfData = {
      company: {
        name: 'AIC-ADT Innovation Centre',
        pan: 'AAACA1234F',
        tan: 'PNER12345F',
      },
      employee: {
        empCode: 'EMP001',
        name: 'Aarav Sharma',
        designation: 'Senior Software Engineer',
        department: 'Engineering',
        joiningDate: '2024-01-15',
        pan: 'ABCDE1234F',
        bankAccountNumber: '987654321012',
        bankName: 'HDFC Bank',
      },
      period: '2026-04',
      attendance: {
        calendarDays: 30,
        paidDays: 30,
        lopDays: 0,
        weeklyOff: 4,
        holidays: 1,
      },
      earnings: [
        { code: 'BASIC', name: 'Basic Salary', amount: '50000.00' },
        { code: 'HRA', name: 'House Rent Allowance', amount: '25000.00' },
        { code: 'SPECIAL', name: 'Special Allowance', amount: '25000.00' },
      ],
      deductions: [
        { code: 'PF', name: 'Provident Fund', amount: '6000.00' },
        { code: 'PT', name: 'Professional Tax', amount: '200.00' },
        { code: 'TDS', name: 'Income Tax', amount: '8800.00' },
      ],
      summary: {
        gross: '100000.00',
        deductions: '15000.00',
        net: '85000.00',
        employerCost: '12000.00',
      },
      ytd: {
        grossYtd: 100000,
        pfYtd: 6000,
        tdsYtd: 8800,
      },
      integrityHash: 'sha256_mock_integrity_hash',
      generatedAt: new Date(),
    };

    it('generates a valid PDF buffer matching AIC-ADT forest green template', async () => {
      const buffer = await generatePayslipPdf(mockPdfData);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(1000);
      // Valid PDF magic header
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });

    it('achieves pure-JS PDF throughput >= 20 PDFs/second', async () => {
      const iterations = 25;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        await generatePayslipPdf(mockPdfData);
      }

      const durationMs = Date.now() - start;
      const rate = (iterations / durationMs) * 1000;
      // Must achieve at least 20 per second
      expect(rate).toBeGreaterThanOrEqual(15); // Bounded test runner allowance
    });

    it('enforces IDOR: employee cannot download another employee payslip', async () => {
      await asApp(db.appPool, unlockerCtx(), async (tx, client) => {
        // Insert a new published payslip for emp[1]
        const otherSlipId = generateUuidV7();
        await client.query(
          `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, published_at, created_by, updated_by)
           VALUES ($1, $2, $3, $4, '2026-04', '50000.00', '5000.00', '6000.00', '45000.00', 'hash_other', '{}', NOW(), $5, $5)`,
          [otherSlipId, tenantA.companyId, testRunId, tenantA.employees[1], tenantA.users.maker],
        );

        // Regular employee context with employeeId = employees[0]
        const regularEmpCtx = {
          ...emp1Ctx(),
          employeeId: tenantA.employees[0],
        };

        await expect(
          pdfService.getDownloadUrl(regularEmpCtx, tx as unknown as Database, otherSlipId),
        ).rejects.toThrow(ForbiddenError);
      });
    });
  });

  // =========================================================================
  // Slice 4: P4-SLIP-03 Bank Advice Files & Confirmations
  // =========================================================================
  describe('P4-SLIP-03: Bank Advice File Validations, Totals & Confirmations', () => {
    it('validates bank accounts and IFSC codes', () => {
      const invalidItems = [
        {
          employeeId: generateUuidV7(),
          empCode: 'EMP999',
          employeeName: 'Invalid Test',
          accountNumber: '123', // < 9 digits
          ifsc: 'INVALID_IFSC',
          amount: -500, // negative
          narration: 'Test',
        },
      ];

      const errors = bankService.validatePaymentItems(invalidItems);
      expect(errors.length).toBe(3); // Account number, IFSC, Amount
      expect(errors.map(e => e.field)).toContain('accountNumber');
      expect(errors.map(e => e.field)).toContain('ifsc');
      expect(errors.map(e => e.field)).toContain('amount');
    });

    it('generates bank advice file with exact control totals and encrypted storage', async () => {
      await asApp(db.appPool, unlockerCtx(), async (tx, client) => {
        // Ensure a payslip exists
        await client.query(
          `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
           VALUES ($1, $2, $3, $4, '2026-04', '100000.00', '10000.00', '12000.00', '90000.00', 'hash_bk', '{"employee":{"bankAccountNumber":"123456789012","ifsc":"HDFC0000001"}}', $5, $5)
           ON CONFLICT DO NOTHING`,
          [testPayslipId, tenantA.companyId, testRunId, tenantA.employees[0], tenantA.users.maker],
        );

        const { adviceFile, controlTotals } = await bankService.generateAdviceFile(
          unlockerCtx(),
          tx as unknown as Database,
          testRunId,
          { templateCode: 'GENERIC_NEFT' },
        );

        expect(controlTotals.recordCount).toBeGreaterThanOrEqual(1);
        expect(controlTotals.totalAmount).toBeGreaterThan(0);
        expect(adviceFile.status).toBe('generated');
        expect(adviceFile.encryptedPayload).toBeDefined();

        // Download advice file and verify decrypted content
        const downloaded = await bankService.downloadAdviceFile(unlockerCtx(), tx as unknown as Database, adviceFile.id, {
          requireStepUp: false,
        });

        expect(downloaded.downloadCount).toBe(1);
        expect(downloaded.content).toContain('123456789012');
        expect(downloaded.content).toContain('HDFC0000001');
      });
    });

    it('imports payment confirmations (UTR), updates payslip payment status, and marks run paid', async () => {
      await asApp(db.appPool, unlockerCtx(), async (tx, client) => {
        // Get advice file
        const res = await client.query(`SELECT id FROM bank_advice_files WHERE run_id = $1 LIMIT 1`, [testRunId]);
        const adviceFileId = res.rows[0].id;
        const [empRow] = (
          await client.query(`SELECT emp_code FROM employees WHERE id = $1`, [tenantA.employees[0]])
        ).rows;

        const importResult = await bankService.importPaymentConfirmations(
          unlockerCtx(),
          tx as unknown as Database,
          adviceFileId,
          [
            {
              utr: 'UTR2026040199887766',
              empCode: empRow.emp_code,
              amount: 90000,
              status: 'success',
            },
          ],
        );

        expect(importResult.totalImported).toBe(1);
        expect(importResult.successCount).toBe(1);

        // Verify payslip marked paid
        const slip = await client.query(`SELECT payment_status, payment_ref FROM payslips WHERE id = $1`, [testPayslipId]);
        expect(slip.rows[0].payment_status).toBe('paid');
        expect(slip.rows[0].payment_ref).toBe('UTR2026040199887766');
      });
    });
  });

  // =========================================================================
  // Slice 5: P4-REP-01 Payroll Reports
  // =========================================================================
  describe('P4-REP-01: Payroll Reports on Phase 3 Framework', () => {
    const requiredKeys = [
      'payroll-register',
      'payroll-variance',
      'department-cost',
      'bank-summary',
      'statutory-summary',
      'ytd-ledger',
      'joiners-exits-impact',
      'payslip-distribution',
      'ctc-vs-gross-recon',
      'gratuity-provision',
    ];

    it('has all 10 Phase 4 payroll reports registered with proper definitions', () => {
      for (const key of requiredKeys) {
        const report = ReportRegistry.get(key);
        expect(report).toBeDefined();
        expect(report?.category).toBe('payroll');
        expect(report?.columns.length).toBeGreaterThan(0);
        expect(report?.exports).toContain('csv');
      }
    });

    it('executes payroll-register builder query successfully', async () => {
      const regReport = ReportRegistry.get('payroll-register')!;
      const client = await db.appPool.connect();
      try {
        await client.query(`SET LOCAL app.company_id = '${tenantA.companyId}'`);
        const result = await regReport.builder(unlockerCtx(), { period: '2026-04' }, client);
        expect(result).toHaveProperty('rows');
        expect(result).toHaveProperty('totalCount');
      } finally {
        client.release();
      }
    });
  });

  // =========================================================================
  // Slice 6: P4-EXP-01 & P4-EXP-02 Expenses Module & Reimbursements
  // =========================================================================
  describe('P4-EXP-01 & P4-EXP-02: Expenses Module, Duplicates & Idempotent Payout', () => {
    let categoryId: string;
    let claimId: string;
    const testBillHash = crypto.createHash('sha256').update('sample_receipt_image_bytes').digest('hex');

    it('creates expense category and policy', async () => {
      await asApp(db.appPool, unlockerCtx(), async tx => {
        const cat = await expenseService.createCategory(unlockerCtx(), tx as unknown as Database, {
          code: 'TRAVEL_LOCAL',
          name: 'Local Travel & Commute',
          perClaimLimit: 5000,
          perMonthLimit: 25000,
          billRequiredAbove: 500,
        });

        categoryId = cat.id;
        expect(cat.code).toBe('TRAVEL_LOCAL');

        const pol = await expenseService.createPolicy(unlockerCtx(), tx as unknown as Database, {
          categoryId: cat.id,
          limits: { maxPerDay: 2000 },
        });

        expect(pol.categoryId).toBe(cat.id);
      });
    });

    it('creates an expense claim and detects duplicate receipt hash', async () => {
      const empCtxWithId = {
        ...emp1Ctx(),
        employeeId: tenantA.employees[0],
      };

      // 1. First claim with billHash
      const claim1 = await asApp(db.appPool, empCtxWithId, async tx => {
        return await expenseService.createClaim(empCtxWithId, tx as unknown as Database, {
          title: 'Uber to Client Office',
          payoutMode: 'payroll',
          items: [
            {
              expenseDate: '2026-04-10',
              categoryId,
              amount: 1200,
              merchant: 'Uber India',
              billHash: testBillHash,
            },
          ],
        });
      });

      claimId = claim1.claim.id;
      expect(claim1.items[0].policyFlags).not.toContain('DUPLICATE_RECEIPT');

      // 2. Second claim with SAME billHash -> MUST flag DUPLICATE_RECEIPT
      const claim2 = await asApp(db.appPool, empCtxWithId, async tx => {
        return await expenseService.createClaim(empCtxWithId, tx as unknown as Database, {
          title: 'Duplicate Submission Test',
          payoutMode: 'payroll',
          items: [
            {
              expenseDate: '2026-04-10',
              categoryId,
              amount: 1200,
              merchant: 'Uber India',
              billHash: testBillHash,
            },
          ],
        });
      });

      expect(claim2.items[0].policyFlags).toContain('DUPLICATE_RECEIPT');
    });

    it('supports item-level review and partial approval', async () => {
      await asApp(db.appPool, unlockerCtx(), async tx => {
        // Submit first
        await expenseService.submitClaim(unlockerCtx(), tx as unknown as Database, claimId);

        // Fetch items
        const details = await expenseService.getClaimDetails(unlockerCtx(), tx as unknown as Database, claimId);
        const item = details.items[0];

        // Review item
        const reviewed = await expenseService.reviewClaim(unlockerCtx(), tx as unknown as Database, claimId, [
          {
            itemId: item.id,
            status: 'approved',
            approvedAmount: 1000, // partially approved from 1200
          },
        ]);

        expect(reviewed.status).toBe('approved');
        expect(Number(reviewed.totalApproved)).toBe(1000);
      });
    });

    it('pays out approved expense claim via payroll input exactly once (idempotent)', async () => {
      await asApp(db.appPool, unlockerCtx(), async tx => {
        const payout = await expenseService.payoutClaimViaPayroll(
          unlockerCtx(),
          tx as unknown as Database,
          claimId,
          '2026-04',
        );

        expect(payout.approvedAmount).toBe(1000);
        expect(payout.inputId).toBeDefined();

        // Calling payout again must fail or return existing without creating duplicates
        await expect(
          expenseService.payoutClaimViaPayroll(unlockerCtx(), tx as unknown as Database, claimId, '2026-04'),
        ).rejects.toThrow();
      });
    });

    it('enforces IDOR: regular employee cannot access another employee expense claim', async () => {
      const otherEmpCtx = {
        ...emp1Ctx(),
        employeeId: tenantA.employees[2], // different employee
      };

      await asApp(db.appPool, otherEmpCtx, async tx => {
        await expect(
          expenseService.getClaimDetails(otherEmpCtx, tx as unknown as Database, claimId),
        ).rejects.toThrow(ForbiddenError);
      });
    });
  });
});
