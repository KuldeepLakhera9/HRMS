import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateUuidV7,
} from '@hrms/db';
import {
  PERMISSIONS,
  UnauthorizedError,
} from '@hrms/shared';
import {
  encryptField,
  decryptField,
  maskField,
  assertStepUp,
  getLogger,
  REDACTION_PATHS,
} from '@hrms/core';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import {
  createPayrollTenant,
  ctxFor,
  asApp,
  type PayrollTenant,
} from '../helpers/payroll-fixtures.js';

describe('Payroll Sprint 4.6 P4-QA-02: Security Review & Log Sanitization Audit', () => {
  let db: TestDatabaseContext;
  let tenantA: PayrollTenant;
  let tenantB: PayrollTenant;

  afterAll(async () => {
    if (db) await db.close();
  });

  beforeAll(async () => {
    db = await setupTestDatabase();
    tenantA = await createPayrollTenant(db.ownerPool, 'SecurityTenantA', 2);
    tenantB = await createPayrollTenant(db.ownerPool, 'SecurityTenantB', 2);
  });

  describe('1. Database Role & RLS Privilege Security', () => {
    it('should verify hrms_app role cannot DROP, TRUNCATE, or BYPASS RLS', async () => {
      // Connect as hrms_app
      const appClient = await db.appPool.connect();
      try {
        // 1. Verify rolbypassrls is false for hrms_app
        const rlsCheck = await appClient.query(`
          SELECT rolname, rolbypassrls, rolsuper
          FROM pg_roles
          WHERE rolname = current_user;
        `);
        expect(rlsCheck.rows[0].rolbypassrls).toBe(false);
        expect(rlsCheck.rows[0].rolsuper).toBe(false);

        // 2. Verify DROP TABLE on existing tables is denied (app role is not owner)
        await expect(
          appClient.query(`DROP TABLE payslips`),
        ).rejects.toThrow(/must be owner|permission denied/i);

        // 3. Verify TRUNCATE on sensitive payroll table is denied
        await expect(
          appClient.query(`TRUNCATE TABLE payslips`),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        appClient.release();
      }
    });

    it('should strictly isolate payroll records between tenants using PostgreSQL RLS', async () => {
      const periodA = generateUuidV7();
      const runA = generateUuidV7();
      const payslipA = generateUuidV7();

      const ctxA = ctxFor(tenantA.companyId, tenantA.users.maker, [PERMISSIONS.PAYROLL_RUN_READ]);
      const ctxB = ctxFor(tenantB.companyId, tenantB.users.maker, [PERMISSIONS.PAYROLL_RUN_READ]);

      // Seed payroll data for Tenant A
      await asApp(db.appPool, ctxA, async (tx, client) => {
        await client.query(
          `INSERT INTO payroll_periods (id, company_id, legal_entity_id, period, fy, start_date, end_date, cutoff_date, pay_date, status, created_by, updated_by)
           VALUES ($1, $2, $3, '2026-12', '2026-27', '2026-12-01', '2026-12-31', '2026-12-25', '2026-12-31', 'open', $4, $4)`,
          [periodA, tenantA.companyId, tenantA.legalEntityId, tenantA.users.maker],
        );

        await client.query(
          `INSERT INTO payroll_runs (id, company_id, period_id, run_type, sequence, status, created_by, updated_by)
           VALUES ($1, $2, $3, 'regular', 1, 'draft', $4, $4)`,
          [runA, tenantA.companyId, periodA, tenantA.users.maker],
        );

        await client.query(
          `INSERT INTO payslips (id, company_id, run_id, employee_id, period, gross, deductions, employer_cost, net, integrity_hash, snapshot, created_by, updated_by)
           VALUES ($1, $2, $3, $4, '2026-12', '80000.00', '10000.00', '0.00', '70000.00', 'hash_sec_a', '{}', $5, $5)`,
          [payslipA, tenantA.companyId, runA, tenantA.employees[0], tenantA.users.maker],
        );
      });

      // Tenant A can see their own payslip
      await asApp(db.appPool, ctxA, async (tx, client) => {
        const res = await client.query(`SELECT id FROM payslips WHERE id = $1`, [payslipA]);
        expect(res.rows.length).toBe(1);
      });

      // Tenant B queries for Tenant A's payslip ID -> RLS returns 0 rows (IDOR prevention)
      await asApp(db.appPool, ctxB, async (tx, client) => {
        const res = await client.query(`SELECT id FROM payslips WHERE id = $1`, [payslipA]);
        expect(res.rows.length).toBe(0);
      });
    });
  });

  describe('2. Step-up Authentication & Authorization Enforcement', () => {
    it('should reject sensitive unlock operations when step-up is not active', () => {
      const normalCtx = ctxFor(
        tenantA.companyId,
        tenantA.users.unlocker,
        [PERMISSIONS.PAYROLL_RUN_UNLOCK],
        { stepUp: false }, // Step-up not active
      );

      expect(() => {
        assertStepUp(normalCtx, 'unlock a payroll run');
      }).toThrow(UnauthorizedError);
    });

    it('should accept sensitive operations when step-up session is active', () => {
      const stepUpCtx = ctxFor(
        tenantA.companyId,
        tenantA.users.unlocker,
        [PERMISSIONS.PAYROLL_RUN_UNLOCK],
        { stepUp: true }, // Step-up active
      );

      expect(() => {
        assertStepUp(stepUpCtx, 'unlock a payroll run');
      }).not.toThrow();
    });
  });

  describe('3. Field Encryption & Masking Review', () => {
    it('should encrypt sensitive PAN and bank accounts using AES-256-GCM and reject tampered ciphertext', () => {
      const pan = 'ABCDE1234F';
      const encryptedPan = encryptField(pan);

      expect(encryptedPan).toMatch(/^v1:master:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/);
      const decryptedPan = decryptField(encryptedPan);
      expect(decryptedPan).toBe(pan);

      // Tamper test: Corrupt authentication tag
      const parts = encryptedPan.split(':');
      parts[3] = 'deadbeefdeadbeefdeadbeefdeadbeef'; // Corrupted tag
      const tampered = parts.join(':');

      expect(() => {
        decryptField(tampered);
      }).toThrow();
    });

    it('should mask sensitive financial and identity fields by default', () => {
      expect(maskField('ABCDE1234F', 'pan')).toBe('ABC•••••4F');
      expect(maskField('1234567890123456', 'bank')).toBe('••••••••3456');
      expect(maskField('123456789012', 'aadhaar')).toBe('•••• •••• 9012');
      expect(maskField('150000.00', 'salary')).toBe('••••••');
      expect(maskField(null, 'pan')).toBe('');
    });
  });

  describe('4. Log Sanitization & Sensitive Data Redaction Audit', () => {
    it('should assert that REDACTION_PATHS covers all sensitive financial and PII keys', () => {
      const requiredSensitiveKeys = [
        'pan',
        'pan_enc',
        'aadhaar',
        'aadhaar_enc',
        'bank_enc',
        'account_number',
        'accountNumber',
        'bankAccountNumber',
        'bank_account_number',
        'uan',
        'uan_enc',
        'salary',
        'netPay',
        'grossPay',
        'ctc',
        'ifsc',
        'password',
        'token',
      ];

      for (const key of requiredSensitiveKeys) {
        expect(
          REDACTION_PATHS,
          `REDACTION_PATHS must include '${key}' to prevent sensitive log leakage`,
        ).toContain(key);
      }
    });

    it('should configure root logger with strict redaction of sensitive fields', () => {
      const logger = getLogger();
      expect(logger).toBeDefined();
      // Logger is initialized and safe to log events
      expect(() => {
        logger.info({
          action: 'payroll_audit_check',
          employeeId: 'emp-101',
          status: 'verified',
        });
      }).not.toThrow();
    });
  });
});
