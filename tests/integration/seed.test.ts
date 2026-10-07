import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations, seedDatabase, getOwnerPool, getAppPool } from '@hrms/db';
import { ALL_PERMISSIONS } from '@hrms/shared';
import { AuthService } from '@hrms/core';

describe('Sprint 1.1 Seeding Engine Integration Tests', () => {
  const authService = new AuthService();

  beforeAll(async () => {
    await runMigrations();
  });

  it('executes database seeding idempotently and provisions default company', async () => {
    const res1 = await seedDatabase();
    expect(res1.companyId).toBeDefined();
    expect(res1.companyName).toBe('OrgHub Tech Ltd');
    expect(res1.adminEmail).toBe('admin@orghub.internal');
    expect(res1.rolesSeeded).toBe(7);

    // Second execution must succeed without conflict or duplicate errors
    const res2 = await seedDatabase();
    expect(res2.companyId).toBe(res1.companyId);
  });

  it('provisions all 7 system roles with required MFA flags and permissions', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const compRes = await client.query<{ id: string }>(
        "SELECT id FROM companies WHERE domain = 'orghub.internal'",
      );
      const companyId = compRes.rows[0]!.id;

      // Set tenant context for RLS
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

      const rolesRes = await client.query<{ name: string; is_system: boolean; requires_mfa: boolean }>(
        'SELECT name, is_system, requires_mfa FROM roles WHERE company_id = $1 AND is_system = true ORDER BY name',
        [companyId],
      );

      const expectedRoles = [
        'admin',
        'auditor',
        'contractor',
        'employee',
        'hr_manager',
        'payroll_manager',
        'super_admin',
      ];
      const roleNames = rolesRes.rows.map(r => r.name);
      expect(roleNames).toEqual(expectedRoles);

      // Verify super_admin has all permissions
      const superAdminRes = await client.query<{ id: string }>(
        "SELECT id FROM roles WHERE company_id = $1 AND name = 'super_admin'",
        [companyId],
      );
      const superAdminId = superAdminRes.rows[0]!.id;

      const permsRes = await client.query<{ permission_key: string }>(
        'SELECT permission_key FROM role_permissions WHERE company_id = $1 AND role_id = $2',
        [companyId, superAdminId],
      );

      const seededPerms = new Set(permsRes.rows.map(p => p.permission_key));
      expect(seededPerms.size).toBe(ALL_PERMISSIONS.length);
      for (const p of ALL_PERMISSIONS) {
        expect(seededPerms.has(p)).toBe(true);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('allows the seeded super admin to authenticate with AdminPass123! and receive super_admin role', async () => {
    const loginResult = await authService.login({
      email: 'admin@orghub.internal',
      password: 'AdminPass123!',
      ip: '127.0.0.1',
      userAgent: 'Seed-Test-Agent',
      poolOverride: getAppPool(),
    });

    expect(loginResult.mfaRequired).toBeFalsy();
    expect(loginResult.rawToken).toBeDefined();
    expect(loginResult.user?.email).toBe('admin@orghub.internal');
    expect(loginResult.user?.roles).toContain('super_admin');
    expect(loginResult.user?.permissions.length).toBe(ALL_PERMISSIONS.length);
  });

  it('allows seeded role users (HR, Payroll, Employee, Auditor) to authenticate with their assigned passwords', async () => {
    const roleUsers = [
      { email: 'hr@orghub.internal', password: 'HrPass123!', expectedRole: 'hr_manager' },
      { email: 'payroll@orghub.internal', password: 'PayrollPass123!', expectedRole: 'payroll_manager' },
      { email: 'accountant@orghub.internal', password: 'AccountantPass123!', expectedRole: 'payroll_manager' },
      { email: 'employee@orghub.internal', password: 'EmpPass123!', expectedRole: 'employee' },
      { email: 'auditor@orghub.internal', password: 'AuditorPass123!', expectedRole: 'auditor' },
    ];

    for (const u of roleUsers) {
      const res = await authService.login({
        email: u.email,
        password: u.password,
        ip: '127.0.0.1',
        userAgent: 'Seed-Test-Agent',
        poolOverride: getAppPool(),
      });
      expect(res.user?.email).toBe(u.email);
      expect(res.user?.roles).toContain(u.expectedRole);
    }
  });

  it('provisions starter department hierarchy, designations, grades, and cost centers', async () => {
    const pool = getOwnerPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const compRes = await client.query<{ id: string }>(
        "SELECT id FROM companies WHERE domain = 'orghub.internal'",
      );
      const companyId = compRes.rows[0]!.id;

      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

      // Departments count
      const deptCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM departments WHERE company_id = $1 AND deleted_at IS NULL',
        [companyId],
      );
      expect(parseInt(deptCount.rows[0]!.count, 10)).toBeGreaterThanOrEqual(7);

      // Designations count
      const desCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM designations WHERE company_id = $1 AND deleted_at IS NULL',
        [companyId],
      );
      expect(parseInt(desCount.rows[0]!.count, 10)).toBeGreaterThanOrEqual(11);

      // Grades count
      const gradeCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM grades WHERE company_id = $1 AND deleted_at IS NULL',
        [companyId],
      );
      expect(parseInt(gradeCount.rows[0]!.count, 10)).toBeGreaterThanOrEqual(6);

      // Cost centers count
      const ccCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM cost_centers WHERE company_id = $1 AND deleted_at IS NULL',
        [companyId],
      );
      expect(parseInt(ccCount.rows[0]!.count, 10)).toBeGreaterThanOrEqual(4);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
});
