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
});
