import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { generateUuidV7, withTenant } from '@hrms/db';
import { PERMISSIONS } from '@hrms/shared';
import {
  OrgService,
  OrgRepository,
  type RequestContext,
} from '@hrms/core';

describe('Sprint 1.1 Organization Master Service Integration Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  let userId: string;
  let orgService: OrgService;
  let orgRepo: OrgRepository;
  let adminCtx: RequestContext;

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyId = await db.createCompany(
      'Org Master Test Co',
      `org-test-${generateUuidV7()}.internal`,
    );

    userId = generateUuidV7();
    await withTenant({ companyId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [userId, companyId, `org_admin_${generateUuidV7()}@test.com`, 'test_hash'],
      );
    }, db.appPool);

    orgRepo = new OrgRepository();
    orgService = new OrgService(orgRepo);

    adminCtx = {
      companyId,
      userId,
      roles: ['admin'],
      permissions: [
        PERMISSIONS.ORG_DEPARTMENT_READ,
        PERMISSIONS.ORG_DEPARTMENT_MANAGE,
        PERMISSIONS.ORG_DESIGNATION_READ,
        PERMISSIONS.ORG_DESIGNATION_MANAGE,
        PERMISSIONS.ORG_GRADE_READ,
        PERMISSIONS.ORG_GRADE_MANAGE,
        PERMISSIONS.ORG_COSTCENTER_READ,
        PERMISSIONS.ORG_COSTCENTER_MANAGE,
        PERMISSIONS.ORG_COMPANY_READ,
        PERMISSIONS.ORG_COMPANY_UPDATE,
      ],
      requestId: 'req-org-admin',
      isAuthenticated: true,
    };
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Department Hierarchy & Cycle Prevention', () => {
    it('creates nested departments and retrieves full tree structure', async () => {
      // 1. Engineering (Root)
      const eng = await orgService.createDepartment(adminCtx, {
        name: 'Engineering',
        code: `ENG_${generateUuidV7().slice(-4)}`,
      }, db.appPool);

      // 2. Frontend (Child of Engineering)
      const frontend = await orgService.createDepartment(adminCtx, {
        name: 'Frontend',
        code: `FE_${generateUuidV7().slice(-4)}`,
        parentId: eng.id,
      }, db.appPool);

      // 3. Web Platform (Grandchild under Frontend)
      const webPlatform = await orgService.createDepartment(adminCtx, {
        name: 'Web Platform',
        code: `WP_${generateUuidV7().slice(-4)}`,
        parentId: frontend.id,
      }, db.appPool);

      expect(eng.id).toBeDefined();
      expect(frontend.parentId).toBe(eng.id);
      expect(webPlatform.parentId).toBe(frontend.id);

      // Fetch Tree
      const tree = await orgService.getDepartmentTree(adminCtx, db.appPool);
      const rootEng = tree.find(t => t.id === eng.id);
      expect(rootEng).toBeDefined();
      expect(rootEng?.children.length).toBeGreaterThanOrEqual(1);

      const feNode = rootEng?.children.find(c => c.id === frontend.id);
      expect(feNode).toBeDefined();
      expect(feNode?.children.length).toBeGreaterThanOrEqual(1);

      const wpNode = feNode?.children.find(c => c.id === webPlatform.id);
      expect(wpNode).toBeDefined();
    });

    it('prevents a department from being set as its own parent', async () => {
      const dept = await orgService.createDepartment(adminCtx, {
        name: 'Self Ref Test',
        code: `SELF_${generateUuidV7().slice(-4)}`,
      }, db.appPool);

      await expect(
        orgService.updateDepartment(adminCtx, dept.id, { parentId: dept.id }, db.appPool),
      ).rejects.toThrow('A department cannot be its own parent.');
    });

    it('detects and prevents cycles where a parent is assigned to its own descendant', async () => {
      // Dept A -> Dept B -> Dept C
      const deptA = await orgService.createDepartment(adminCtx, {
        name: 'Dept A',
        code: `DA_${generateUuidV7().slice(-4)}`,
      }, db.appPool);

      const deptB = await orgService.createDepartment(adminCtx, {
        name: 'Dept B',
        code: `DB_${generateUuidV7().slice(-4)}`,
        parentId: deptA.id,
      }, db.appPool);

      const deptC = await orgService.createDepartment(adminCtx, {
        name: 'Dept C',
        code: `DC_${generateUuidV7().slice(-4)}`,
        parentId: deptB.id,
      }, db.appPool);

      // Attempting to make Dept A a child of Dept C MUST throw cycle error
      await expect(
        orgService.updateDepartment(adminCtx, deptA.id, { parentId: deptC.id }, db.appPool),
      ).rejects.toThrow('Cycle detected: a department cannot be placed under its own descendant.');
    });

    it('soft deletes a department and excludes it from lists', async () => {
      const dept = await orgService.createDepartment(adminCtx, {
        name: 'Delete Me',
        code: `DEL_${generateUuidV7().slice(-4)}`,
      }, db.appPool);

      await orgService.deleteDepartment(adminCtx, dept.id, db.appPool);

      const all = await orgService.listDepartments(adminCtx, db.appPool);
      expect(all.find(d => d.id === dept.id)).toBeUndefined();
    });
  });

  describe('Designations, Grades & Cost Centers', () => {
    it('creates and lists designations', async () => {
      const desig = await orgService.createDesignation(adminCtx, {
        name: 'Principal Engineer',
        code: `PE_${generateUuidV7().slice(-4)}`,
      }, db.appPool);

      expect(desig.id).toBeDefined();

      const list = await orgService.listDesignations(adminCtx, db.appPool);
      expect(list.some(d => d.id === desig.id)).toBe(true);
    });

    it('creates and lists grades with level hierarchy', async () => {
      const grade = await orgService.createGrade(adminCtx, {
        name: 'Level 7 Staff',
        code: `L7_${generateUuidV7().slice(-4)}`,
        level: 7,
      }, db.appPool);

      expect(grade.id).toBeDefined();
      expect(grade.level).toBe(7);

      const list = await orgService.listGrades(adminCtx, db.appPool);
      expect(list.some(g => g.id === grade.id)).toBe(true);
    });

    it('creates and lists cost centers', async () => {
      const cc = await orgService.createCostCenter(adminCtx, {
        name: 'R&D Innovation',
        code: `RD_${generateUuidV7().slice(-4)}`,
      }, db.appPool);

      expect(cc.id).toBeDefined();

      const list = await orgService.listCostCenters(adminCtx, db.appPool);
      expect(list.some(c => c.id === cc.id)).toBe(true);
    });
  });

  describe('Company Settings', () => {
    it('reads and updates company profile', async () => {
      const company = await orgService.getCompany(adminCtx, db.appPool);
      expect(company.id).toBe(companyId);

      const updated = await orgService.updateCompany(adminCtx, {
        legalName: 'OrgHub Tech Innovations Ltd',
      }, db.appPool);

      expect(updated.legalName).toBe('OrgHub Tech Innovations Ltd');
    });
  });

  describe('RBAC Authorization', () => {
    it('rejects unprivileged user operations', async () => {
      const unprivilegedCtx: RequestContext = {
        companyId,
        userId,
        roles: ['employee'],
        permissions: [],
        requestId: 'req-unauth-org',
        isAuthenticated: true,
      };

      await expect(
        orgService.createDepartment(unprivilegedCtx, { name: 'Test', code: 'T1' }, db.appPool),
      ).rejects.toThrow('You do not have permission to manage departments.');

      await expect(
        orgService.listDepartments(unprivilegedCtx, db.appPool),
      ).rejects.toThrow('You do not have permission to view departments.');
    });
  });
});
