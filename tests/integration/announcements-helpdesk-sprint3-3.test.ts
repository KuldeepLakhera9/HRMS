import { describe, it, expect, beforeAll } from 'vitest';
import {
  runMigrations,
  seedDatabase,
  getOwnerPool,
  withTenant,
  generateUuidV7,
} from '@hrms/db';
import {
  AnnouncementService,
  HelpdeskService,
  EmployeeService,
  sanitizeMarkdown,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('P3-ANN-01: Announcements, Helpdesk-Lite & Celebrations Suite', () => {
  const announcementService = new AnnouncementService();
  const helpdeskService = new HelpdeskService();
  const employeeService = new EmployeeService();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let employeeUserId: string;
  let employeeId: string;
  let employeeCtx: RequestContext;
  let deptAId: string;
  let deptBId: string;
  let helpdeskCategoryId: string;

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
      requestId: 'test-req-ann-admin',
      isAuthenticated: true,
    };

    employeeUserId = generateUuidV7();
    employeeId = generateUuidV7();

    employeeCtx = {
      companyId,
      userId: employeeUserId,
      employeeId,
      roles: ['employee'],
      permissions: [
        PERMISSIONS.ANNOUNCEMENT_READ,
        PERMISSIONS.HELPDESK_TICKET_CREATE,
        PERMISSIONS.HELPDESK_TICKET_READ,
        PERMISSIONS.EMPLOYEE_PROFILE_READ,
      ],
      requestId: 'test-req-ann-emp',
      isAuthenticated: true,
    };

    const ownerPool = getOwnerPool();

    await withTenant({ companyId }, async (_tx, client) => {
      // 1. Departments
      const deptARes = await client.query<{ id: string }>(
        `INSERT INTO departments (id, company_id, name, code, active)
         VALUES ($1, $2, 'Dept Alpha', 'D_ALPHA', true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO UPDATE SET active = true
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      deptAId = deptARes.rows[0]!.id;

      const deptBRes = await client.query<{ id: string }>(
        `INSERT INTO departments (id, company_id, name, code, active)
         VALUES ($1, $2, 'Dept Beta', 'D_BETA', true)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO UPDATE SET active = true
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      deptBId = deptBRes.rows[0]!.id;

      // 2. Employee User & Employee Record (in Dept Alpha)
      const empUserRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, 'ann.emp@test.internal', 'dummy_hash', 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL DO UPDATE SET status = 'active'
         RETURNING id`,
        [employeeUserId, companyId]
      );
      employeeUserId = empUserRes.rows[0]!.id;
      employeeCtx.userId = employeeUserId;

      const empRes = await client.query<{ id: string }>(
        `INSERT INTO employees (id, company_id, user_id, emp_code, first_name, last_name, email_work, department_id, status, doj, dob, search_key, custom_fields)
         VALUES ($1, $2, $3, 'ANN_EMP1', 'Arthur', 'Dent', 'ann.emp@test.internal', $4, 'active', '2023-10-10', '1990-10-10', 'arthur dent', '{"opt_out_celebrations": false}')
         ON CONFLICT (company_id, emp_code) DO UPDATE 
           SET department_id = EXCLUDED.department_id, user_id = EXCLUDED.user_id, status = 'active',
               doj = EXCLUDED.doj, dob = EXCLUDED.dob, custom_fields = EXCLUDED.custom_fields, deleted_at = NULL
         RETURNING id`,
        [employeeId, companyId, employeeUserId, deptAId]
      );
      employeeId = empRes.rows[0]!.id;
      employeeCtx.employeeId = employeeId;

      // 3. Employee with Opt-Out (in Dept Alpha)
      await client.query(
        `INSERT INTO employees (id, company_id, emp_code, first_name, last_name, email_work, department_id, status, doj, dob, search_key, custom_fields)
         VALUES ($1, $2, 'OPTOUT_EMP', 'Ford', 'Prefect', 'ford@test.internal', $3, 'active', '2021-10-10', '1985-10-10', 'ford prefect', '{"opt_out_celebrations": true}')
         ON CONFLICT (company_id, emp_code) DO UPDATE 
           SET custom_fields = '{"opt_out_celebrations": true}', status = 'active', deleted_at = NULL`,
        [generateUuidV7(), companyId, deptAId]
      );

      // 4. Helpdesk Category with 24-hour SLA
      const catRes = await client.query<{ id: string }>(
        `INSERT INTO helpdesk_categories (id, company_id, name, code, default_assignee_role, sla_hours)
         VALUES ($1, $2, 'IT Infrastructure', 'CAT_IT', 'hr_manager', 24)
         ON CONFLICT (company_id, code) DO UPDATE SET sla_hours = 24
         RETURNING id`,
        [generateUuidV7(), companyId]
      );
      helpdeskCategoryId = catRes.rows[0]!.id;
    }, ownerPool);
  });

  describe('Markdown Sanitizer', () => {
    it('strips script tags and malicious event handlers while preserving markdown markup', () => {
      const dirty = `
# Company Picnic Notice
Join us for lunch! <script>alert("pwned")</script>
<iframe src="javascript:alert(1)"></iframe>
Click [here](javascript:maliciousCode()) to RSVP.
<img src="picnic.png" onerror="alert('xss')" />
**Special instructions:**
- Bring a blanket
- Enjoy the *weather*
      `;

      const safe = sanitizeMarkdown(dirty);
      expect(safe).not.toContain('<script>');
      expect(safe).not.toContain('alert("pwned")');
      expect(safe).not.toContain('<iframe');
      expect(safe).not.toContain('onerror=');
      expect(safe).not.toContain('javascript:');
      expect(safe).toContain('# Company Picnic Notice');
      expect(safe).toContain('**Special instructions:**');
      expect(safe).toContain('Enjoy the *weather*');
    });
  });

  describe('Announcements Engine', () => {
    let globalAnnId: string;
    let deptBAnnId: string;

    it('creates announcement with audience targeting and pinned status', async () => {
      const ownerPool = getOwnerPool();

      // 1. Global pinned announcement
      const globalAnn = await announcementService.createAnnouncement(
        adminCtx,
        {
          title: 'Office Relocation Update',
          contentMd: '# New Office\nWe are moving to tower 4! <script>bad()</script>',
          audienceType: 'all',
          isPinned: true,
        },
        ownerPool
      );

      expect(globalAnn.id).toBeDefined();
      expect(globalAnn.title).toBe('Office Relocation Update');
      expect(globalAnn.isPinned).toBe(true);
      expect(globalAnn.contentMd).not.toContain('<script>');
      globalAnnId = globalAnn.id;

      // 2. Department Beta targeted announcement
      const deptBAnn = await announcementService.createAnnouncement(
        adminCtx,
        {
          title: 'Dept Beta Secret Meeting',
          contentMd: 'Only for Beta members.',
          audienceType: 'department',
          targetDeptId: deptBId,
          isPinned: false,
        },
        ownerPool
      );
      deptBAnnId = deptBAnn.id;
      expect(deptBAnn.targetDeptId).toBe(deptBId);
    });

    it('respects audience targeting: employee in Dept Alpha sees global, but not Dept Beta announcement', async () => {
      const ownerPool = getOwnerPool();

      const empAnnouncements = await announcementService.listAnnouncements(
        employeeCtx,
        { departmentId: deptAId },
        ownerPool
      );

      const ids = empAnnouncements.map(a => a.id);
      expect(ids).toContain(globalAnnId);
      expect(ids).not.toContain(deptBAnnId); // Hidden because targeted to Dept Beta
    });

    it('tracks read receipts per user', async () => {
      const ownerPool = getOwnerPool();

      // Initially unread
      const beforeList = await announcementService.listAnnouncements(
        employeeCtx,
        { departmentId: deptAId },
        ownerPool
      );
      const targetBefore = beforeList.find(a => a.id === globalAnnId);
      expect(targetBefore).toBeDefined();
      expect(targetBefore!.isRead).toBe(false);

      // Mark as read
      const markResult = await announcementService.markAsRead(employeeCtx, globalAnnId, ownerPool);
      expect(markResult.success).toBe(true);
      expect(markResult.readAt).toBeDefined();

      // Now marked as read
      const afterList = await announcementService.listAnnouncements(
        employeeCtx,
        { departmentId: deptAId },
        ownerPool
      );
      const targetAfter = afterList.find(a => a.id === globalAnnId);
      expect(targetAfter!.isRead).toBe(true);
      expect(targetAfter!.readAt).toBeDefined();
    });
  });

  describe('Helpdesk-Lite Engine', () => {
    let ticketId: string;

    it('lists categories with correct SLA hours', async () => {
      const ownerPool = getOwnerPool();
      const categories = await helpdeskService.listCategories(employeeCtx, ownerPool);
      const itCategory = categories.find(c => c.id === helpdeskCategoryId);
      expect(itCategory).toBeDefined();
      expect(itCategory!.slaHours).toBe(24);
    });

    it('creates ticket with computed SLA deadline matching category', async () => {
      const ownerPool = getOwnerPool();
      const beforeTime = Date.now();

      const ticket = await helpdeskService.createTicket(
        employeeCtx,
        {
          categoryId: helpdeskCategoryId,
          subject: 'VPN Connection Failure',
          description: 'Cannot connect to production VPN since morning.',
          priority: 'high',
        },
        ownerPool
      );

      expect(ticket.id).toBeDefined();
      expect(ticket.ticketNumber).toMatch(/^HD-\d{8}-\d{4}$/);
      expect(ticket.status).toBe('open');
      expect(ticket.priority).toBe('high');

      // SLA due at should be roughly 24 hours from creation
      const expectedMinDue = beforeTime + 23 * 3600 * 1000;
      const expectedMaxDue = Date.now() + 25 * 3600 * 1000;
      const dueTime = new Date(ticket.slaDueAt).getTime();
      expect(dueTime).toBeGreaterThan(expectedMinDue);
      expect(dueTime).toBeLessThan(expectedMaxDue);

      ticketId = ticket.id;
    });

    it('enforces RBAC visibility: regular employee only views tickets they created', async () => {
      const ownerPool = getOwnerPool();

      // Employee views own tickets
      const empTickets = await helpdeskService.listTickets(employeeCtx, {}, ownerPool);
      expect(empTickets.some(t => t.id === ticketId)).toBe(true);

      // Create an admin-only ticket
      const adminTicket = await helpdeskService.createTicket(
        adminCtx,
        {
          categoryId: helpdeskCategoryId,
          subject: 'Server Rack Upgrade',
          description: 'Scheduled maintenance for DC rack 3.',
        },
        ownerPool
      );

      // Employee cannot see admin's ticket
      const empTicketsUpdated = await helpdeskService.listTickets(employeeCtx, {}, ownerPool);
      expect(empTicketsUpdated.some(t => t.id === adminTicket.id)).toBe(false);

      // Admin sees both tickets
      const adminTickets = await helpdeskService.listTickets(adminCtx, {}, ownerPool);
      expect(adminTickets.some(t => t.id === ticketId)).toBe(true);
      expect(adminTickets.some(t => t.id === adminTicket.id)).toBe(true);
    });

    it('supports public vs internal comments: internal notes hidden from regular employees', async () => {
      const ownerPool = getOwnerPool();

      // Employee adds regular comment
      await helpdeskService.addComment(
        employeeCtx,
        ticketId,
        { commentMd: 'Here is the error log screenshot.' },
        ownerPool
      );

      // Employee attempts to post internal comment -> forbidden
      await expect(
        helpdeskService.addComment(
          employeeCtx,
          ticketId,
          { commentMd: 'Attempting internal note', isInternal: true },
          ownerPool
        )
      ).rejects.toThrow();

      // Manager posts internal note
      await helpdeskService.addComment(
        adminCtx,
        ticketId,
        { commentMd: 'Escalated to network vendor Cisco TAC', isInternal: true },
        ownerPool
      );

      // Employee views ticket -> internal note is NOT included
      const empView = await helpdeskService.getTicket(employeeCtx, ticketId, ownerPool);
      expect(empView.comments.some(c => c.commentMd.includes('error log'))).toBe(true);
      expect(empView.comments.some(c => c.commentMd.includes('Cisco TAC'))).toBe(false);

      // Admin views ticket -> internal note IS included
      const adminView = await helpdeskService.getTicket(adminCtx, ticketId, ownerPool);
      expect(adminView.comments.some(c => c.commentMd.includes('Cisco TAC'))).toBe(true);
    });

    it('updates ticket status and records resolved timestamp', async () => {
      const ownerPool = getOwnerPool();

      const updated = await helpdeskService.updateTicketStatus(
        adminCtx,
        ticketId,
        'resolved',
        ownerPool
      );

      expect(updated.status).toBe('resolved');
      expect(updated.resolvedAt).toBeDefined();
    });
  });

  describe('Directory Celebrations & Opt-Out', () => {
    it('retrieves upcoming birthdays and anniversaries while honoring opt-out preference', async () => {
      const ownerPool = getOwnerPool();

      const celebrations = await employeeService.getCelebrations(employeeCtx, 366, ownerPool);
      expect(celebrations.length).toBeGreaterThanOrEqual(1);

      // Arthur Dent (opted-in) should appear
      const arthurBirthday = celebrations.find(c => c.empCode === 'ANN_EMP1' && c.type === 'birthday');
      expect(arthurBirthday).toBeDefined();

      const arthurAnniversary = celebrations.find(c => c.empCode === 'ANN_EMP1' && c.type === 'anniversary');
      expect(arthurAnniversary).toBeDefined();
      expect(arthurAnniversary!.years).toBeGreaterThanOrEqual(1);

      // Ford Prefect (opted-out) MUST NOT appear
      const ford = celebrations.find(c => c.empCode === 'OPTOUT_EMP');
      expect(ford).toBeUndefined();
    });
  });
});
