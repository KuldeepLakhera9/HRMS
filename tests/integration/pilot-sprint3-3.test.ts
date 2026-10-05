import { describe, it, expect, beforeAll } from 'vitest';
import {
  runMigrations,
  seedDatabase,
  getOwnerPool,
  withTenant,
  generateUuidV7,
} from '@hrms/db';
import {
  PilotService,
  evaluateFeatureFlag,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('P3-PILOT-01: Feature Flags, Feedback & Pilot Metrics Suite', () => {
  const pilotService = new PilotService();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let employeeUserId: string;
  let employeeCtx: RequestContext;
  let deptPilotId: string;
  let deptOtherId: string;

  beforeAll(async () => {
    await runMigrations();
    const seedResult = await seedDatabase();
    companyId = seedResult.companyId;

    const userRes = await getOwnerPool().query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND email = $2 LIMIT 1`,
      [companyId, seedResult.adminEmail]
    );
    adminUserId = userRes.rows[0]?.id ?? generateUuidV7();

    adminCtx = {
      companyId,
      userId: adminUserId,
      roles: ['super_admin'],
      permissions: Object.values(PERMISSIONS),
      requestId: 'test-req-pilot-admin',
      isAuthenticated: true,
    };

    employeeUserId = generateUuidV7();
    employeeCtx = {
      companyId,
      userId: employeeUserId,
      roles: ['employee'],
      permissions: [
        PERMISSIONS.FEEDBACK_CREATE,
      ],
      requestId: 'test-req-pilot-emp',
      isAuthenticated: true,
    };

    const ownerPool = getOwnerPool();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Departments
      const deptPRes = await client.query<{ id: string }>(
        `INSERT INTO departments (id, company_id, name, code, active)
         VALUES ($1, $2, 'Pilot Sales Dept', 'PILOT_SALES', true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO UPDATE SET active = true
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      deptPilotId = deptPRes.rows[0]!.id;

      const deptORes = await client.query<{ id: string }>(
        `INSERT INTO departments (id, company_id, name, code, active)
         VALUES ($1, $2, 'Other Dept', 'OTHER_DEPT', true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO UPDATE SET active = true
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      deptOtherId = deptORes.rows[0]!.id;

      // 2. Employee User
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, 'pilot.user@test.internal', 'dummy_hash', 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL DO NOTHING`,
        [employeeUserId, companyId]
      );

      // 3. Employee Master in Pilot Department
      await client.query(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, department_id, status, doj, search_key)
         VALUES ($1, $2, $3, 'PLT_EMP01', 'Arthur', 'Dent', 'pilot.user@test.internal', $4, 'active', '2025-01-01', 'arthur dent')
         ON CONFLICT (company_id, emp_code) DO NOTHING`,
        [generateUuidV7(), companyId, employeeUserId, deptPilotId]
      );
    }, ownerPool);
  });

  describe('Feature Flag Engine & Targeting', () => {
    it('evaluates department targeting rule deterministically', () => {
      const flag = {
        id: generateUuidV7(),
        companyId,
        key: 'new_leave_workflow',
        name: 'New Leave Flow',
        isEnabled: true,
        rules: {
          departments: [deptPilotId],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // User in Pilot Department -> enabled
      expect(evaluateFeatureFlag(flag, { userId: 'u1', departmentId: deptPilotId })).toBe(true);

      // User in Other Department -> disabled
      expect(evaluateFeatureFlag(flag, { userId: 'u2', departmentId: deptOtherId })).toBe(false);

      // User with no department -> disabled
      expect(evaluateFeatureFlag(flag, { userId: 'u3' })).toBe(false);
    });

    it('creates and evaluates feature flag via PilotService', async () => {
      const ownerPool = getOwnerPool();

      // Create flag targeted to Pilot Department
      const created = await pilotService.createOrUpdateFlag(
        adminCtx,
        {
          key: 'mobile_kiosk_qr',
          name: 'Mobile Kiosk QR Check-in',
          description: 'Enables QR punch mode on mobile app for pilot department',
          isEnabled: true,
          rules: {
            departments: [deptPilotId],
          },
        },
        ownerPool
      );

      expect(created.key).toBe('mobile_kiosk_qr');
      expect(created.isEnabled).toBe(true);

      // Evaluate for employee in pilot department
      const isPilotEnabled = await pilotService.isEnabled(
        employeeCtx,
        'mobile_kiosk_qr',
        deptPilotId,
        ownerPool
      );
      expect(isPilotEnabled).toBe(true);

      // Evaluate for employee in other department
      const isOtherEnabled = await pilotService.isEnabled(
        employeeCtx,
        'mobile_kiosk_qr',
        deptOtherId,
        ownerPool
      );
      expect(isOtherEnabled).toBe(false);
    });
  });

  describe('In-App Feedback Widget', () => {
    let feedbackId: string;

    it('submits user rating and sentiment message', async () => {
      const ownerPool = getOwnerPool();

      const submission = await pilotService.submitFeedback(
        employeeCtx,
        {
          rating: 5,
          category: 'leave_module',
          pageContext: '/leave/apply',
          message: 'The leave balance preview is incredibly clear and fast!',
        },
        ownerPool
      );

      expect(submission.id).toBeDefined();
      expect(submission.rating).toBe(5);
      expect(submission.message).toContain('leave balance preview');
      feedbackId = submission.id;
    });

    it('allows admin/HR to retrieve and review feedback submissions', async () => {
      const ownerPool = getOwnerPool();

      const list = await pilotService.listFeedback(adminCtx, ownerPool);
      expect(list.length).toBeGreaterThanOrEqual(1);

      const match = list.find(f => f.id === feedbackId);
      expect(match).toBeDefined();
      expect(match!.rating).toBe(5);
      expect(match!.category).toBe('leave_module');
    });
  });

  describe('Pilot Metrics Aggregation', () => {
    it('computes pilot metrics: adoption, CSAT score, and channel breakdown', async () => {
      const ownerPool = getOwnerPool();

      const metrics = await pilotService.getPilotMetrics(adminCtx, deptPilotId, ownerPool);

      expect(metrics.totalEmployees).toBeGreaterThanOrEqual(1);
      expect(metrics.activeEmployees).toBeGreaterThanOrEqual(1);
      expect(metrics.adoptionRate).toBeGreaterThanOrEqual(50);
      expect(metrics.csatScore).toBeGreaterThanOrEqual(1.0);
      expect(metrics.csatScore).toBeLessThanOrEqual(5.0);
      expect(metrics.channelSplit).toBeDefined();
      expect(metrics.failureReasons.length).toBeGreaterThanOrEqual(1);
    });
  });
});
