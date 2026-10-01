import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { generateUuidV7, withTenant } from '@hrms/db';
import { hashPassword } from '@hrms/core';
import { POST as loginRoute } from '../../apps/web/src/app/api/v1/auth/login/route.js';
import { GET as meRoute } from '../../apps/web/src/app/api/v1/auth/me/route.js';
import { POST as logoutRoute } from '../../apps/web/src/app/api/v1/auth/logout/route.js';
import { POST as forgotPasswordRoute } from '../../apps/web/src/app/api/v1/auth/forgot-password/route.js';
import {
  GET as getDepartmentsRoute,
  POST as createDepartmentRoute,
} from '../../apps/web/src/app/api/v1/org/departments/route.js';

describe('Sprint 1.1 API Routes Integration Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  let userId: string;
  const userEmail = `api_route_test_${generateUuidV7()}@test.com`;
  const userPassword = 'TestPassword123!@#';

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyId = await db.createCompany(
      'API Route Test Co',
      `api-test-${generateUuidV7()}.internal`,
    );

    userId = generateUuidV7();
    const pwdHash = await hashPassword(userPassword);

    await withTenant({ companyId }, async (_tx, client) => {
      // Create user
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [userId, companyId, userEmail, pwdHash],
      );

      // Create admin role
      const roleId = generateUuidV7();
      await client.query(
        `INSERT INTO roles (id, company_id, name, is_system)
         VALUES ($1, $2, 'admin', true)`,
        [roleId, companyId],
      );

      // Assign admin role to user
      await client.query(
        `INSERT INTO user_roles (company_id, user_id, role_id)
         VALUES ($1, $2, $3)`,
        [companyId, userId, roleId],
      );

      // Grant all org and auth permissions to admin role
      const permissions = [
        'org.department.read',
        'org.department.manage',
        'org.company.read',
        'auth.user.read',
      ];
      for (const p of permissions) {
        await client.query(
          `INSERT INTO role_permissions (company_id, role_id, permission_key, scope)
           VALUES ($1, $2, $3, 'company')`,
          [companyId, roleId, p],
        );
      }
    }, db.appPool);
  });

  afterAll(async () => {
    await db.close();
  });

  let sessionCookie = '';

  it('POST /api/v1/auth/login succeeds with valid credentials and sets session cookie', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail,
        password: userPassword,
      }),
    });

    const res = await loginRoute(req);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('hrms_session=');
    sessionCookie = setCookie!.split(';')[0]!;

    const body = await res.json() as { success: boolean; user: { email: string } };
    expect(body.success).toBe(true);
    expect(body.user.email).toBe(userEmail);
  });

  it('POST /api/v1/auth/login returns 401 for invalid password without user enumeration', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail,
        password: 'WrongPassword123!',
      }),
    });

    const res = await loginRoute(req);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid email or password.');
  });

  it('GET /api/v1/auth/me resolves session and returns user profile', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/me', {
      method: 'GET',
      headers: {
        cookie: sessionCookie,
      },
    });

    const res = await meRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { user: { id: string; email: string; roles: string[] } };
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe(userEmail);
    expect(body.user.roles).toContain('admin');
  });

  it('GET /api/v1/auth/me returns 401 when no session cookie is supplied', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/me', {
      method: 'GET',
    });

    const res = await meRoute(req);
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/org/departments creates a new department', async () => {
    const deptCode = `DEPT_${generateUuidV7().slice(-4)}`;
    const req = new Request('http://localhost:3000/api/v1/org/departments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        name: 'Finance & Accounts',
        code: deptCode,
      }),
    });

    const res = await createDepartmentRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { name: string; code: string } };
    expect(body.data.name).toBe('Finance & Accounts');
    expect(body.data.code).toBe(deptCode.toUpperCase());
  });

  it('GET /api/v1/org/departments lists company departments', async () => {
    const req = new Request('http://localhost:3000/api/v1/org/departments', {
      method: 'GET',
      headers: {
        cookie: sessionCookie,
      },
    });

    const res = await getDepartmentsRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Array<{ name: string }> };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some(d => d.name === 'Finance & Accounts')).toBe(true);
  });

  it('POST /api/v1/auth/forgot-password safely handles request', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail,
      }),
    });

    const res = await forgotPasswordRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json() as { message: string };
    expect(body.message).toContain('password reset instructions have been dispatched');
  });

  it('POST /api/v1/auth/logout clears session cookie', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
      },
    });

    const res = await logoutRoute(req);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('Max-Age=0');
  });
});
