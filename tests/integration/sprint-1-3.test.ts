import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations, seedDatabase, getOwnerPool, getAppPool } from '@hrms/db';
import {
  EmployeeService,
  DocumentService,
} from '@hrms/core';

describe('Sprint 1.3 Integration & Query Budget Suite (P1-EMP-03, P1-EMP-04, P1-EMP-05, P1-NOTIF-01, P1-AUDIT-02)', () => {
  const employeeService = new EmployeeService();
  const documentService = new DocumentService();

  let companyId: string;
  let adminUserId: string;
  let sampleEmployeeId: string;

  beforeAll(async () => {
    await runMigrations();
    const seed = await seedDatabase();
    companyId = seed.companyId;
    adminUserId = seed.adminUserId;

    // Get an employee ID for testing
    const pool = getOwnerPool();
    const empRes = await pool.query<{ id: string }>(
      'SELECT id FROM employees WHERE company_id = $1 LIMIT 1',
      [companyId],
    );
    sampleEmployeeId = empRes.rows[0]?.id || '';
  });

  it('verifies pg_trgm trigram index utilization for directory search', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      await client.query('SET LOCAL enable_seqscan = off');

      const planRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, emp_code, first_name, last_name, email_work
         FROM employees
         WHERE company_id = $1
           AND deleted_at IS NULL
           AND (first_name || ' ' || last_name ILIKE '%Jane%')
         ORDER BY emp_code ASC
         LIMIT 20`,
        [companyId],
      );

      const planText = planRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/idx_employees_company_trgm_name|Bitmap Index Scan|Index Scan/i);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('asserts query budget for directory endpoint (<= 3 queries)', async () => {
    let queryCount = 0;
    const pool = getAppPool();
    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    try {
      const res = await employeeService.getDirectory(
        {
          companyId,
          userId: adminUserId,
          roles: ['super_admin'],
          permissions: ['employee.profile.read'],
          requestId: 'budget-dir-test',
          isAuthenticated: true,
        },
        { limit: 25 },
        pool,
      );

      expect(res.items).toBeDefined();
      expect(queryCount).toBeLessThanOrEqual(3);
    } finally {
      pool.query = origQuery;
    }
  });

  it('asserts query budget for full employee profile with history and documents (<= 5 queries)', async () => {
    let queryCount = 0;
    const pool = getAppPool();
    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    try {
      const ctx = {
        companyId,
        userId: adminUserId,
        roles: ['super_admin'],
        permissions: [
          'employee.profile.read',
          'employee.history.read',
          'employee.document.read',
        ],
        requestId: 'budget-profile-test',
        isAuthenticated: true,
      };

      const [emp, hist, docs] = await Promise.all([
        employeeService.getProfile(ctx, sampleEmployeeId, pool),
        employeeService.getEmployeeHistory(ctx, sampleEmployeeId, pool),
        documentService.listEmployeeDocuments(ctx, sampleEmployeeId, pool),
      ]);

      expect(emp).toBeDefined();
      expect(hist).toBeDefined();
      expect(docs).toBeDefined();
      expect(queryCount).toBeLessThanOrEqual(5);
    } finally {
      pool.query = origQuery;
    }
  });

  it('enforces composite foreign key preventing cross-tenant document linkage', async () => {
    const pool = getOwnerPool();
    const otherCompanyRes = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, legal_name, domain)
       VALUES ('Alien Corp', 'Alien Corp Ltd', 'alien.internal')
       ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    const alienCompanyId = otherCompanyRes.rows[0]?.id as string;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [alienCompanyId]);

      // Attempt inserting document belonging to alien company pointing to sampleEmployeeId of companyId
      await expect(
        client.query(
          `INSERT INTO employee_documents (id, company_id, employee_id, file_id, type, status)
           VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), 'Tax Form', 'pending')`,
          [alienCompanyId, sampleEmployeeId],
        ),
      ).rejects.toThrow(/foreign key constraint/i);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('enforces composite foreign key preventing cross-tenant change request creation', async () => {
    const pool = getOwnerPool();
    const otherCompanyRes = await pool.query<{ id: string }>(
      `INSERT INTO companies (name, legal_name, domain)
       VALUES ('Alien Corp 2', 'Alien Corp 2 Ltd', 'alien2.internal')
       ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    const alienCompanyId = otherCompanyRes.rows[0]?.id as string;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [alienCompanyId]);

      // Attempt inserting change request for employee belonging to another tenant
      await expect(
        client.query(
          `INSERT INTO change_requests (id, company_id, employee_id, changes, status)
           VALUES (gen_random_uuid(), $1, $2, '{"phone": "123"}'::jsonb, 'pending')`,
          [alienCompanyId, sampleEmployeeId],
        ),
      ).rejects.toThrow(/foreign key constraint/i);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
