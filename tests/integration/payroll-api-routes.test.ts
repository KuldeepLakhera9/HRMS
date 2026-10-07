import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import { generateUuidV7, withTenant } from '@hrms/db';
import { createSession, setStepUp } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';
import { createPayrollTenant, type PayrollTenant } from '../helpers/payroll-fixtures.js';

// Route handlers under test
import { GET as getSalaryRoute } from '../../apps/web/src/app/api/v1/payroll/salary/employees/[id]/route.js';
import { POST as previewRevisionRoute } from '../../apps/web/src/app/api/v1/payroll/revisions/preview/route.js';
import { POST as createRevisionRoute } from '../../apps/web/src/app/api/v1/payroll/revisions/route.js';
import { POST as approveRevisionRoute } from '../../apps/web/src/app/api/v1/payroll/revisions/[id]/approve/route.js';
import { GET as listInputsRoute, POST as createInputRoute } from '../../apps/web/src/app/api/v1/payroll/inputs/route.js';
import { POST as approveInputRoute } from '../../apps/web/src/app/api/v1/payroll/inputs/[id]/approve/route.js';
import { POST as rejectInputRoute } from '../../apps/web/src/app/api/v1/payroll/inputs/[id]/reject/route.js';
import { GET as listLoansRoute, POST as createLoanRoute } from '../../apps/web/src/app/api/v1/payroll/loans/route.js';
import { POST as generateEmiRoute } from '../../apps/web/src/app/api/v1/payroll/loans/emi-inputs/route.js';
import { GET as listPeriodsRoute, POST as createPeriodRoute } from '../../apps/web/src/app/api/v1/payroll/periods/route.js';
import { GET as listRunsRoute, POST as createRunRoute } from '../../apps/web/src/app/api/v1/payroll/runs/route.js';
import { POST as transitionRunRoute } from '../../apps/web/src/app/api/v1/payroll/runs/[id]/transition/route.js';
import { POST as regimeCompareRoute } from '../../apps/web/src/app/api/v1/payroll/tds/regime-compare/route.js';

describe('Payroll Sprint 4.2 API Routes & Permission Matrix Tests', () => {
  let db: TestDatabaseContext;
  let tenant: PayrollTenant;
  let makerToken: string;
  let checkerToken: string;
  let unauthorizedToken: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    tenant = await createPayrollTenant(db.ownerPool, 'API Route Tenant', 5);

    // Setup roles & permissions for maker and checker
    await withTenant({ companyId: tenant.companyId }, async (_tx, client) => {
      // Maker role
      const makerRoleId = generateUuidV7();
      await client.query(`INSERT INTO roles (id, company_id, name, is_system) VALUES ($1, $2, 'test_maker', false)`, [makerRoleId, tenant.companyId]);
      const makerPerms = [
        PERMISSIONS.PAYROLL_SALARY_VIEW,
        PERMISSIONS.PAYROLL_SALARY_ASSIGN,
        PERMISSIONS.PAYROLL_INPUT_READ,
        PERMISSIONS.PAYROLL_INPUT_CREATE,
        PERMISSIONS.PAYROLL_LOAN_READ,
        PERMISSIONS.PAYROLL_LOAN_MANAGE,
        PERMISSIONS.PAYROLL_RUN_READ,
        PERMISSIONS.PAYROLL_RUN_CREATE,
        PERMISSIONS.PAYROLL_RUN_CALCULATE,
      ];
      for (const p of makerPerms) {
        await client.query(`INSERT INTO role_permissions (company_id, role_id, permission_key, scope) VALUES ($1, $2, $3, 'company')`, [tenant.companyId, makerRoleId, p]);
      }
      await client.query(`INSERT INTO user_roles (company_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenant.companyId, tenant.users.maker, makerRoleId]);

      // Checker role (with step-up auth capability)
      const checkerRoleId = generateUuidV7();
      await client.query(`INSERT INTO roles (id, company_id, name, is_system) VALUES ($1, $2, 'test_checker', false)`, [checkerRoleId, tenant.companyId]);
      const checkerPerms = [
        PERMISSIONS.PAYROLL_SALARY_VIEW,
        PERMISSIONS.PAYROLL_SALARY_APPROVE,
        PERMISSIONS.PAYROLL_INPUT_READ,
        PERMISSIONS.PAYROLL_INPUT_APPROVE,
        PERMISSIONS.PAYROLL_RUN_READ,
        PERMISSIONS.PAYROLL_RUN_REVIEW,
        PERMISSIONS.PAYROLL_RUN_APPROVE,
        PERMISSIONS.PAYROLL_RUN_LOCK,
        PERMISSIONS.PAYROLL_RUN_PUBLISH,
      ];
      for (const p of checkerPerms) {
        await client.query(`INSERT INTO role_permissions (company_id, role_id, permission_key, scope) VALUES ($1, $2, $3, 'company')`, [tenant.companyId, checkerRoleId, p]);
      }
      await client.query(`INSERT INTO user_roles (company_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenant.companyId, tenant.users.checker, checkerRoleId]);

      // Seed approved salary assignment for employee 0
      const salaryId = generateUuidV7();
      await client.query(
        `INSERT INTO employee_salary (
          id, company_id, employee_id, structure_id, structure_version,
          ctc_annual, effective_from, status, maker_id, checker_id, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, 1, 600000.00, '2026-01-01', 'approved', $5, $5, $5, $5)`,
        [salaryId, tenant.companyId, tenant.employees[0], tenant.structureId, tenant.users.checker],
      );
    }, db.ownerPool);

    // Create session tokens in Redis
    const makerSession = await createSession({
      companyId: tenant.companyId,
      userId: tenant.users.maker,
      mfaVerified: true,
      poolOverride: db.ownerPool,
    });
    makerToken = makerSession.rawToken;
    await setStepUp(makerSession.sessionId, 900, db.ownerPool);

    const checkerSession = await createSession({
      companyId: tenant.companyId,
      userId: tenant.users.checker,
      mfaVerified: true,
      poolOverride: db.ownerPool,
    });
    checkerToken = checkerSession.rawToken;
    await setStepUp(checkerSession.sessionId, 900, db.ownerPool);

    const unauthSession = await createSession({
      companyId: tenant.companyId,
      userId: tenant.users.noUnlockPerm,
      mfaVerified: false,
      poolOverride: db.ownerPool,
    });
    unauthorizedToken = unauthSession.rawToken;
  });

  afterAll(async () => {
    await db.close();
  });

  function authHeaders(token: string) {
    return {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    };
  }

  // 1. Employee Salary View API
  it('GET /api/v1/payroll/salary/employees/:id supports masked and unmasked salary view with step-up', async () => {
    const empId = tenant.employees[0]!;

    // Masked view
    const maskedReq = new Request(`http://localhost:3000/api/v1/payroll/salary/employees/${empId}`, {
      method: 'GET',
      headers: authHeaders(makerToken),
    });
    const maskedRes = await getSalaryRoute(maskedReq, { params: Promise.resolve({ id: empId }) });
    expect(maskedRes.status).toBe(200);
    const maskedBody = (await maskedRes.json()) as { data: { ctcAnnual: string } };
    expect(maskedBody.data.ctcAnnual).toBe('••••••');

    // Unmasked view
    const unmaskedReq = new Request(`http://localhost:3000/api/v1/payroll/salary/employees/${empId}?unmask=true`, {
      method: 'GET',
      headers: authHeaders(makerToken),
    });
    const unmaskedRes = await getSalaryRoute(unmaskedReq, { params: Promise.resolve({ id: empId, unmask: 'true' }) });
    expect(unmaskedRes.status).toBe(200);
    const unmaskedBody = (await unmaskedRes.json()) as { data: { ctcAnnual: string } };
    expect(unmaskedBody.data.ctcAnnual).toBe('600000.00');
  });

  // 2. Revisions preview, create & approve
  it('POST /api/v1/payroll/revisions/preview returns cost impact preview', async () => {
    const req = new Request('http://localhost:3000/api/v1/payroll/revisions/preview', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        effectiveFrom: '2026-07-01',
        currentPeriod: '2026-10',
        items: [{ employeeId: tenant.employees[0]!, newCtcAnnual: '720000.00' }],
      }),
    });

    const res = await previewRevisionRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { totalEmployees: number } };
    expect(body.data.totalEmployees).toBe(1);
  });

  it('POST /api/v1/payroll/revisions creates draft batch and blocks unauthorized user', async () => {
    const unauthBatchId = generateUuidV7();
    // Unauthorized call returns 403
    const unauthReq = new Request('http://localhost:3000/api/v1/payroll/revisions', {
      method: 'POST',
      headers: authHeaders(unauthorizedToken),
      body: JSON.stringify({
        batchId: unauthBatchId,
        effectiveFrom: '2026-07-01',
        items: [{ employeeId: tenant.employees[0]!, newCtcAnnual: '720000.00' }],
      }),
    });
    const unauthRes = await createRevisionRoute(unauthReq);
    expect(unauthRes.status).toBe(403);

    // Authorized call returns 200
    const batchId = generateUuidV7();
    const req = new Request('http://localhost:3000/api/v1/payroll/revisions', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        batchId,
        effectiveFrom: '2026-07-01',
        items: [{ employeeId: tenant.employees[0]!, newCtcAnnual: '720000.00' }],
      }),
    });
    const res = await createRevisionRoute(req);
    expect(res.status).toBe(200);
    const createdRevision = (await res.json()) as { data: { id: string; status: string } };
    expect(createdRevision.data.status).toBe('draft');

    // Approve batch as checker
    const approveReq = new Request(`http://localhost:3000/api/v1/payroll/revisions/${createdRevision.data.id}/approve`, {
      method: 'POST',
      headers: authHeaders(checkerToken),
      body: JSON.stringify({ id: createdRevision.data.id, currentPeriod: '2026-10' }),
    });
    const approveRes = await approveRevisionRoute(approveReq, { params: Promise.resolve({ id: createdRevision.data.id }) });
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as { data: { batch: { status: string }; arrearsGenerated: number } };
    expect(approveBody.data.batch.status).toBe('applied');
  });

  // 3. Inputs list, create, approve, reject
  it('GET and POST /api/v1/payroll/inputs enforces input permissions and workflow', async () => {
    // Create input as maker
    const createReq = new Request('http://localhost:3000/api/v1/payroll/inputs', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        employeeId: tenant.employees[1]!,
        type: 'bonus',
        amount: '2500.00',
        forPeriod: '2026-10',
        note: 'Festive bonus',
      }),
    });
    const createRes = await createInputRoute(createReq);
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { data: { id: string; status: string } };
    expect(created.data.status).toBe('pending');

    // List inputs as maker
    const listReq = new Request('http://localhost:3000/api/v1/payroll/inputs?forPeriod=2026-10', {
      method: 'GET',
      headers: authHeaders(makerToken),
    });
    const listRes = await listInputsRoute(listReq);
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { data: { items: Array<{ id: string }> } };
    expect(listed.data.items.length).toBeGreaterThanOrEqual(1);

    // Approve input as checker
    const approveReq = new Request(`http://localhost:3000/api/v1/payroll/inputs/${created.data.id}/approve`, {
      method: 'POST',
      headers: authHeaders(checkerToken),
      body: JSON.stringify({ id: created.data.id }),
    });
    const approveRes = await approveInputRoute(approveReq, { params: Promise.resolve({ id: created.data.id }) });
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()) as { data: { status: string } };
    expect(approved.data.status).toBe('approved');

    // Create a 2nd input and reject it
    const createReq2 = new Request('http://localhost:3000/api/v1/payroll/inputs', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        employeeId: tenant.employees[1]!,
        type: 'adjustment',
        amount: '500.00',
        forPeriod: '2026-10',
        note: 'Correction request',
      }),
    });
    const createRes2 = await createInputRoute(createReq2);
    const created2 = (await createRes2.json()) as { data: { id: string } };

    const rejectReq = new Request(`http://localhost:3000/api/v1/payroll/inputs/${created2.data.id}/reject`, {
      method: 'POST',
      headers: authHeaders(checkerToken),
      body: JSON.stringify({ id: created2.data.id, reason: 'Duplicate' }),
    });
    const rejectRes = await rejectInputRoute(rejectReq, { params: Promise.resolve({ id: created2.data.id }) });
    expect(rejectRes.status).toBe(200);
    const rejected = (await rejectRes.json()) as { data: { status: string } };
    expect(rejected.data.status).toBe('cancelled');
  });

  // 4. Loans API & EMI input generation
  it('POST /api/v1/payroll/loans creates loan and GET lists it, generates EMI inputs', async () => {
    const createReq = new Request('http://localhost:3000/api/v1/payroll/loans', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        employeeId: tenant.employees[2]!,
        principal: '6000.00',
        installmentsCount: 3,
        startPeriod: '2026-10',
      }),
    });
    const createRes = await createLoanRoute(createReq);
    expect(createRes.status).toBe(200);

    const listReq = new Request(`http://localhost:3000/api/v1/payroll/loans?employeeId=${tenant.employees[2]}`, {
      method: 'GET',
      headers: authHeaders(makerToken),
    });
    const listRes = await listLoansRoute(listReq);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: Array<{ principal: string }> };
    expect(listBody.data.length).toBeGreaterThanOrEqual(1);

    // Generate EMI inputs for 2026-10
    const emiReq = new Request('http://localhost:3000/api/v1/payroll/loans/emi-inputs', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({ period: '2026-10' }),
    });
    const emiRes = await generateEmiRoute(emiReq);
    expect(emiRes.status).toBe(200);
    const emiBody = (await emiRes.json()) as { data: { inputsGenerated: number } };
    expect(emiBody.data.inputsGenerated).toBeGreaterThanOrEqual(1);
  });

  // 5. Periods & Runs API with transition
  it('manages periods and runs via API endpoints and tests transition guard', async () => {
    // Create period
    const createPeriodReq = new Request('http://localhost:3000/api/v1/payroll/periods', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        legalEntityId: tenant.legalEntityId,
        period: '2026-09',
        fy: '2026-2027',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        cutoffDate: '2026-09-25',
        payDate: '2026-09-30',
      }),
    });
    const periodRes = await createPeriodRoute(createPeriodReq);
    expect(periodRes.status).toBe(200);
    const periodData = (await periodRes.json()) as { data: { id: string } };

    // List periods
    const listPeriodReq = new Request(`http://localhost:3000/api/v1/payroll/periods?legalEntityId=${tenant.legalEntityId}`, {
      method: 'GET',
      headers: authHeaders(makerToken),
    });
    const listPeriodRes = await listPeriodsRoute(listPeriodReq);
    expect(listPeriodRes.status).toBe(200);
    const listPeriodData = (await listPeriodRes.json()) as { data: Array<{ period: string }> };
    expect(listPeriodData.data.some(p => p.period === '2026-09')).toBe(true);

    // Create run
    const createRunReq = new Request('http://localhost:3000/api/v1/payroll/runs', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        periodId: periodData.data.id,
      }),
    });
    const runRes = await createRunRoute(createRunReq);
    expect(runRes.status).toBe(200);
    const runData = (await runRes.json()) as { data: { id: string; status: string } };
    expect(runData.data.status).toBe('draft');

    // List runs
    const listRunReq = new Request(`http://localhost:3000/api/v1/payroll/runs?periodId=${periodData.data.id}`, {
      method: 'GET',
      headers: authHeaders(makerToken),
    });
    const listRunRes = await listRunsRoute(listRunReq);
    expect(listRunRes.status).toBe(200);
    const listRunData = (await listRunRes.json()) as { data: Array<{ id: string }> };
    expect(listRunData.data.length).toBe(1);

    // Transition run: draft -> inputs_ready (with skipAttendanceLockCheck)
    const transitionReadyReq = new Request(`http://localhost:3000/api/v1/payroll/runs/${runData.data.id}/transition`, {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        id: runData.data.id,
        toStatus: 'inputs_ready',
        skipAttendanceLockCheck: true,
      }),
    });
    const transitionReadyRes = await transitionRunRoute(transitionReadyReq, { params: Promise.resolve({ id: runData.data.id }) });
    expect(transitionReadyRes.status).toBe(200);
    const transitionedReady = (await transitionReadyRes.json()) as { data: { status: string } };
    expect(transitionedReady.data.status).toBe('inputs_ready');

    // Transition run: inputs_ready -> calculating
    const transitionCalcReq = new Request(`http://localhost:3000/api/v1/payroll/runs/${runData.data.id}/transition`, {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        id: runData.data.id,
        toStatus: 'calculating',
      }),
    });
    const transitionCalcRes = await transitionRunRoute(transitionCalcReq, { params: Promise.resolve({ id: runData.data.id }) });
    expect(transitionCalcRes.status).toBe(200);
    const transitionedCalc = (await transitionCalcRes.json()) as { data: { status: string } };
    expect(transitionedCalc.data.status).toBe('calculating');
  });

  // 6. TDS Regime Comparison API
  it('POST /api/v1/payroll/tds/regime-compare calculates regime comparison', async () => {
    const req = new Request('http://localhost:3000/api/v1/payroll/tds/regime-compare', {
      method: 'POST',
      headers: authHeaders(makerToken),
      body: JSON.stringify({
        annualEarnings: '1200000.00',
        verifiedDeductions: { '80C': '150000.00', '80D': '25000.00' },
      }),
    });

    const res = await regimeCompareRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { recommendedRegime: string; annualTaxSavings: string } };
    expect(body.data).toBeDefined();
    expect(['new', 'old']).toContain(body.data.recommendedRegime);
  });
});

