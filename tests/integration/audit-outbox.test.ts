import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, TestDatabaseContext } from '../helpers/db-test-helper.js';
import { generateUuidV7, withTenant } from '@hrms/db';
import { PERMISSIONS } from '@hrms/shared';
import {
  AuditService,
  AuditRepository,
  type RequestContext,
} from '@hrms/core';

describe('Sprint 1.1 Audit Service & Transactional Outbox Integration Tests', () => {
  let db: TestDatabaseContext;
  let companyId: string;
  let userId: string;
  let auditService: AuditService;
  let auditRepo: AuditRepository;

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyId = await db.createCompany(
      'Audit Test Co',
      `audit-test-${generateUuidV7()}.internal`,
    );

    userId = generateUuidV7();
    await withTenant({ companyId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [userId, companyId, `audit_user_${generateUuidV7()}@test.com`, 'test_hash'],
      );
    }, db.appPool);

    auditRepo = new AuditRepository();
    auditService = new AuditService(auditRepo);
  });

  afterAll(async () => {
    await db.close();
  });

  it('records an audit log with sensitive data automatically redacted', async () => {
    const ctx: RequestContext = {
      companyId,
      userId,
      roles: ['admin'],
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
      requestId: 'req-audit-123',
      ip: '127.0.0.1',
      userAgent: 'TestBrowser',
      isAuthenticated: true,
    };

    const logId = await auditService.recordEvent(ctx, {
      action: 'user.password_reset',
      entity: 'users',
      entityId: userId,
      before: {
        email: 'user@test.com',
        password_hash: 'super-secret-hash',
      },
      after: {
        email: 'user@test.com',
        password_hash: 'new-secret-hash',
        raw_token: 'cleartext-token',
        totp_secret: 'base32secret',
        pan: 'ABCDE1234F',
      },
      meta: {
        reason: 'admin_override',
        token: 'leak-test',
      },
      poolOverride: db.appPool,
    });

    expect(logId).toBeDefined();

    // Query via service
    const { logs } = await auditService.queryLogs(ctx, {
      entity: 'users',
      entityId: userId,
      poolOverride: db.appPool,
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const log = logs.find(l => l.id === logId);
    expect(log).toBeDefined();
    expect(log?.actorId).toBe(userId);
    expect(log?.actorRole).toBe('admin');
    expect(log?.action).toBe('user.password_reset');

    // Verify redaction in stored JSON
    expect(log?.before?.password_hash).toBe('[REDACTED]');
    expect(log?.after?.password_hash).toBe('[REDACTED]');
    expect(log?.after?.raw_token).toBe('[REDACTED]');
    expect(log?.after?.totp_secret).toBe('[REDACTED]');
    expect(log?.after?.pan).toBe('[REDACTED]');
    expect(log?.meta?.token).toBe('[REDACTED]');
    expect(log?.meta?.reason).toBe('admin_override');
  });

  it('proves audit_logs is append-only by rejecting UPDATE and DELETE', async () => {
    const ctx: RequestContext = {
      companyId,
      userId,
      roles: ['admin'],
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
      requestId: 'req-append-test',
      isAuthenticated: true,
    };

    const logId = await auditService.recordEvent(ctx, {
      action: 'security.check',
      entity: 'system',
      poolOverride: db.appPool,
    });

    // Attempting UPDATE must fail via trigger
    await expect(
      withTenant({ companyId }, async (_tx, client) => {
        await client.query(
          `UPDATE audit_logs SET action = 'tampered' WHERE id = $1`,
          [logId],
        );
      }, db.appPool),
    ).rejects.toThrow();

    // Attempting DELETE must fail via trigger
    await expect(
      withTenant({ companyId }, async (_tx, client) => {
        await client.query(
          `DELETE FROM audit_logs WHERE id = $1`,
          [logId],
        );
      }, db.appPool),
    ).rejects.toThrow();
  });

  it('paginates audit logs using keyset cursor pagination', async () => {
    const ctx: RequestContext = {
      companyId,
      userId,
      roles: ['admin'],
      permissions: [PERMISSIONS.AUDIT_LOG_READ],
      requestId: 'req-paging',
      isAuthenticated: true,
    };

    // Insert 5 logs
    for (let i = 0; i < 5; i++) {
      await auditService.recordEvent(ctx, {
        action: `event.sequence.${i}`,
        entity: 'pagination_test',
        poolOverride: db.appPool,
      });
    }

    // Query Page 1: limit 2
    const page1 = await auditService.queryLogs(ctx, {
      entity: 'pagination_test',
      limit: 2,
      poolOverride: db.appPool,
    });

    expect(page1.logs.length).toBe(2);
    expect(page1.nextCursor).toBeDefined();

    // Query Page 2 using cursor
    const page2 = await auditService.queryLogs(ctx, {
      entity: 'pagination_test',
      limit: 2,
      cursorTs: page1.nextCursor?.ts,
      cursorId: page1.nextCursor?.id,
      poolOverride: db.appPool,
    });

    expect(page2.logs.length).toBe(2);
    // Keys in page 2 must be different from page 1
    const page1Ids = new Set(page1.logs.map(l => l.id));
    for (const log of page2.logs) {
      expect(page1Ids.has(log.id)).toBe(false);
    }
  });

  it('enforces RBAC permissions for audit queries', async () => {
    const unprivilegedCtx: RequestContext = {
      companyId,
      userId,
      roles: ['employee'],
      permissions: [], // No audit permissions
      requestId: 'req-unauth',
      isAuthenticated: true,
    };

    // Must be rejected
    await expect(
      auditService.queryLogs(unprivilegedCtx, { poolOverride: db.appPool }),
    ).rejects.toThrow('You do not have permission to view audit logs.');

    // Caller with audit.log.read_own can query but is scoped to self
    const readOwnCtx: RequestContext = {
      companyId,
      userId,
      roles: ['employee'],
      permissions: [PERMISSIONS.AUDIT_LOG_READ_OWN],
      requestId: 'req-read-own',
      isAuthenticated: true,
    };

    const res = await auditService.queryLogs(readOwnCtx, { poolOverride: db.appPool });
    expect(res.logs).toBeDefined();
    for (const log of res.logs) {
      expect(log.actorId).toBe(userId);
    }
  });

  it('appends and processes transactional outbox events', async () => {
    let outboxId = '';

    await withTenant({ companyId }, async (_tx, client) => {
      outboxId = await auditRepo.insertOutboxEvent(
        companyId,
        'user',
        'user.registered',
        {
          userId,
          raw_token: 'secret-invite-token',
          email: 'newuser@test.com',
        },
        client,
      );
    }, db.appPool);

    expect(outboxId).toBeDefined();

    // Background relay fetches unprocessed outbox events
    const client = await db.ownerPool.connect();
    try {
      const unprocessed = await auditRepo.fetchUnprocessedOutbox(10, client);
      const event = unprocessed.find(e => e.id === outboxId);
      expect(event).toBeDefined();
      expect(event?.aggregate).toBe('user');
      expect(event?.type).toBe('user.registered');
      expect((event?.payload as Record<string, unknown>).raw_token).toBe('[REDACTED]');

      // Mark processed
      await auditRepo.markOutboxProcessed([outboxId], client);

      // Verify no longer in unprocessed list
      const afterProcessed = await auditRepo.fetchUnprocessedOutbox(10, client);
      expect(afterProcessed.find(e => e.id === outboxId)).toBeUndefined();
    } finally {
      client.release();
    }
  });
});
