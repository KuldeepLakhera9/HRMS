import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { ForbiddenError, NotFoundError, PERMISSIONS, SYSTEM_ROLES } from '@hrms/shared';
import { DocumentService } from './service.js';
import type { DocumentRepository, EmployeeDocumentRow } from './repository.js';
import type { StorageRepository, FileRow } from '../storage/repository.js';
import type { EmployeeRepository, EmployeeRow } from '../employee/repository.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';

function createMockPool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn().mockResolvedValue(client),
    mockClient: client,
  } as unknown as pg.Pool & { mockClient: typeof client };
}

describe('DocumentService Unit Tests (P1-EMP-04)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const employeeId = '22222222-2222-2222-2222-222222222222';
  const otherEmployeeId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';
  const fileId = '55555555-5555-5555-5555-555555555555';
  const docId = '66666666-6666-6666-6666-666666666666';

  let mockDocRepo: Partial<DocumentRepository>;
  let mockStorageRepo: Partial<StorageRepository>;
  let mockEmployeeRepo: Partial<EmployeeRepository>;
  let mockAuditService: Partial<AuditService>;
  let service: DocumentService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();

    mockDocRepo = {
      createDocument: vi.fn(),
      updateVerification: vi.fn(),
      listByEmployee: vi.fn(),
      findById: vi.fn(),
    };

    mockStorageRepo = {
      findById: vi.fn(),
    };

    mockEmployeeRepo = {
      findById: vi.fn(),
    };

    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue('audit-1'),
      recordOutboxEvent: vi.fn().mockResolvedValue('outbox-1'),
    };

    service = new DocumentService(
      mockDocRepo as DocumentRepository,
      mockStorageRepo as StorageRepository,
      mockEmployeeRepo as EmployeeRepository,
      mockAuditService as AuditService,
    );
  });

  const selfCtx: RequestContext = {
    requestId: 'req-1',
    companyId,
    userId,
    employeeId,
    isAuthenticated: true,
    roles: [SYSTEM_ROLES.EMPLOYEE],
    permissions: [],
  };

  const hrCtx: RequestContext = {
    requestId: 'req-2',
    companyId,
    userId,
    employeeId: otherEmployeeId,
    isAuthenticated: true,
    roles: [SYSTEM_ROLES.HR_MANAGER],
    permissions: [
      PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD,
      PERMISSIONS.EMPLOYEE_DOCUMENT_READ,
      PERMISSIONS.EMPLOYEE_DOCUMENT_VERIFY,
    ],
  };

  const unauthorizedCtx: RequestContext = {
    requestId: 'req-3',
    companyId,
    userId,
    employeeId: otherEmployeeId,
    isAuthenticated: true,
    roles: [SYSTEM_ROLES.EMPLOYEE],
    permissions: [],
  };

  it('rejects document upload if caller is not self and lacks EMPLOYEE_DOCUMENT_UPLOAD permission', async () => {
    await expect(
      service.uploadDocument(
        unauthorizedCtx,
        employeeId,
        { type: 'Passport', fileId },
        mockPool,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects document upload if target employee does not exist', async () => {
    vi.mocked(mockEmployeeRepo.findById!).mockResolvedValue(null);

    await expect(
      service.uploadDocument(
        selfCtx,
        employeeId,
        { type: 'Passport', fileId },
        mockPool,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects document upload if referenced storage file is missing', async () => {
    vi.mocked(mockEmployeeRepo.findById!).mockResolvedValue({ id: employeeId, companyId } as unknown as EmployeeRow);
    vi.mocked(mockStorageRepo.findById!).mockResolvedValue(null);

    await expect(
      service.uploadDocument(
        selfCtx,
        employeeId,
        { type: 'Passport', fileId },
        mockPool,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('successfully uploads document, emits transactional outbox event and records audit log', async () => {
    const dummyDoc: EmployeeDocumentRow = {
      id: docId,
      companyId,
      employeeId,
      fileId,
      type: 'Passport',
      status: 'pending',
      verifiedBy: null,
      verificationComment: null,
      expiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    };

    vi.mocked(mockEmployeeRepo.findById!).mockResolvedValue({ id: employeeId, companyId } as unknown as EmployeeRow);
    vi.mocked(mockStorageRepo.findById!).mockResolvedValue({ id: fileId, companyId, originalName: 'pass.pdf' } as unknown as FileRow);
    vi.mocked(mockDocRepo.createDocument!).mockResolvedValue(dummyDoc);

    const result = await service.uploadDocument(
      selfCtx,
      employeeId,
      { type: 'Passport', fileId },
      mockPool,
    );

    expect(result).toEqual(dummyDoc);
    expect(mockDocRepo.createDocument).toHaveBeenCalled();
    expect(mockAuditService.recordOutboxEvent).toHaveBeenCalledWith(
      selfCtx,
      'employee_document',
      'document.uploaded',
      expect.objectContaining({ documentId: docId, employeeId, type: 'Passport' }),
      expect.anything(),
    );
  });

  it('rejects verification if caller lacks EMPLOYEE_DOCUMENT_VERIFY permission', async () => {
    await expect(
      service.verifyDocument(
        selfCtx,
        employeeId,
        docId,
        { status: 'verified', comment: 'Approved' },
        mockPool,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects verification if document does not exist', async () => {
    vi.mocked(mockDocRepo.findById!).mockResolvedValue(null);

    await expect(
      service.verifyDocument(
        hrCtx,
        employeeId,
        docId,
        { status: 'verified', comment: 'Approved' },
        mockPool,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('successfully verifies document with status verified and records audit log', async () => {
    const existingDoc: EmployeeDocumentRow = {
      id: docId,
      companyId,
      employeeId,
      fileId,
      type: 'Identity Proof',
      status: 'pending',
      verifiedBy: null,
      verificationComment: null,
      expiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    };

    const verifiedDoc: EmployeeDocumentRow = {
      ...existingDoc,
      status: 'verified',
      verifiedBy: userId,
      verificationComment: 'Clear copy',
    };

    vi.mocked(mockDocRepo.findById!).mockResolvedValue(existingDoc);
    vi.mocked(mockDocRepo.updateVerification!).mockResolvedValue(verifiedDoc);

    const result = await service.verifyDocument(
      hrCtx,
      employeeId,
      docId,
      { status: 'verified', comment: 'Clear copy' },
      mockPool,
    );

    expect(result.status).toBe('verified');
    expect(mockDocRepo.updateVerification).toHaveBeenCalledWith(
      companyId,
      docId,
      {
        status: 'verified',
        verifiedBy: userId,
        verificationComment: 'Clear copy',
      },
      expect.anything(),
    );
    expect(mockAuditService.recordOutboxEvent).toHaveBeenCalledWith(
      hrCtx,
      'employee_document',
      'document.verified',
      expect.objectContaining({ documentId: docId, employeeId, status: 'verified' }),
      expect.anything(),
    );
  });

  it('lists documents for self without needing explicit permission', async () => {
    const docs: EmployeeDocumentRow[] = [
      {
        id: docId,
        companyId,
        employeeId,
        fileId,
        type: 'Resume',
        status: 'verified',
        verifiedBy: null,
        verificationComment: null,
        expiry: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        rowVersion: 1,
      },
    ];

    vi.mocked(mockDocRepo.listByEmployee!).mockResolvedValue(docs);

    const result = await service.listEmployeeDocuments(selfCtx, employeeId, mockPool);
    expect(result).toEqual(docs);
  });

  it('rejects listing documents for another employee if lacking EMPLOYEE_DOCUMENT_READ', async () => {
    await expect(
      service.listEmployeeDocuments(unauthorizedCtx, employeeId, mockPool),
    ).rejects.toThrow(ForbiddenError);
  });
});
