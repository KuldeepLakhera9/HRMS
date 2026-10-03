import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { ForbiddenError, PERMISSIONS, SYSTEM_ROLES } from '@hrms/shared';
import { EmployeeService } from './service.js';
import type { EmployeeRepository, DirectoryEmployeeRow, EmployeeRow } from './repository.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';
import { encryptSensitiveField } from './crypto.js';

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

describe('Employee Directory & Profile Service Unit Tests (P1-EMP-03)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const employeeId = '22222222-2222-2222-2222-222222222222';
  const userId = '33333333-3333-3333-3333-333333333333';

  let mockRepo: Partial<EmployeeRepository>;
  let mockAuditService: Partial<AuditService>;
  let service: EmployeeService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();

    mockRepo = {
      getDirectory: vi.fn(),
      findById: vi.fn(),
    };

    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue('audit-1'),
    };

    service = new EmployeeService(
      mockRepo as EmployeeRepository,
      mockAuditService as AuditService,
    );
  });

  const authCtx: RequestContext = {
    requestId: 'req-1',
    companyId,
    userId,
    employeeId,
    isAuthenticated: true,
    roles: [SYSTEM_ROLES.HR_MANAGER],
    permissions: [
      PERMISSIONS.EMPLOYEE_PROFILE_READ,
      PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE,
    ],
  };

  const stepUpCtx: RequestContext = {
    ...authCtx,
    stepUpUntil: new Date(Date.now() + 15 * 60 * 1000), // 15 mins in future
  };

  const expiredStepUpCtx: RequestContext = {
    ...authCtx,
    stepUpUntil: new Date(Date.now() - 60 * 1000), // expired 1 min ago
  };

  const unauthorizedCtx: RequestContext = {
    requestId: 'req-2',
    companyId,
    userId,
    isAuthenticated: true,
    roles: [SYSTEM_ROLES.EMPLOYEE],
    permissions: [],
  };

  it('rejects getDirectory when caller lacks EMPLOYEE_PROFILE_READ permission', async () => {
    await expect(
      service.getDirectory(unauthorizedCtx, { limit: 20 }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('successfully returns directory items and keyset cursor when authorized', async () => {
    const dummyItems: DirectoryEmployeeRow[] = [
      {
        id: employeeId,
        empCode: 'EMP001',
        firstName: 'Jane',
        lastName: 'Doe',
        fullName: 'Jane Doe',
        emailWork: 'jane.doe@example.com',
        phone: '+1234567890',
        status: 'active',
        employmentType: 'full_time',
        departmentId: null,
        departmentName: null,
        designationId: null,
        designationName: null,
        locationId: null,
        locationName: null,
        doj: '2024-01-01',
        createdAt: new Date(),
      },
    ];

    vi.mocked(mockRepo.getDirectory!).mockResolvedValue({
      items: dummyItems,
      nextCursor: 'EMP001:2024-01-01',
      total: 1,
    });

    const result = await service.getDirectory(authCtx, { limit: 20, search: 'Jane' });

    expect(result.items).toEqual(dummyItems);
    expect(result.nextCursor).toBe('EMP001:2024-01-01');
    expect(result.total).toBe(1);
    expect(mockRepo.getDirectory).toHaveBeenCalledWith(
      companyId,
      { limit: 20, search: 'Jane' },
      undefined,
    );
  });

  it('rejects getSensitiveFields if caller lacks EMPLOYEE_PROFILE_VIEW_SENSITIVE', async () => {
    await expect(
      service.getSensitiveFields(unauthorizedCtx, employeeId),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects getSensitiveFields without active step-up elevation', async () => {
    // Missing stepUpUntil
    await expect(
      service.getSensitiveFields(authCtx, employeeId),
    ).rejects.toThrow(ForbiddenError);

    // Expired stepUpUntil
    await expect(
      service.getSensitiveFields(expiredStepUpCtx, employeeId),
    ).rejects.toThrow(ForbiddenError);
  });

  it('successfully unmasks and decrypts sensitive fields with step-up elevation and logs audit trail', async () => {
    const rawPan = 'ABCDE1234F';
    const rawAadhaar = '1234-5678-9012';
    const rawBank = '9876543210123';

    vi.mocked(mockRepo.findById!).mockResolvedValue({
      id: employeeId,
      companyId,
      empCode: 'EMP001',
      panEnc: encryptSensitiveField(rawPan),
      aadhaarEnc: encryptSensitiveField(rawAadhaar),
      bankEnc: encryptSensitiveField(rawBank),
    } as unknown as EmployeeRow);

    const result = await service.getSensitiveFields(stepUpCtx, employeeId, mockPool);

    expect(result.pan).toBe(rawPan);
    expect(result.aadhaar).toBe(rawAadhaar);
    expect(result.bankAccount).toBe(rawBank);

    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      stepUpCtx,
      expect.objectContaining({
        action: 'employee.view_sensitive',
        entity: 'employee',
        entityId: employeeId,
        meta: {
          empCode: 'EMP001',
          unmaskedFields: ['bankAccount', 'pan', 'aadhaar'],
        },
      }),
    );
  });
});
