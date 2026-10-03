import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getAppPool, getOwnerPool, runMigrations, generateUuidV7 } from '@hrms/db';
import { StorageService, type RequestContext } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 1.2 P1-FILE-01: Object Storage & Magic Byte Validation Tests', () => {
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  let storageService: StorageService;

  let tenantACompanyId: string;
  let tenantBCompanyId: string;
  let userAId: string;
  let userBId: string;
  let employeeAId: string;

  beforeAll(async () => {
    ownerPool = getOwnerPool();
    await runMigrations(ownerPool);
    appPool = getAppPool();
    storageService = new StorageService();

    tenantACompanyId = generateUuidV7();
    tenantBCompanyId = generateUuidV7();
    userAId = generateUuidV7();
    userBId = generateUuidV7();
    employeeAId = generateUuidV7();

    // Create companies and users as owner
    await ownerPool.query(
      `INSERT INTO companies (id, name, legal_name, domain)
       VALUES ($1, 'Files Corp A', 'Files Corp A Ltd', 'files-a.internal'),
              ($2, 'Files Corp B', 'Files Corp B Ltd', 'files-b.internal')`,
      [tenantACompanyId, tenantBCompanyId],
    );

    await ownerPool.query(
      `INSERT INTO users (id, company_id, email, password_hash, status)
       VALUES ($1, $2, 'usera@files-a.internal', 'hash', 'active'),
              ($3, $4, 'userb@files-b.internal', 'hash', 'active')`,
      [userAId, tenantACompanyId, userBId, tenantBCompanyId],
    );
  });

  afterAll(async () => {
    await ownerPool.query('DELETE FROM files WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM users WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM companies WHERE id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
  });

  function createContext(companyId: string, userId: string, permissions: string[] = []): RequestContext {
    return {
      companyId,
      userId,
      employeeId: companyId === tenantACompanyId ? employeeAId : undefined,
      sessionId: generateUuidV7(),
      roles: ['hr_admin'],
      permissions,
      requestId: generateUuidV7(),
      isAuthenticated: true,
    };
  }

  it('rejects disallowed MIME types and oversize files', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD]);

    // 1. Invalid MIME type
    await expect(
      storageService.createPresignedUpload(ctx, {
        originalName: 'script.sh',
        mime: 'application/x-sh',
        sizeBytes: 1024,
        ownerType: 'employee',
        ownerId: employeeAId,
      }, appPool),
    ).rejects.toThrow('Invalid file type');

    // 2. Oversize (> 10MB)
    await expect(
      storageService.createPresignedUpload(ctx, {
        originalName: 'giant.pdf',
        mime: 'application/pdf',
        sizeBytes: 15 * 1024 * 1024,
        ownerType: 'employee',
        ownerId: employeeAId,
      }, appPool),
    ).rejects.toThrow('File size must be greater than 0 and less than 10MB');
  });

  it('generates presigned upload URL, uploads valid PDF to MinIO, and confirms upload', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD,
      PERMISSIONS.EMPLOYEE_DOCUMENT_READ,
    ]);

    // 1. Request presigned upload
    const presignResult = await storageService.createPresignedUpload(
      ctx,
      {
        originalName: 'contract.pdf',
        mime: 'application/pdf',
        sizeBytes: 100,
        ownerType: 'employee',
        ownerId: employeeAId,
      },
      appPool,
    );

    expect(presignResult.fileId).toBeDefined();
    expect(presignResult.uploadUrl).toContain('http');
    expect(presignResult.objectKey).toContain('contract.pdf');

    // 2. Simulate client upload with valid PDF magic bytes (%PDF-1.4)
    const validPdfBuffer = Buffer.from('%PDF-1.4\n%Valid HRMS Contract Test Content\n%%EOF');
    const uploadRes = await fetch(presignResult.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
      },
      body: validPdfBuffer,
    });
    expect(uploadRes.status).toBe(200);

    // 3. Confirm upload
    const confirmedFile = await storageService.confirmUpload(ctx, presignResult.fileId, appPool);
    expect(confirmedFile.status).toBe('clean');
    expect(confirmedFile.sizeBytes).toBe(validPdfBuffer.length);
    expect(confirmedFile.sha256).toBeDefined();

    // 4. Generate presigned download URL
    const downloadResult = await storageService.getPresignedDownloadUrl(ctx, presignResult.fileId, appPool);
    expect(downloadResult.downloadUrl).toContain('http');
    expect(downloadResult.fileName).toBe('contract.pdf');

    // Fetch the file using the download URL
    const downloadedRes = await fetch(downloadResult.downloadUrl);
    expect(downloadedRes.status).toBe(200);
    const downloadedText = await downloadedRes.text();
    expect(downloadedText).toContain('%PDF-1.4');
  });

  it('detects MIME spoofing via magic bytes, rejects file, and purges from MinIO', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD]);

    // 1. Request upload claiming to be PDF
    const presignResult = await storageService.createPresignedUpload(
      ctx,
      {
        originalName: 'malicious.pdf',
        mime: 'application/pdf',
        sizeBytes: 50,
        ownerType: 'employee',
        ownerId: employeeAId,
      },
      appPool,
    );

    // 2. Upload plain text with NO %PDF- magic bytes
    const fakeBuffer = Buffer.from('THIS IS PLAIN TEXT AND NOT A VALID PDF FILE AT ALL');
    const uploadRes = await fetch(presignResult.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
      },
      body: fakeBuffer,
    });
    expect(uploadRes.status).toBe(200);

    // 3. Confirm should fail due to magic bytes mismatch
    await expect(
      storageService.confirmUpload(ctx, presignResult.fileId, appPool),
    ).rejects.toThrow('File content does not match the declared MIME type');

    // 4. Confirm file status in DB was updated to 'rejected'
    const rejectedFile = await storageService['repository'].findById(tenantACompanyId, presignResult.fileId, appPool);
    expect(rejectedFile?.status).toBe('rejected');
  });

  it('enforces tenant isolation and prevents cross-tenant access to files', async () => {
    const ctxA = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD,
      PERMISSIONS.EMPLOYEE_DOCUMENT_READ,
    ]);
    const ctxB = createContext(tenantBCompanyId, userBId, [
      PERMISSIONS.EMPLOYEE_DOCUMENT_READ,
    ]);

    // Create and confirm file in Tenant A
    const presignResult = await storageService.createPresignedUpload(
      ctxA,
      {
        originalName: 'passport.png',
        mime: 'image/png',
        sizeBytes: 60,
        ownerType: 'employee',
        ownerId: employeeAId,
      },
      appPool,
    );

    // Valid PNG magic bytes (\x89PNG\r\n\x1a\n)
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    await fetch(presignResult.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: validPngBuffer,
    });

    await storageService.confirmUpload(ctxA, presignResult.fileId, appPool);

    // Tenant B attempts to read Tenant A's file -> should fail with NotFound (or Forbidden)
    await expect(
      storageService.getPresignedDownloadUrl(ctxB, presignResult.fileId, appPool),
    ).rejects.toThrow('File not found');

    // List files for employee
    const filesList = await storageService.listFilesByOwner(
      ctxA,
      { ownerType: 'employee', ownerId: employeeAId },
      appPool,
    );
    expect(filesList.length).toBeGreaterThanOrEqual(1);
    expect(filesList.some(f => f.id === presignResult.fileId)).toBe(true);

    // Delete file
    const ctxDelete = createContext(tenantACompanyId, userAId, [PERMISSIONS.EMPLOYEE_DOCUMENT_DELETE]);
    const deleteRes = await storageService.deleteFile(ctxDelete, presignResult.fileId, appPool);
    expect(deleteRes.success).toBe(true);

    // After deletion, download URL generation should fail with NotFound
    await expect(
      storageService.getPresignedDownloadUrl(ctxA, presignResult.fileId, appPool),
    ).rejects.toThrow('File not found');
  });
});

