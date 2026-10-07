import crypto from 'node:crypto';
import type pg from 'pg';
import { withTenant, generateUuidV7, type DrizzleTransaction } from '@hrms/db';
import { PERMISSIONS } from '@hrms/shared';
import type { RequestContext } from '@hrms/core';

/** Short random suffix so every test run uses brand-new tenants and keys on the shared dev DB. */
export const runTag = (): string => crypto.randomBytes(4).toString('hex');

export interface PayrollTenant {
  companyId: string;
  legalEntityId: string;
  structureId: string;
  users: {
    maker: string;
    checker: string;
    locker: string;
    unlocker: string;
    secondApprover: string;
    noUnlockPerm: string;
  };
  employees: string[];
}

const randomPan = (): string =>
  `${crypto.randomBytes(3).toString('hex').toUpperCase().replace(/[0-9]/g, 'A').slice(0, 5).padEnd(5, 'Z')}${String(
    crypto.randomInt(1000, 9999),
  )}Q`;

/**
 * Creates an isolated tenant with users, an unlock-capable role, a legal entity, an approved
 * salary structure and `employeeCount` employees. Fixtures are written by the owner role
 * inside a tenant transaction (Phase 4 policies apply to every role, so app.company_id is set).
 */
export async function createPayrollTenant(
  ownerPool: pg.Pool,
  label: string,
  employeeCount = 8,
): Promise<PayrollTenant> {
  const tag = runTag();
  const companyRes = await ownerPool.query<{ id: string }>(
    `INSERT INTO companies (name, legal_name, domain) VALUES ($1, $1, $2) RETURNING id`,
    [`${label} ${tag}`, `${label.toLowerCase().replace(/\s+/g, '-')}-${tag}.internal`],
  );
  const companyId = companyRes.rows[0]!.id;

  const users = {
    maker: generateUuidV7(),
    checker: generateUuidV7(),
    locker: generateUuidV7(),
    unlocker: generateUuidV7(),
    secondApprover: generateUuidV7(),
    noUnlockPerm: generateUuidV7(),
  };
  const legalEntityId = generateUuidV7();
  const structureId = generateUuidV7();
  const employees = Array.from({ length: employeeCount }, () => generateUuidV7());

  await withTenant(
    { companyId },
    async (_tx, client) => {
      for (const [name, id] of Object.entries(users)) {
        await client.query(
          `INSERT INTO users (id, company_id, email, password_hash, status)
           VALUES ($1, $2, $3, 'not-a-real-hash', 'active')`,
          [id, companyId, `${name}-${tag}@payroll.test`],
        );
      }

      const roleId = generateUuidV7();
      await client.query(
        `INSERT INTO roles (id, company_id, name, description) VALUES ($1, $2, $3, 'test unlock approver')`,
        [roleId, companyId, `test_unlock_${tag}`],
      );
      await client.query(
        `INSERT INTO role_permissions (company_id, role_id, permission_key, scope) VALUES ($1, $2, $3, 'company')`,
        [companyId, roleId, PERMISSIONS.PAYROLL_RUN_UNLOCK],
      );
      await client.query(
        `INSERT INTO user_roles (company_id, user_id, role_id) VALUES ($1, $2, $3)`,
        [companyId, users.secondApprover, roleId],
      );

      await client.query(
        `INSERT INTO legal_entities (id, company_id, name, pan, tan) VALUES ($1, $2, $3, $4, $5)`,
        [legalEntityId, companyId, `${label} Entity`, randomPan(), `TAN${tag}`.toUpperCase()],
      );

      await client.query(
        `INSERT INTO salary_structures (id, company_id, name, version, components, status, created_by, updated_by)
         VALUES ($1, $2, 'TEST_STANDARD', 1, $3::jsonb, 'approved', $4, $4)`,
        [
          structureId,
          companyId,
          JSON.stringify([
            { code: 'BASIC', kind: 'earning', calc: 'formula', formula: 'MONTHLY_CTC * 0.50' },
            { code: 'SPECIAL', kind: 'earning', calc: 'fixed', isBalancing: true },
          ]),
          users.maker,
        ],
      );

      for (const [i, id] of employees.entries()) {
        await client.query(
          `INSERT INTO employees (id, company_id, emp_code, first_name, last_name, email_work, doj, search_key, legal_entity_id)
           VALUES ($1, $2, $3, 'Pay', $4, $5, '2026-01-01', $6, $7)`,
          [id, companyId, `PAY-${tag}-${i}`, `Emp${i}`, `pay${i}-${tag}@payroll.test`, `pay emp${i}`, legalEntityId],
        );
      }
    },
    ownerPool,
  );

  return { companyId, legalEntityId, structureId, users, employees };
}

/** Builds a request context for a fixture user with the given permissions. */
export function ctxFor(
  companyId: string,
  userId: string,
  permissions: string[],
  opts: { stepUp?: boolean; employeeId?: string } = {},
): RequestContext {
  return {
    companyId,
    userId,
    employeeId: opts.employeeId,
    roles: ['test'],
    permissions,
    requestId: `it-${runTag()}`,
    isAuthenticated: true,
    stepUpUntil: opts.stepUp ? new Date(Date.now() + 10 * 60_000) : null,
  };
}

/** Runs `fn` inside a tenant transaction on the non-owner app role (RLS enforced). */
export function asApp<T>(
  appPool: pg.Pool,
  ctx: RequestContext,
  fn: (tx: DrizzleTransaction, client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withTenant(ctx, fn, appPool);
}

/** Settles all promises and returns counts of fulfilled/rejected plus the rejection reasons. */
export async function settle<T>(
  promises: Promise<T>[],
): Promise<{ fulfilled: T[]; rejected: unknown[] }> {
  const results = await Promise.allSettled(promises);
  return {
    fulfilled: results.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === 'fulfilled').map(r => r.value as T),
    rejected: results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason),
  };
}
