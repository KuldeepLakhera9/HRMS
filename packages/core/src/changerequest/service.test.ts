import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { ForbiddenError, NotFoundError, PERMISSIONS, SYSTEM_ROLES } from '@hrms/shared';
import { ChangeRequestService } from './service.js';
import type { ChangeRequestRepository, ChangeRequestRow } from './repository.js';
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

describe('ChangeRequestService Unit Tests (P1-EMP-05)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const employeeId = '22222222-2222-2222-2222-222222222222';
  const otherEmployeeId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';
  const reqId = '55555555-5555-5555-5555-555555555555';

  let mockChangeRepo: Partial<ChangeRequestRepository>;
  let mockEmployeeRepo: Partial<EmployeeRepository>;
  let mockAuditService: Partial<AuditService>;
  let service: ChangeRequestService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();

    mockChangeRepo = {
      createChangeRequest: vi.fn(),
      findById: vi.fn(),
      updateStatus: vi.fn(),
      listChangeRequests: vi.fn(),
    };

    mockEmployeeRepo = {
      findById: vi.fn(),
    };

    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue('audit-1'),
      recordOutboxEvent: vi.fn().mockResolvedValue('outbox-1'),
    };

    service = new ChangeRequestService(
      mockChangeRepo as ChangeRequestRepository,
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
      PERMISSIONS.EMPLOYEE_CHANGEREQUEST_APPROVE,
      PERMISSIONS.EMPLOYEE_CHANGEREQUEST_CREATE,
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

  it('rejects change request submission if caller is not self and lacks EMPLOYEE_CHANGEREQUEST_CREATE', async () => {
    await expect(
      service.submitChangeRequest(
        unauthorizedCtx,
        employeeId,
        { phone: '+1234567890' },
        mockPool,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects change request submission if employee does not exist', async () => {
    vi.mocked(mockEmployeeRepo.findById!).mockResolvedValue(null);

    await expect(
      service.submitChangeRequest(
        selfCtx,
        employeeId,
        { phone: '+1234567890' },
        mockPool,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('successfully submits change request and emits transactional outbox event', async () => {
    const dummyReq: ChangeRequestRow = {
      id: reqId,
      companyId,
      employeeId,
      changes: { phone: '+1234567890', maritalStatus: 'married' },
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    };

    vi.mocked(mockEmployeeRepo.findById!).mockResolvedValue({ id: employeeId, companyId } as unknown as EmployeeRow);
    vi.mocked(mockChangeRepo.createChangeRequest!).mockResolvedValue(dummyReq);

    const result = await service.submitChangeRequest(
      selfCtx,
      employeeId,
      { phone: '+1234567890', maritalStatus: 'married' },
      mockPool,
    );

    expect(result).toEqual(dummyReq);
    expect(mockChangeRepo.createChangeRequest).toHaveBeenCalledWith(
      companyId,
      {
        employeeId,
        changes: { phone: '+1234567890', maritalStatus: 'married' },
        createdBy: userId,
      },
      expect.anything(),
    );
    expect(mockAuditService.recordOutboxEvent).toHaveBeenCalledWith(
      selfCtx,
      'change_request',
      'change_request.created',
      expect.objectContaining({ requestId: reqId, employeeId }),
      expect.anything(),
    );
  });

  it('rejects decision if caller lacks EMPLOYEE_CHANGEREQUEST_APPROVE permission', async () => {
    await expect(
      service.decideChangeRequest(
        selfCtx,
        reqId,
        { decision: 'approved', comment: 'Looks good' },
        mockPool,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects decision if request is already decided (not pending)', async () => {
    const nonPendingReq: ChangeRequestRow = {
      id: reqId,
      companyId,
      employeeId,
      changes: { phone: '+9876543210' },
      status: 'approved',
      decidedBy: userId,
      decidedAt: new Date(),
      comment: 'Previously approved',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    };

    vi.mocked(mockChangeRepo.findById!).mockResolvedValue(nonPendingReq);

    await expect(
      service.decideChangeRequest(
        hrCtx,
        reqId,
        { decision: 'rejected', comment: 'Duplicate' },
        mockPool,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('approves change request, applies fields directly to employee table, and emits domain events', async () => {
    const pendingReq: ChangeRequestRow = {
      id: reqId,
      companyId,
      employeeId,
      changes: { phone: '+9876543210', maritalStatus: 'married' },
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    };

    const approvedReq: ChangeRequestRow = {
      ...pendingReq,
      status: 'approved',
      decidedBy: userId,
      decidedAt: new Date(),
      comment: 'Valid documentation provided',
    };

    vi.mocked(mockChangeRepo.findById!).mockResolvedValue(pendingReq);
    vi.mocked(mockChangeRepo.updateStatus!).mockResolvedValue(approvedReq);

    const result = await service.decideChangeRequest(
      hrCtx,
      reqId,
      { decision: 'approved', comment: 'Valid documentation provided' },
      mockPool,
    );

    expect(result.status).toBe('approved');
    // Verify update query executed on mock client for employee table
    expect(mockPool.mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE employees'),
      expect.arrayContaining([companyId, employeeId, '+9876543210', 'married']),
    );
    // Audit event for profile update
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      hrCtx,
      expect.objectContaining({
        action: 'employee.profile.change_request_approved',
        entity: 'employee',
        entityId: employeeId,
      }),
    );
    // Outbox event for approval notification
    expect(mockAuditService.recordOutboxEvent).toHaveBeenCalledWith(
      hrCtx,
      'change_request',
      'change_request.decided',
      expect.objectContaining({ requestId: reqId, decision: 'approved' }),
      expect.anything(),
    );
  });

  it('rejects change request with comment and emits outbox decision event without modifying employee table', async () => {
    const pendingReq: ChangeRequestRow = {
      id: reqId,
      companyId,
      employeeId,
      changes: { phone: '+9876543210' },
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    };

    const rejectedReq: ChangeRequestRow = {
      ...pendingReq,
      status: 'rejected',
      decidedBy: userId,
      decidedAt: new Date(),
      comment: 'Invalid phone format',
    };

    vi.mocked(mockChangeRepo.findById!).mockResolvedValue(pendingReq);
    vi.mocked(mockChangeRepo.updateStatus!).mockResolvedValue(rejectedReq);

    const result = await service.decideChangeRequest(
      hrCtx,
      reqId,
      { decision: 'rejected', comment: 'Invalid phone format' },
      mockPool,
    );

    expect(result.status).toBe('rejected');
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      hrCtx,
      expect.objectContaining({
        action: 'employee.profile.change_request_rejected',
        entity: 'change_request',
        entityId: reqId,
      }),
    );
    expect(mockAuditService.recordOutboxEvent).toHaveBeenCalledWith(
      hrCtx,
      'change_request',
      'change_request.decided',
      expect.objectContaining({ requestId: reqId, decision: 'rejected' }),
      expect.anything(),
    );
  });
});
