import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getAppPool, getOwnerPool, runMigrations, generateUuidV7 } from '@hrms/db';
import { EmployeeService, type RequestContext } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 1.2 P1-EMP-01 & P1-EMP-02: Employee Master & Reporting Hierarchy Tests', () => {
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  let employeeService: EmployeeService;

  let tenantACompanyId: string;
  let tenantBCompanyId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    ownerPool = getOwnerPool();
    await runMigrations(ownerPool);
    appPool = getAppPool();
    employeeService = new EmployeeService();

    tenantACompanyId = generateUuidV7();
    tenantBCompanyId = generateUuidV7();
    userAId = generateUuidV7();
    userBId = generateUuidV7();

    // Create companies
    await ownerPool.query(
      `INSERT INTO companies (id, name, legal_name, domain)
       VALUES ($1, 'Emp Corp A', 'Emp Corp A Ltd', 'emp-a.internal'),
              ($2, 'Emp Corp B', 'Emp Corp B Ltd', 'emp-b.internal')`,
      [tenantACompanyId, tenantBCompanyId],
    );

    // Create users
    await ownerPool.query(
      `INSERT INTO users (id, company_id, email, password_hash, status)
       VALUES ($1, $2, 'admin@emp-a.internal', 'hash', 'active'),
              ($3, $4, 'admin@emp-b.internal', 'hash', 'active')`,
      [userAId, tenantACompanyId, userBId, tenantBCompanyId],
    );
  });

  afterAll(async () => {
    await ownerPool.query('DELETE FROM employee_history WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM employees WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM counters WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM users WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM companies WHERE id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
  });

  function createContext(
    companyId: string,
    userId: string,
    permissions: string[] = [],
    stepUpActive = false,
  ): RequestContext {
    return {
      companyId,
      userId,
      sessionId: generateUuidV7(),
      roles: ['super_admin'],
      permissions,
      stepUpUntil: stepUpActive ? new Date(Date.now() + 15 * 60 * 1000) : null,
      requestId: generateUuidV7(),
      isAuthenticated: true,
    };
  }

  // --------------------------------------------------------------------------
  // P1-EMP-01: Master Creation, Sequence, Encryption & Masking
  // --------------------------------------------------------------------------
  it('creates employees with atomic emp_code sequence, AES encryption, and blind indexed PAN', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.EMPLOYEE_PROFILE_CREATE,
      PERMISSIONS.EMPLOYEE_PROFILE_READ,
      PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE,
    ]);

    // 1. Create first employee
    const emp1 = await employeeService.createEmployee(
      ctx,
      {
        firstName: 'Vikram',
        lastName: 'Patel',
        emailWork: 'vikram.patel@emp-a.internal',
        doj: '2024-01-15',
        pan: 'ABCDE1234F',
        aadhaar: '123456789012',
        bankAccount: '987654321098',
      },
      appPool,
    );

    expect(emp1.empCode).toBe('EMP-00001');
    expect(emp1.fullName).toBe('Vikram Patel');
    expect(emp1.pan).toBe('XXXXXX234F'); // Masked by default (last 4 chars of ABCDE1234F)
    expect(emp1.aadhaar).toBe('XXXXXXXX9012'); // Masked by default
    expect(emp1.bankAccount).toBe('XXXXXXXX1098'); // Masked by default
    expect(emp1.reportingPath).toEqual([]);

    // 2. Create second employee under emp1 (hierarchy)
    const emp2 = await employeeService.createEmployee(
      ctx,
      {
        firstName: 'Ananya',
        lastName: 'Rao',
        emailWork: 'ananya.rao@emp-a.internal',
        doj: '2024-02-01',
        managerId: emp1.id,
        pan: 'PQRSX9876Z',
      },
      appPool,
    );

    expect(emp2.empCode).toBe('EMP-00002');
    expect(emp2.managerId).toBe(emp1.id);
    expect(emp2.reportingPath).toEqual([emp1.id]);

    // 3. Duplicate PAN rejection via blind index
    await expect(
      employeeService.createEmployee(
        ctx,
        {
          firstName: 'Duplicate',
          lastName: 'PAN',
          emailWork: 'dup@emp-a.internal',
          doj: '2024-03-01',
          pan: 'ABCDE1234F', // Duplicate of emp1
        },
        appPool,
      ),
    ).rejects.toThrow('Employee with PAN already exists');

    // 4. Step-up elevation required for sensitive fields unmasking
    // A: Without step up -> rejected
    const ctxNoStepUp = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE,
    ], false);
    await expect(employeeService.getSensitiveFields(ctxNoStepUp, emp1.id, appPool)).rejects.toThrow(
      'Step-up authentication is required',
    );

    // B: With step up -> unmasked
    const ctxStepUp = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE,
    ], true);
    const sensitive = await employeeService.getSensitiveFields(ctxStepUp, emp1.id, appPool);
    expect(sensitive.pan).toBe('ABCDE1234F');
    expect(sensitive.aadhaar).toBe('123456789012');
    expect(sensitive.bankAccount).toBe('987654321098');
  });

  // --------------------------------------------------------------------------
  // P1-EMP-02: Reporting Hierarchy, Cycle Rejection & Atomic Subtree Updates
  // --------------------------------------------------------------------------
  it('enforces cycle detection, self-manager prevention, and executes atomic subtree re-parenting', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.EMPLOYEE_PROFILE_CREATE,
      PERMISSIONS.EMPLOYEE_PROFILE_READ,
      PERMISSIONS.EMPLOYEE_PROFILE_UPDATE,
    ]);

    // Hierarchy structure:
    // Root -> NodeA -> NodeB -> NodeC
    const root = await employeeService.createEmployee(
      ctx,
      { firstName: 'CEO', lastName: 'Boss', emailWork: 'ceo@emp-a.internal', doj: '2024-01-01' },
      appPool,
    );
    const nodeA = await employeeService.createEmployee(
      ctx,
      { firstName: 'VP', lastName: 'Alpha', emailWork: 'vp@emp-a.internal', doj: '2024-01-01', managerId: root.id },
      appPool,
    );
    const nodeB = await employeeService.createEmployee(
      ctx,
      { firstName: 'Director', lastName: 'Beta', emailWork: 'dir@emp-a.internal', doj: '2024-01-01', managerId: nodeA.id },
      appPool,
    );
    const nodeC = await employeeService.createEmployee(
      ctx,
      { firstName: 'Lead', lastName: 'Gamma', emailWork: 'lead@emp-a.internal', doj: '2024-01-01', managerId: nodeB.id },
      appPool,
    );

    expect(nodeC.reportingPath).toEqual([root.id, nodeA.id, nodeB.id]);

    // 1. Self manager rejection
    await expect(
      employeeService.changeJob(
        ctx,
        nodeA.id,
        { field: 'managerId', newValue: nodeA.id, effectiveFrom: '2024-01-01' },
        appPool,
      ),
    ).rejects.toThrow('An employee cannot be their own manager');

    // 2. Cycle detection: Attempting to make nodeC the manager of nodeA
    await expect(
      employeeService.changeJob(
        ctx,
        nodeA.id,
        { field: 'managerId', newValue: nodeC.id, effectiveFrom: '2024-01-01' },
        appPool,
      ),
    ).rejects.toThrow('Cycle detected');

    // 3. Atomic subtree update: Move nodeA directly under root (bypassing any intermediate)
    // Now make nodeB report directly to root!
    // Subtree: nodeB and nodeC should both have their reporting_path updated!
    await employeeService.changeJob(
      ctx,
      nodeB.id,
      { field: 'managerId', newValue: root.id, effectiveFrom: '2024-01-01' },
      appPool,
    );

    // Verify nodeB reporting_path is now [root.id]
    const updatedNodeB = await employeeService.getEmployee(ctx, nodeB.id, appPool);
    expect(updatedNodeB.managerId).toBe(root.id);
    expect(updatedNodeB.reportingPath).toEqual([root.id]);

    // Verify descendant nodeC reporting_path was atomically updated to [root.id, nodeB.id]!
    const updatedNodeC = await employeeService.getEmployee(ctx, nodeC.id, appPool);
    expect(updatedNodeC.reportingPath).toEqual([root.id, nodeB.id]);
  });

  // --------------------------------------------------------------------------
  // Effective-Dated Job Changes & Scheduled Daily Worker Job
  // --------------------------------------------------------------------------
  it('applies immediate job changes and queues future-dated changes for daily scheduled execution', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.EMPLOYEE_PROFILE_CREATE,
      PERMISSIONS.EMPLOYEE_PROFILE_READ,
      PERMISSIONS.EMPLOYEE_PROFILE_UPDATE,
      PERMISSIONS.EMPLOYEE_HISTORY_READ,
    ]);

    const emp = await employeeService.createEmployee(
      ctx,
      { firstName: 'Rohan', lastName: 'Verma', emailWork: 'rohan@emp-a.internal', doj: '2024-01-01', status: 'probation' },
      appPool,
    );

    // 1. Immediate change: Effective today -> applied immediately
    const today = new Date().toISOString().slice(0, 10);
    const immRes = await employeeService.changeJob(
      ctx,
      emp.id,
      { field: 'status', newValue: 'active', effectiveFrom: today, reason: 'Completed probation' },
      appPool,
    );
    expect(immRes.applied).toBe(true);

    const empAfterImm = await employeeService.getEmployee(ctx, emp.id, appPool);
    expect(empAfterImm.status).toBe('active');

    // 2. Future-dated change: Effective in 30 days -> scheduled (applied = false)
    const futureDate = '2099-01-01';
    const futRes = await employeeService.changeJob(
      ctx,
      emp.id,
      { field: 'status', newValue: 'notice', effectiveFrom: futureDate, reason: 'Resignation accepted' },
      appPool,
    );
    expect(futRes.applied).toBe(false);

    // Employee status is STILL 'active'
    const empBeforeFuture = await employeeService.getEmployee(ctx, emp.id, appPool);
    expect(empBeforeFuture.status).toBe('active');

    // Check history timeline has 3 entries: creation, probation confirmation, and scheduled notice
    const history = await employeeService.getEmployeeHistory(ctx, emp.id, appPool);
    expect(history.length).toBe(3);

    // 3. Run scheduled worker job for futureDate -> applies scheduled notice change
    const workerRes = await employeeService.applyScheduledChanges(ctx, futureDate, appPool);
    expect(workerRes.appliedCount).toBeGreaterThanOrEqual(1);

    // Employee status is now updated to 'notice'
    const empAfterWorker = await employeeService.getEmployee(ctx, emp.id, appPool);
    expect(empAfterWorker.status).toBe('notice');
  });

  // --------------------------------------------------------------------------
  // Directory Search & Keyset Pagination
  // --------------------------------------------------------------------------
  it('searches employees with trigram search_key and enforces keyset pagination', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [PERMISSIONS.EMPLOYEE_PROFILE_READ]);

    const results = await employeeService.listEmployees(ctx, { query: 'Rohan' }, appPool);
    expect(results.employees.length).toBeGreaterThanOrEqual(1);
    expect(results.employees.some(e => e.firstName === 'Rohan')).toBe(true);

    // Keyset pagination limit
    const page1 = await employeeService.listEmployees(ctx, { limit: 2 }, appPool);
    expect(page1.employees.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await employeeService.listEmployees(ctx, { limit: 2, cursor: page1.nextCursor }, appPool);
    expect(page2.employees.length).toBeGreaterThanOrEqual(1);
    expect(page2.employees[0]!.id).not.toBe(page1.employees[0]!.id);
  });
});
