import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateUuidV7,
} from '@hrms/db';
import {
  PERMISSIONS,
} from '@hrms/shared';
import {
  TaxDeclarationService,
  StatutoryFilingService,
  StatutoryRulesService,
  OpeningBalanceService,
  ReconciliationService,
} from '@hrms/core';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import {
  createPayrollTenant,
  ctxFor,
  asApp,
  type PayrollTenant,
} from '../helpers/payroll-fixtures.js';

describe('Payroll Sprint 4.5 Integration Tests (P4-TAX-01, P4-TAX-02, P4-RULES-03, P4-RECON-01)', () => {
  let db: TestDatabaseContext;
  let tenantA: PayrollTenant;

  const taxService = new TaxDeclarationService();
  const statutoryService = new StatutoryFilingService();
  const rulesService = new StatutoryRulesService();
  const openingBalanceService = new OpeningBalanceService();
  const reconService = new ReconciliationService();

  let testPeriodId: string;
  let testRunId: string;
  let testPayslipId1: string;
  let testPayslipId2: string;
  const testPeriod = '2026-04';

  const financeCtx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.unlocker,
      [
        PERMISSIONS.TAX_DECLARATION_SUBMIT,
        PERMISSIONS.TAX_DECLARATION_VERIFY,
        PERMISSIONS.TAX_REGIME_COMPARE,
        PERMISSIONS.PAYROLL_STATUTORY_GENERATE,
        PERMISSIONS.PAYROLL_STATUTORY_DOWNLOAD,
        PERMISSIONS.PAYROLL_RULES_READ,
        PERMISSIONS.PAYROLL_RULES_MANAGE,
        PERMISSIONS.PAYROLL_RULES_APPROVE,
        PERMISSIONS.PAYROLL_SETTINGS_READ,
        PERMISSIONS.PAYROLL_SETTINGS_MANAGE,
        PERMISSIONS.PAYROLL_RECON_MANAGE,
        PERMISSIONS.PAYROLL_RECON_SIGNOFF,
        PERMISSIONS.PAYROLL_RUN_READ,
      ],
      { stepUp: true },
    );

  const emp1Ctx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.maker,
      [
        PERMISSIONS.TAX_DECLARATION_SUBMIT,
        PERMISSIONS.TAX_REGIME_COMPARE,
      ],
      { employeeId: tenantA.employees[0] },
    );

  const _emp2Ctx = () =>
    ctxFor(
      tenantA.companyId,
      tenantA.users.checker,
      [
        PERMISSIONS.TAX_DECLARATION_SUBMIT,
        PERMISSIONS.TAX_REGIME_COMPARE,
      ],
      { employeeId: tenantA.employees[1] },
    );

  beforeAll(async () => {
    db = await setupTestDatabase();

    // Ensure permissions and RLS policies on sprint 4.5 tables
    await db.ownerPool.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON deduction_catalog, tax_declarations, tax_declaration_items, statutory_filings, payroll_opening_balances, recon_cycles, recon_imports, recon_diffs TO hrms_app;
      DROP POLICY IF EXISTS tenant_isolation_policy ON deduction_catalog;
      CREATE POLICY tenant_isolation_policy ON deduction_catalog FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON tax_declarations;
      CREATE POLICY tenant_isolation_policy ON tax_declarations FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON tax_declaration_items;
      CREATE POLICY tenant_isolation_policy ON tax_declaration_items FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON statutory_filings;
      CREATE POLICY tenant_isolation_policy ON statutory_filings FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON payroll_opening_balances;
      CREATE POLICY tenant_isolation_policy ON payroll_opening_balances FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON recon_cycles;
      CREATE POLICY tenant_isolation_policy ON recon_cycles FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON recon_imports;
      CREATE POLICY tenant_isolation_policy ON recon_imports FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_isolation_policy ON recon_diffs;
      CREATE POLICY tenant_isolation_policy ON recon_diffs FOR ALL TO PUBLIC USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
    `);

    tenantA = await createPayrollTenant(db.ownerPool, 'Sprint 4.5 Tenant', 5);

    testPeriodId = generateUuidV7();
    testRunId = generateUuidV7();
    testPayslipId1 = generateUuidV7();
    testPayslipId2 = generateUuidV7();

    await asApp(db.appPool, financeCtx(), async (tx, client) => {
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

      // 3. Insert Payslips & Lines
      const emp1Id = tenantA.employees[0];
      const emp2Id = tenantA.employees[1];

      await client.query(
        `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, '100000.00', '12000.00', '115000.00', '88000.00', 'hash_test_1',
         '{"employee":{"name":"Employee 1","uan":"100912345678"},"attendance":{"paidDays":30,"lopDays":1},"lines":[{"code":"BASIC","amount":"50000.00","kind":"earning"},{"code":"EPF","amount":"1800.00","kind":"deduction"},{"code":"TDS","amount":"10000.00","kind":"deduction"}]}', $6, $6)`,
        [testPayslipId1, tenantA.companyId, testRunId, emp1Id, testPeriod, tenantA.users.maker],
      );

      await client.query(
        `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, '80000.00', '8000.00', '92000.00', '72000.00', 'hash_test_2',
         '{"employee":{"name":"Employee 2","uan":"100987654321"},"attendance":{"paidDays":31,"lopDays":0},"lines":[{"code":"BASIC","amount":"40000.00","kind":"earning"},{"code":"EPF","amount":"1800.00","kind":"deduction"},{"code":"ESI","amount":"600.00","kind":"deduction"}]}', $6, $6)`,
        [testPayslipId2, tenantA.companyId, testRunId, emp2Id, testPeriod, tenantA.users.maker],
      );

      await client.query(
        `INSERT INTO payslip_lines (id, company_id, payslip_id, run_id, employee_id, component_code, kind, amount, taxable_amount, sort_order)
         VALUES
          (gen_random_uuid(), $1, $2, $3, $4, 'BASIC', 'earning', '50000.00', '0.00', 0),
          (gen_random_uuid(), $1, $2, $3, $4, 'EPF', 'deduction', '1800.00', '0.00', 1),
          (gen_random_uuid(), $1, $2, $3, $4, 'TDS', 'deduction', '10000.00', '0.00', 2),
          (gen_random_uuid(), $1, $2, $3, $4, 'PT', 'deduction', '200.00', '0.00', 3),
          (gen_random_uuid(), $1, $5, $3, $6, 'BASIC', 'earning', '40000.00', '0.00', 0),
          (gen_random_uuid(), $1, $5, $3, $6, 'EPF', 'deduction', '1800.00', '0.00', 1),
          (gen_random_uuid(), $1, $5, $3, $6, 'ESI', 'deduction', '600.00', '0.00', 2),
          (gen_random_uuid(), $1, $5, $3, $6, 'PT', 'deduction', '200.00', '0.00', 3)`,
        [tenantA.companyId, testPayslipId1, testRunId, emp1Id, testPayslipId2, emp2Id],
      );

      // 4. Seed Statutory Rule Sets for tenant
      await client.query(
        `INSERT INTO statutory_rule_sets (id, company_id, key, version, jurisdiction, effective_from, status, maker_id, payload, test_cases, created_by, updated_by)
         VALUES
          (gen_random_uuid(), $1, 'TDS_IN', 1, 'IN', '2026-04-01', 'active', $2, $3::jsonb, '[]'::jsonb, $2, $2),
          (gen_random_uuid(), $1, 'PF_IN', 1, 'IN', '2026-04-01', 'active', $2, $4::jsonb, '[]'::jsonb, $2, $2),
          (gen_random_uuid(), $1, 'FORM_LABELS', 1, 'IN', '2026-04-01', 'active', $2, $5::jsonb, '[]'::jsonb, $2, $2)`,
        [
          tenantA.companyId,
          tenantA.users.maker,
          JSON.stringify({
            financialYear: '2026-2027',
            regimes: {
              new: {
                standardDeduction: 75000,
                allowedDeductions: [],
                taxSlabs: [
                  { minIncome: 0, maxIncome: 400000, ratePct: 0 },
                  { minIncome: 400000, maxIncome: 800000, ratePct: 5 },
                  { minIncome: 800000, maxIncome: 1200000, ratePct: 10 },
                  { minIncome: 1200000, maxIncome: 1600000, ratePct: 15 },
                  { minIncome: 1600000, maxIncome: 2000000, ratePct: 20 },
                  { minIncome: 2000000, maxIncome: 2400000, ratePct: 25 },
                  { minIncome: 2400000, maxIncome: null, ratePct: 30 },
                ],
                rebate: { thresholdTaxableIncome: 1200000, maxRebateAmount: 60000, marginalReliefEnabled: true },
                surchargeSlabs: [],
                healthAndEducationCessPct: 4,
              },
              old: {
                standardDeduction: 50000,
                allowedDeductions: ['80C', '80D', '80CCD_1B', '24B'],
                taxSlabs: [
                  { minIncome: 0, maxIncome: 250000, ratePct: 0 },
                  { minIncome: 250000, maxIncome: 500000, ratePct: 5 },
                  { minIncome: 500000, maxIncome: 1000000, ratePct: 20 },
                  { minIncome: 1000000, maxIncome: null, ratePct: 30 },
                ],
                rebate: { thresholdTaxableIncome: 500000, maxRebateAmount: 12500, marginalReliefEnabled: true },
                surchargeSlabs: [],
                healthAndEducationCessPct: 4,
              },
            },
          }),
          JSON.stringify({
            employeeRatePct: 12,
            employerEpsRatePct: 8.33,
            employerEpfRatePct: 3.67,
            edliRatePct: 0.5,
            adminChargeRatePct: 0.5,
            wageCeilingMonthly: 15000,
            allowContributeOnActual: false,
            allowVpf: true,
            roundingMode: 'half_up',
            ecrFileFormatVersion: '2.0',
            ncpDaysRule: 'lop_only',
          }),
          JSON.stringify({
            forms: {
              quarterlyTdsReturn: 'Form 138 (Income-tax Act 2025)',
              annualCertificate: 'Form 130',
            },
          }),
        ],
      );
    });
  });

  // -------------------------------------------------------------
  // P4-TAX-01: Tax Declarations & Regime Compare
  // -------------------------------------------------------------
  describe('P4-TAX-01: Tax Declarations & Regime Compare', () => {
    it('should save draft declaration, submit, and verify line items', async () => {
      await asApp(db.appPool, emp1Ctx(), async tx => {
        const emp1Id = tenantA.employees[0];
        const { declaration, items } = await taxService.saveDraftDeclaration(emp1Ctx(), tx, {
          employeeId: emp1Id,
          fy: '2026-2027',
          regime: 'old',
          hraDetails: { monthlyRent: 25000, cityType: 'metro', landlordName: 'Kishore Kumar' },
          items: [
            { deductionCode: '80C', amountDeclared: 150000, notes: 'PPF receipt attached' },
            { deductionCode: '80D', amountDeclared: 35000, notes: 'Family health insurance' },
          ],
        });

        expect(declaration.status).toBe('draft');
        expect(declaration.regime).toBe('old');
        expect(items.length).toBe(2);

        // Submit declaration
        const submitted = await taxService.submitDeclaration(emp1Ctx(), tx, declaration.id);
        expect(submitted.status).toBe('submitted');
      });

      // Finance verifies items
      await asApp(db.appPool, financeCtx(), async tx => {
        const emp1Id = tenantA.employees[0];
        const { declaration, items } = await taxService.getDeclaration(financeCtx(), tx, emp1Id, '2026-2027');
        expect(declaration).toBeDefined();

        const verifiedItem = await taxService.verifyDeclarationItem(financeCtx(), tx, items[0].id, {
          proofStatus: 'verified',
          amountVerified: 150000,
          notes: 'Verified against bank stamp',
        });
        expect(verifiedItem.proofStatus).toBe('verified');
        expect(verifiedItem.amountVerified).toBe('150000.00');

        // Verify second item with partial approval
        await taxService.verifyDeclarationItem(financeCtx(), tx, items[1].id, {
          proofStatus: 'verified',
          amountVerified: 25000,
          notes: 'Excess ₹10,000 dis-allowed',
        });

        const { declaration: refreshedDecl } = await taxService.getDeclaration(financeCtx(), tx, emp1Id, '2026-2027');
        expect(refreshedDecl?.status).toBe('verified');
      });
    });

    it('should prevent IDOR: employee cannot access other employee tax declaration', async () => {
      await asApp(db.appPool, emp1Ctx(), async tx => {
        const emp2Id = tenantA.employees[1];
        await expect(
          taxService.getDeclaration(emp1Ctx(), tx, emp2Id, '2026-2027'),
        ).rejects.toThrow('You can only view or manage your own tax declarations');
      });
    });

    it('should compute regime comparison consistent with engine output', async () => {
      await asApp(db.appPool, emp1Ctx(), async tx => {
        const comp = await taxService.compareRegimes(emp1Ctx(), tx, {
          grossAnnual: 1800000,
          deductions: { '80C': 150000, '80D': 25000 },
        });

        expect(comp).toHaveProperty('recommendedRegime');
        expect(comp).toHaveProperty('annualTaxSavings');
        expect(Number(comp.annualTaxSavings)).toBeGreaterThan(0);
      });
    });
  });

  // -------------------------------------------------------------
  // P4-TAX-02: Statutory Outputs from Locked Runs
  // -------------------------------------------------------------
  describe('P4-TAX-02: Statutory Outputs from Locked Runs', () => {
    it('should generate PF ECR text file in official #~# delimited 11-column format', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const result = await statutoryService.generatePfEcr(financeCtx(), tx, testRunId);
        expect(result.recordCount).toBe(2);
        expect(result.filing.type).toBe('PF_ECR');
        expect(result.filing.reconciledWithRun).toBe(true);

        const firstLine = result.fileContent.split('\n')[0];
        const cols = firstLine.split('#~#');
        expect(cols.length).toBe(11);
        expect(['100912345678', '100987654321']).toContain(cols[0]); // UAN
        expect(Number(cols[6])).toBe(1800);   // EPF amount
      });
    });

    it('should generate ESI contribution records and reconcile with payslip lines', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const result = await statutoryService.generateEsiContribution(financeCtx(), tx, testRunId);
        expect(result.records.length).toBe(1);
        expect(result.records[0].ipContribution).toBe(600);
        expect(result.filing.reconciledWithRun).toBe(true);
      });
    });

    it('should generate PT multi-state summary', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const result = await statutoryService.generatePtSummary(financeCtx(), tx, testRunId);
        expect(result.summaries.length).toBeGreaterThan(0);
        expect(Number(result.totalPt)).toBe(400); // 200 + 200
      });
    });

    it('should generate quarterly TDS return data using FORM_LABELS', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const result = await statutoryService.generateTdsReturnData(financeCtx(), tx, testRunId);
        expect(result.formLabel).toContain('Form 138');
        expect(Number(result.totalTds)).toBe(10000);
      });
    });

    it('should link challan payment reference to filing', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const { filing } = await statutoryService.generatePfEcr(financeCtx(), tx, testRunId);

        const linked = await statutoryService.linkChallan(financeCtx(), tx, filing.id, {
          challanReference: 'CHALLAN-EPF-2026-03-001',
          challanDate: '2026-04-12',
          challanAmount: '3600.00',
          notes: 'HDFC Corporate NetBanking payment confirmation UTR 998877',
        });

        expect(linked.status).toBe('filed_by_ca');
        expect(linked.challanReference).toBe('CHALLAN-EPF-2026-03-001');
      });
    });
  });

  // -------------------------------------------------------------
  // P4-RULES-03: Statutory Rules Governance, Impact Preview & Diff
  // -------------------------------------------------------------
  describe('P4-RULES-03: Rules Governance & Impact Preview', () => {
    it('should preview cost impact of candidate rule change on sample employees', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const candidate = await rulesService.createDraftRuleSet(financeCtx(), tx, {
          key: 'PF_IN',
          jurisdiction: 'IN',
          effectiveFrom: '2026-05-01',
          payload: {
            employeeRatePct: 14,
            employerEpsRatePct: 8.33,
            employerEpfRatePct: 3.67,
            edliRatePct: 0.5,
            adminChargeRatePct: 0.5,
            wageCeilingMonthly: 15000,
            allowContributeOnActual: false,
            allowVpf: true,
            roundingMode: 'half_up',
            ecrFileFormatVersion: '2.0',
            ncpDaysRule: 'lop_only',
          },
        });

        const impact = await rulesService.previewRuleImpact(financeCtx(), tx, candidate.id, 5);
        expect(impact.candidateVersion).toBe(candidate.version);
        expect(impact.sampleCount).toBeGreaterThan(0);
        expect(Number(impact.deltaNetPayTotal)).toBeLessThan(0);
      });
    });

    it('should execute attached test cases and detect failures', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const ruleWithTests = await rulesService.createDraftRuleSet(financeCtx(), tx, {
          key: 'PF_IN',
          jurisdiction: 'IN',
          effectiveFrom: '2026-06-01',
          payload: {
            employeeRatePct: 12,
            employerEpsRatePct: 8.33,
            employerEpfRatePct: 3.67,
            edliRatePct: 0.5,
            adminChargeRatePct: 0.5,
            wageCeilingMonthly: 15000,
            allowContributeOnActual: false,
            allowVpf: true,
            roundingMode: 'half_up',
            ecrFileFormatVersion: '2.0',
            ncpDaysRule: 'lop_only',
          },
          testCases: [
            { field: 'employeeRatePct', expectedValue: 12 },
            { field: 'wageCeilingMonthly', expectedValue: 20000 },
          ],
        });

        const testResult = await rulesService.runAttachedTestCases(financeCtx(), tx, ruleWithTests.id);
        expect(testResult.passed).toBe(false);
        expect(testResult.failures.length).toBe(1);
        expect(testResult.failures[0].reason).toContain('wageCeilingMonthly');
      });
    });

    it('should alert on expiring statutory rule sets', async () => {
      await asApp(db.appPool, financeCtx(), async tx => {
        const expiring = await rulesService.getExpiringRules(financeCtx(), tx, 60);
        expect(Array.isArray(expiring)).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------
  // Opening Balances YTD Import Wizard
  // -------------------------------------------------------------
  describe('Opening Balances YTD Import Wizard', () => {
    it('should validate, preview, confirm, and revert opening balance job atomically', async () => {
      await asApp(db.appPool, financeCtx(), async (tx, client) => {
        // Find actual employee number
        const emp1Id = tenantA.employees[0];
        const res = await client.query('SELECT emp_code FROM employees WHERE id = $1', [emp1Id]);
        const empCode = res.rows[0].emp_code;

        // 1. Preview
        const preview = await openingBalanceService.validateAndPreview(financeCtx(), tx, [
          {
            empCode,
            fy: '2026-2027',
            asOfPeriod: '2026-06',
            componentCode: 'BASIC',
            amount: 150000,
            tdsDeducted: 18000,
          },
        ]);

        expect(preview.validRows).toBe(1);
        expect(preview.errorRows).toBe(0);
        expect(preview.totals.grossEarnings).toBe('150000.00');

        // 2. Confirm Import
        const importResult = await openingBalanceService.confirmImport(financeCtx(), tx, [
          {
            employeeId: emp1Id,
            empCode,
            fy: '2026-2027',
            asOfPeriod: '2026-06',
            componentCode: 'BASIC',
            amount: 150000,
            tdsDeducted: 18000,
          },
        ]);

        expect(importResult.importedCount).toBe(1);
        expect(importResult.importJobId).toBeDefined();

        // 3. Revert Import
        const revertResult = await openingBalanceService.revertImport(financeCtx(), tx, importResult.importJobId);
        expect(revertResult.revertedCount).toBe(1);
      });
    });
  });

  // -------------------------------------------------------------
  // P4-RECON-01: Parallel-Run Reconciliation Tool
  // -------------------------------------------------------------
  describe('P4-RECON-01: Parallel-Run Reconciliation Tool', () => {
    it('should import legacy output, categorize diffs, and enforce dual sign-off', async () => {
      await asApp(db.appPool, financeCtx(), async (tx, client) => {
        const emp1Id = tenantA.employees[0];
        const res = await client.query('SELECT emp_code FROM employees WHERE id = $1', [emp1Id]);
        const empCode = res.rows[0].emp_code;

        // 1. Create Recon Cycle
        const cycle = await reconService.createCycle(financeCtx(), tx, {
          period: testPeriod,
          runId: testRunId,
          tolerance: 1.0,
        });

        expect(cycle.status).toBe('open');

        // 2. Import Legacy Output (exact match for BASIC, variance for TDS)
        const importResult = await reconService.importAndCompare(financeCtx(), tx, cycle.id, {
          filename: 'legacy_payroll_mar2026.csv',
          columnMapping: {
            'Basic Pay': 'BASIC',
            'TDS Tax': 'TDS',
          },
          rows: [
            {
              empCode,
              'Basic Pay': 50000,
              'TDS Tax': 10500, // variance of -500
            },
          ],
        });

        expect(importResult.comparedEmployees).toBe(1);
        expect(importResult.summary.openDiffs).toBe(1);

        // 3. Diff should be in open status
        const diffs = await reconService.getCycleDiffs(financeCtx(), tx, cycle.id);
        expect(diffs.length).toBe(1);
        expect(diffs[0].status).toBe('open');

        // 4. Try sign-off while open diffs exist -> should be rejected!
        await expect(
          reconService.signoffCycle(financeCtx(), tx, cycle.id, 'ca'),
        ).rejects.toThrow('Cannot sign off: There are 1 unexplained variances');

        // 5. Add explanation to open diff
        await reconService.explainDiff(financeCtx(), tx, diffs[0].id, {
          explanation: 'Legacy system applied 50k standard deduction instead of 75k under new regime',
          category: 'rule_difference',
          status: 'explained',
        });

        // 6. CA signs off
        const caSigned = await reconService.signoffCycle(financeCtx(), tx, cycle.id, 'ca');
        expect(caSigned.signedByCa).toBeDefined();
        expect(caSigned.status).toBe('in_review');

        // 7. Finance signs off
        const fullySigned = await reconService.signoffCycle(financeCtx(), tx, cycle.id, 'finance');
        expect(fullySigned.signedByFinance).toBeDefined();
        expect(fullySigned.status).toBe('signed');
      });
    });
  });
});
