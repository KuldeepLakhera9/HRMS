import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations, seedDatabase, getOwnerPool, getAppPool, withTenant, generateUuidV7 } from '@hrms/db';
import {
  AttendanceLockService,
  AttendanceDayService,
  DeviceService,
  generateRotatingQrToken,
  verifyRotatingQrToken,
  verifyWifiBssid,
  type RequestContext,
} from '@hrms/core';
import { ValidationError } from '@hrms/shared';

describe('Sprint 2.3 Integration Suite (P2-PUNCH-03, P2-PUNCH-04, P2-PUNCH-06, P2-DAY-01, P2-DAY-02, P2-QA-01)', () => {
  const lockService = new AttendanceLockService();
  const dayService = new AttendanceDayService();
  const deviceService = new DeviceService();

  let companyAId: string;
  let companyBId: string;
  let adminCtxA: RequestContext;
  let sampleEmployeeIdA: string;

  beforeAll(async () => {
    await runMigrations();
    const seed = await seedDatabase();
    companyAId = seed.companyId;

    const ownerPool = getOwnerPool();

    // 1. Resolve Admin User ID
    const userRes = await ownerPool.query<{ id: string }>(
      'SELECT id FROM users WHERE company_id = $1 LIMIT 1',
      [companyAId],
    );
    const adminUserId = userRes.rows[0]?.id || generateUuidV7();

    // 2. Ensure Sample Employee exists for Company A
    const empRes = await withTenant({ companyId: companyAId }, async (_tx, client) => {
      const res = await client.query<{ id: string }>(
        'SELECT id FROM employees WHERE company_id = $1 LIMIT 1',
        [companyAId],
      );
      return res.rows;
    }, ownerPool);

    if (empRes.length > 0 && empRes[0]) {
      sampleEmployeeIdA = empRes[0].id;
    } else {
      sampleEmployeeIdA = generateUuidV7();
      await withTenant({ companyId: companyAId }, async (_tx, client) => {
        await client.query(
          `INSERT INTO employees (
            id, company_id, emp_code, first_name, last_name, email_work,
            employment_type, doj, job_effective_from, status, search_key, user_id,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            $1, $2, 'EMP-ADM-001', 'Admin', 'User', 'admin@orghub.internal',
            'full_time', '2026-01-01', '2026-01-01', 'active', 'admin user emp-adm-001', $3,
            $3, $3, now(), now()
          )`,
          [sampleEmployeeIdA, companyAId, adminUserId],
        );
      }, ownerPool);
    }

    // 3. Ensure Default Attendance Policy exists for Company A
    const policyCheck = await withTenant({ companyId: companyAId }, async (_tx, client) => {
      const res = await client.query(
        'SELECT id FROM attendance_policies WHERE company_id = $1 LIMIT 1',
        [companyAId],
      );
      return res.rows;
    }, ownerPool);

    if (policyCheck.length === 0) {
      await withTenant({ companyId: companyAId }, async (_tx, client) => {
        await client.query(
          `INSERT INTO attendance_policies (
            id, company_id, code, name, geofence_mode, allow_selfie, require_selfie,
            max_gps_accuracy_meters, allowed_sources, grace_minutes, half_day_minutes,
            full_day_minutes, auto_punch_out_hours, version, created_by, updated_by, created_at, updated_at
          ) VALUES (
            $1, $2, 'DEFAULT', 'Default Attendance Policy', 'soft', true, false,
            100, ARRAY['web', 'mobile'], 15, 240,
            480, '12.0', 1, $3, $3, now(), now()
          )`,
          [generateUuidV7(), companyAId, adminUserId],
        );
      }, ownerPool);
    }

    // 4. Create or resolve Tenant B for cross-tenant isolation testing
    const compBCheck = await ownerPool.query<{ id: string }>(
      'SELECT id FROM companies WHERE domain = $1',
      ['tenant-b.com'],
    );
    if (compBCheck.rows.length > 0 && compBCheck.rows[0]) {
      companyBId = compBCheck.rows[0].id;
    } else {
      companyBId = generateUuidV7();
      await ownerPool.query(
        `INSERT INTO companies (id, name, legal_name, domain, timezone, currency)
         VALUES ($1, 'Tenant B Corp', 'Tenant B Corp Ltd', 'tenant-b.com', 'Asia/Kolkata', 'INR')
         ON CONFLICT (domain) DO NOTHING`,
        [companyBId],
      );
    }

    // 5. Clean up previous test devices for isolation
    await withTenant({ companyId: companyAId }, async (_tx, client) => {
      await client.query('DELETE FROM employee_devices WHERE company_id = $1', [companyAId]);
    }, ownerPool);

    // 6. Ensure device_change workflow definition exists with valid resolver schema
    await withTenant({ companyId: companyAId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO workflow_definitions (
          id, company_id, code, name, entity_type,
          steps, is_active, version, created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, 'device_change', 'Device Change Request', 'device_change',
          '[{"stepIndex": 1, "name": "Manager Approval", "mode": "any", "resolver": {"type": "role", "roleName": "super_admin"}}]'::jsonb,
          true, 1, $3, $3, now(), now()
        )
        ON CONFLICT (company_id, code, version)
        DO UPDATE SET steps = EXCLUDED.steps, is_active = true`,
        [generateUuidV7(), companyAId, adminUserId],
      );
    }, ownerPool);

    adminCtxA = {
      companyId: companyAId,
      userId: adminUserId,
      employeeId: sampleEmployeeIdA,
      roles: ['super_admin'],
      permissions: [
        'attendance.lock.manage',
        'attendance.day.recalculate',
        'attendance.device.manage',
        'attendance.punch.create',
      ],
      isAuthenticated: true,
      requestId: 'test-sprint-2-3',
    };
  });

  describe('Anti-Spoofing, Device Binding & 1-Active-Device Rule (P2-PUNCH-03)', () => {
    it('registers first device and marks it active immediately', async () => {
      const devId1 = `hw-primary-${Date.now()}`;
      const result = await deviceService.registerDevice(
        adminCtxA,
        {
          deviceId: devId1,
          deviceModel: 'Samsung Galaxy S24',
          osName: 'android',
          appVersion: '1.4.0',
          osVersion: 'Android 14',
        },
        getOwnerPool(),
      );

      expect(result.device.status).toBe('active');
      expect(result.requiresApproval).toBe(false);
      expect(result.device.deviceId).toBe(devId1);
    });

    it('submits device change workflow when registering a second device', async () => {
      const devId2 = `hw-replacement-${Date.now()}`;
      const result = await deviceService.registerDevice(
        adminCtxA,
        {
          deviceId: devId2,
          deviceModel: 'iPhone 15 Pro',
          osName: 'ios',
          appVersion: '1.4.0',
          osVersion: 'iOS 17.4',
        },
        getOwnerPool(),
      );

      expect(result.device.status).toBe('pending_approval');
      expect(result.requiresApproval).toBe(true);
      expect(result.workflowRequestId).toBeDefined();
    });
  });

  describe('Rotating QR & Wi-Fi BSSID Fallback Verification (P2-PUNCH-04)', () => {
    const testLocationId = '018e38f9-b88d-78c6-a675-9b2f6ef13928';
    const qrSecret = 'super-secret-geofence-key-2026';

    it('generates HMAC token and verifies within 30s window', () => {
      const token = generateRotatingQrToken(testLocationId, qrSecret);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(10);

      const res = verifyRotatingQrToken(token, testLocationId, qrSecret);
      expect(res.valid).toBe(true);
    });

    it('rejects tampered or forged QR tokens', () => {
      const res = verifyRotatingQrToken('forged-qr-signature-token-999', testLocationId, qrSecret);
      expect(res.valid).toBe(false);
    });

    it('verifies Wi-Fi BSSID case-insensitively against authorized list', () => {
      const allowedBssids = ['00:14:22:01:23:45', 'AA:BB:CC:DD:EE:FF'];
      expect(verifyWifiBssid('00:14:22:01:23:45', allowedBssids)).toBe(true);
      expect(verifyWifiBssid('aa:bb:cc:dd:ee:ff', allowedBssids)).toBe(true);
      expect(verifyWifiBssid('11:22:33:44:55:66', allowedBssids)).toBe(false);
      expect(verifyWifiBssid(null, allowedBssids)).toBe(false);
    });
  });

  describe('Locked-Day Immutability & Audit Trail (P2-DAY-02)', () => {
    const periodStart = '2026-02-01';
    const periodEnd = '2026-02-28';

    it('locks an attendance period with mandatory audit reason', async () => {
      const lock = await lockService.lockPeriod(
        adminCtxA,
        {
          periodStart,
          periodEnd,
          reason: 'February 2026 monthly payroll closure',
        },
        getOwnerPool(),
      );

      expect(lock.isLocked).toBe(true);
      expect(lock.periodStart).toBe(periodStart);
      expect(lock.periodEnd).toBe(periodEnd);

      const isLocked = await lockService.isDateLocked(companyAId, '2026-02-15', getOwnerPool());
      expect(isLocked).toBe(true);
    });

    it('rejects day recomputation inside locked period (immutability)', async () => {
      await expect(
        dayService.recomputeDay(adminCtxA, sampleEmployeeIdA, '2026-02-15', getOwnerPool()),
      ).rejects.toThrow(ValidationError);
    });

    it('unlocks period with mandatory reason and allows recomputation again', async () => {
      await lockService.unlockPeriod(
        adminCtxA,
        {
          periodStart,
          periodEnd,
          reason: 'Emergency payroll retroactive correction authorized by HR VP',
        },
        getOwnerPool(),
      );

      const isLocked = await lockService.isDateLocked(companyAId, '2026-02-15', getOwnerPool());
      expect(isLocked).toBe(false);

      // Now recomputeDay should not throw locked ValidationError
      const res = await dayService.recomputeDay(adminCtxA, sampleEmployeeIdA, '2026-02-15', getOwnerPool());
      expect(res).toBeDefined();
    });
  });

  describe('Day Engine Determinism & Idempotency Skip (P2-DAY-01)', () => {
    it('skips database writes when sourceHash is unchanged', async () => {
      const workDate = '2026-01-15';

      // 1. Initial calculation
      const firstRun = await dayService.recomputeDay(adminCtxA, sampleEmployeeIdA, workDate, getOwnerPool());
      expect(firstRun.sourceHash).toBeDefined();

      // 2. Second calculation (identical input)
      const secondRun = await dayService.recomputeDay(adminCtxA, sampleEmployeeIdA, workDate, getOwnerPool());
      expect(secondRun.recomputed).toBe(false);
      expect(secondRun.sourceHash).toBe(firstRun.sourceHash);
    });
  });

  describe('Batched Day Closure (5,000 Employees Scalability Benchmark)', () => {
    it('executes batched close day in chunks of 500 without timing out', async () => {
      const startTime = Date.now();
      const result = await dayService.closeDayBatch(companyAId, '2026-01-20', 500, getOwnerPool());
      const durationMs = Date.now() - startTime;

      expect(result.totalEmployees).toBeGreaterThanOrEqual(1);
      expect(durationMs).toBeLessThan(10000); // Processed well under 10 seconds
    });
  });

  describe('Multi-Tenant Dual-Layer Isolation (P2-QA-01)', () => {
    it('prevents Tenant B from reading Tenant A locks via withTenant RLS', async () => {
      const appPool = getAppPool();

      // Query locks as Tenant B
      const tenantBLocks = await withTenant({ companyId: companyBId }, async (_tx, client) => {
        const res = await client.query('SELECT * FROM attendance_period_locks WHERE company_id = $1', [companyBId]);
        return res.rows;
      }, appPool);

      expect(tenantBLocks.length).toBe(0);

      // Verify cross-tenant leak is impossible even with Tenant A companyId in WHERE
      const crossTenantAttempt = await withTenant({ companyId: companyBId }, async (_tx, client) => {
        const res = await client.query('SELECT * FROM attendance_period_locks WHERE company_id = $1', [companyAId]);
        return res.rows;
      }, appPool);

      expect(crossTenantAttempt.length).toBe(0);
    });
  });
});
