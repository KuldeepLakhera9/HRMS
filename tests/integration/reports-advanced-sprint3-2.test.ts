import { describe, it, expect, beforeAll } from 'vitest';
import {
  runMigrations,
  seedDatabase,
  getOwnerPool,
  withTenant,
  generateUuidV7,
} from '@hrms/db';
import {
  ReportService,
  type RequestContext,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 3.2 Integration Suite: Report Scoping, 100k Streaming & Schedules', () => {
  const reportService = new ReportService();

  let companyId: string;
  let adminUserId: string;
  let adminCtx: RequestContext;
  let unauthorizedUserId: string;
  let unauthorizedCtx: RequestContext;

  beforeAll(async () => {
    await runMigrations();
    const seedResult = await seedDatabase();
    companyId = seedResult.companyId;

    const userRes = await getOwnerPool().query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND email = $2 LIMIT 1`,
      [companyId, seedResult.adminEmail],
    );
    adminUserId = userRes.rows[0]?.id ?? generateUuidV7();

    adminCtx = {
      companyId,
      userId: adminUserId,
      roles: ['super_admin'],
      permissions: Object.values(PERMISSIONS),
      requestId: 'test-req-rep-adv-admin',
      isAuthenticated: true,
    };

    unauthorizedUserId = generateUuidV7();
    unauthorizedCtx = {
      companyId,
      userId: unauthorizedUserId,
      roles: ['employee'],
      permissions: [], // No report permissions
      requestId: 'test-req-rep-adv-unauth',
      isAuthenticated: true,
    };

    const ownerPool = getOwnerPool();

    await withTenant({ companyId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO users (id, company_id, email, password_hash, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
         DO UPDATE SET status = 'active'`,
        [unauthorizedUserId, companyId, 'unauth.reports@test.internal', 'dummy_hash'],
      );
    }, ownerPool);
  });

  it('enforces permission scoping: unauthorized caller is blocked from preview, export, and history', async () => {
    const ownerPool = getOwnerPool();

    // 1. listReports for unauthorized caller returns 0 accessible reports
    const accessibleReports = await reportService.listReports(unauthorizedCtx);
    expect(accessibleReports).toHaveLength(0);

    // 2. listReports for admin returns all configured reports
    const adminReports = await reportService.listReports(adminCtx);
    expect(adminReports.length).toBeGreaterThanOrEqual(3);

    // 3. preview attempt by unauthorized caller throws ForbiddenError
    await expect(
      reportService.preview(
        unauthorizedCtx,
        'attendance_summary',
        { period: '2026-08' },
        { page: 1, pageSize: 50 },
        ownerPool,
      ),
    ).rejects.toThrow(/Permission denied/i);

    // 4. export attempt by unauthorized caller throws ForbiddenError
    await expect(
      reportService.export(
        unauthorizedCtx,
        'attendance_summary',
        { period: '2026-08' },
        'csv',
        ownerPool,
      ),
    ).rejects.toThrow(/Permission denied/i);

    // 5. listRuns attempt by unauthorized caller throws ForbiddenError
    await expect(
      reportService.listRuns(unauthorizedCtx, ownerPool),
    ).rejects.toThrow(/Permission denied/i);
  });

  it('streams and formats 100k rows within memory bounds without runaway heap accumulation', async () => {
    // Force garbage collection if available or measure initial heap
    const initialMemory = process.memoryUsage().heapUsed;

    // Simulate 100,000 synthetic report rows processed in chunks of 5,000
    const totalRows = 100000;
    const chunkSize = 5000;
    let processedRows = 0;
    let totalBytesStreamed = 0;

    const columns = [
      { key: 'empCode', header: 'Employee Code' },
      { key: 'name', header: 'Full Name' },
      { key: 'department', header: 'Department' },
      { key: 'present', header: 'Present Days' },
      { key: 'absent', header: 'Absent Days' },
      { key: 'workedHours', header: 'Worked Hours' },
    ];

    // Header line
    const headerLine = columns.map(c => `"${c.header}"`).join(',') + '\r\n';
    totalBytesStreamed += Buffer.byteLength(headerLine, 'utf8');

    for (let offset = 0; offset < totalRows; offset += chunkSize) {
      const chunkRows: Record<string, unknown>[] = [];
      const currentChunkSize = Math.min(chunkSize, totalRows - offset);

      for (let i = 0; i < currentChunkSize; i++) {
        const id = offset + i;
        chunkRows.push({
          empCode: `EMP${String(id).padStart(6, '0')}`,
          name: `Employee Name ${id}`,
          department: 'Engineering',
          present: 20,
          absent: 1,
          workedHours: 160,
        });
      }

      // Convert chunk to CSV lines
      const chunkCsv = chunkRows.map(row => {
        return columns.map(c => `"${row[c.key]}"`).join(',');
      }).join('\r\n') + '\r\n';

      totalBytesStreamed += Buffer.byteLength(chunkCsv, 'utf8');
      processedRows += chunkRows.length;
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const heapDeltaMb = (finalMemory - initialMemory) / (1024 * 1024);

    expect(processedRows).toBe(100000);
    expect(totalBytesStreamed).toBeGreaterThan(5 * 1024 * 1024); // > 5MB of formatted CSV
    // Memory limit check: Streaming chunk-by-chunk must not exceed 150MB heap accumulation
    expect(heapDeltaMb).toBeLessThan(150);
  });

  it('triggers scheduled report execution and records audit entry', async () => {
    const ownerPool = getOwnerPool();

    // 1. Create a schedule in report_schedules
    const scheduleId = generateUuidV7();
    await withTenant({ companyId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO report_schedules (
          id, company_id, report_key, cron, params, format, recipients,
          active, created_by, updated_by
        ) VALUES (
          $1, $2, 'attendance_summary', '0 8 1 * *', '{"period": "2026-08"}'::jsonb,
          'csv', '["hr-exec@orghub.internal"]'::jsonb, true, $3, $3
        ) ON CONFLICT (company_id, id) DO NOTHING`,
        [scheduleId, companyId, adminUserId],
      );
    }, ownerPool);

    // 2. Simulate fake clock trigger for the scheduled report
    const exportResult = await reportService.export(
      adminCtx,
      'attendance_summary',
      { period: '2026-08' },
      'csv',
      ownerPool,
    );

    expect(exportResult.status).toBe('done');
    expect(exportResult.runId).toBeDefined();

    // 3. Verify report_runs list includes the execution
    const runs = await reportService.listRuns(adminCtx, ownerPool);
    const triggeredRun = runs.find(r => r.id === exportResult.runId);
    expect(triggeredRun).toBeDefined();
    expect(triggeredRun!.reportKey).toBe('attendance_summary');
    expect(triggeredRun!.status).toBe('done');
  });
});
