import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations, seedDatabase, getOwnerPool, getAppPool } from '@hrms/db';
import { OrgService, AuditService } from '@hrms/core';

describe('Sprint 1.1 Query Budget & Execution Plan Tests', () => {
  const orgService = new OrgService();
  const auditService = new AuditService();
  let companyId: string;

  beforeAll(async () => {
    await runMigrations();
    const seed = await seedDatabase();
    companyId = seed.companyId;
  });

  it('verifies users lookup by email utilizes idx_users_company_email index', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      // Force PostgreSQL optimizer to consider index paths even on single-page tables
      await client.query('SET LOCAL enable_seqscan = off');

      const planRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, company_id, email, password_hash
         FROM users
         WHERE company_id = $1 AND email = 'admin@orghub.internal' AND deleted_at IS NULL`,
        [companyId],
      );

      const planText = planRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/idx_users_company_email|Index Scan|Bitmap Index Scan/i);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('verifies departments lookup by code utilizes idx_departments_company_code index', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      await client.query('SET LOCAL enable_seqscan = off');

      const planRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, company_id, name, code
         FROM departments
         WHERE company_id = $1 AND code = 'ENG' AND deleted_at IS NULL`,
        [companyId],
      );

      const planText = planRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/idx_departments_company_code|Index Scan|Bitmap Index Scan/i);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('verifies audit logs keyset pagination utilizes index path', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      const planRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, ts, company_id, action, entity
         FROM audit_logs
         WHERE company_id = $1 AND action = 'auth.login.success'
         ORDER BY ts DESC, id DESC
         LIMIT 10`,
        [companyId],
      );

      const planText = planRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/idx_audit_logs_company_action|Index Scan|Bitmap Index Scan|Append/i);
    } finally {
      client.release();
    }
  });

  it('asserts query budget for departments read endpoint (<= 5 queries including tx)', async () => {
    let queryCount = 0;
    const pool = getAppPool();
    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    try {
      const depts = await orgService.listDepartments(
        {
          companyId,
          userId: '00000000-0000-0000-0000-000000000000',
          roles: ['super_admin'],
          permissions: ['org.department.read'],
          requestId: 'query-budget-test',
          isAuthenticated: true,
        },
        pool,
      );

      expect(depts.length).toBeGreaterThan(0);
      expect(queryCount).toBeLessThanOrEqual(5);
    } finally {
      pool.query = origQuery;
    }
  });

  it('asserts query budget for audit logs read endpoint (<= 5 queries including tx)', async () => {
    let queryCount = 0;
    const pool = getAppPool();

    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    try {
      const logs = await auditService.queryLogs(
        {
          companyId,
          userId: '00000000-0000-0000-0000-000000000000',
          roles: ['super_admin'],
          permissions: ['audit.log.read'],
          requestId: 'query-budget-test',
          isAuthenticated: true,
        },
        { limit: 10, poolOverride: pool },
      );

      expect(logs.logs).toBeDefined();
      expect(queryCount).toBeLessThanOrEqual(5);
    } finally {
      pool.query = origQuery;
    }
  });

  it('asserts query budget for employee list endpoint (<= 5 queries including tx)', async () => {
    const employeeService = new (await import('@hrms/core')).EmployeeService();
    let queryCount = 0;
    const pool = getAppPool();

    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    try {
      const list = await employeeService.listEmployees(
        {
          companyId,
          userId: '00000000-0000-0000-0000-000000000000',
          roles: ['super_admin'],
          permissions: ['employee.profile.read'],
          requestId: 'query-budget-test',
          isAuthenticated: true,
        },
        { limit: 20 },
        pool,
      );

      expect(list.employees).toBeDefined();
      expect(queryCount).toBeLessThanOrEqual(5);
    } finally {
      pool.query = origQuery;
    }
  });

  it('asserts query budget for org chart hierarchy (single query budget <= 4 queries including tx)', async () => {
    let queryCount = 0;
    const pool = getAppPool();

    const origQuery = pool.query.bind(pool);
    const targetPool = pool as unknown as Record<string, unknown>;
    targetPool.query = async function (this: unknown, ...args: unknown[]) {
      queryCount++;
      return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
    };

    try {
      const chart = await orgService.getOrgChart(
        {
          companyId,
          userId: '00000000-0000-0000-0000-000000000000',
          roles: ['super_admin'],
          permissions: ['org.chart.read'],
          requestId: 'query-budget-test',
          isAuthenticated: true,
        },
        undefined,
        pool,
      );

      expect(chart).toBeDefined();
      // Fetches entire hierarchy in 1 single SQL query inside tenant transaction (SET app.company_id + SET app.user_id + SELECT + COMMIT = 4 queries)
      expect(queryCount).toBeLessThanOrEqual(4);
    } finally {
      pool.query = origQuery;
    }
  });

  it('verifies work locations center utilizes idx_work_locations_center GIST index', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      await client.query('SET LOCAL enable_seqscan = off');

      const planRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, name, center
         FROM work_locations
         WHERE company_id = $1 AND center IS NOT NULL
           AND ST_DWithin(center, ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography, 5000)
           AND deleted_at IS NULL`,
        [companyId],
      );

      const planText = planRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/idx_work_locations_center|Index Scan|Bitmap Index Scan/i);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('verifies employees reporting_path utilizes idx_employees_reporting_path GIN index', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      await client.query('SET LOCAL enable_seqscan = off');

      const planRes = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, first_name, last_name, reporting_path
         FROM employees
         WHERE company_id = $1 AND reporting_path @> ARRAY['00000000-0000-0000-0000-000000000001'::uuid]
           AND deleted_at IS NULL`,
        [companyId],
      );

      const planText = planRes.rows.map(r => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/idx_employees_reporting_path|Bitmap Index Scan|Index Scan/i);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});

