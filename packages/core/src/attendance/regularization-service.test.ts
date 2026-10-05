import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegularizationService } from './regularization-service.js';
import type { RegularizationRepository } from './regularization-repository.js';
import type { AttendanceLockService } from './lock-service.js';
import type { AttendanceDayService, RecomputeDayResult } from './day-service.js';
import type { WorkflowService } from '../workflow/service.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';
import { ConflictError, ValidationError, ForbiddenError } from '@hrms/shared';

describe('RegularizationService (P2-DAY-04)', () => {
  let service: RegularizationService;
  let mockRepo: Partial<RegularizationRepository>;
  let mockLockService: Partial<AttendanceLockService>;
  let mockDayService: Partial<AttendanceDayService>;
  let mockWorkflowService: Partial<WorkflowService>;
  let mockAuditService: Partial<AuditService>;

  const sampleCompanyId = '00000000-0000-0000-0000-000000000001';
  const sampleEmployeeId = '00000000-0000-0000-0000-000000000010';
  const sampleAdminId = '00000000-0000-0000-0000-000000000099';

  const userCtx: RequestContext = {
    companyId: sampleCompanyId,
    userId: sampleAdminId,
    employeeId: sampleEmployeeId,
    roles: ['employee'],
    permissions: [],
    requestId: 'req-reg-01',
    isAuthenticated: true,
  };

  const adminCtx: RequestContext = {
    companyId: sampleCompanyId,
    userId: sampleAdminId,
    employeeId: '00000000-0000-0000-0000-000000000098',
    roles: ['hr_manager'],
    permissions: [
      'attendance.regularization.create',
      'attendance.regularization.read',
      'attendance.regularization.approve',
    ],
    requestId: 'req-reg-admin',
    isAuthenticated: true,
  };

  beforeEach(() => {
    mockRepo = {
      createRequest: vi.fn().mockImplementation((_cid, input) => Promise.resolve({
        id: 'reg-001',
        companyId: sampleCompanyId,
        employeeId: input.employeeId,
        date: input.date,
        requestType: input.requestType,
        inTime: input.inTime,
        outTime: input.outTime,
        reason: input.reason,
        status: 'pending',
        workflowRequestId: undefined,
        syntheticInPunchId: null,
        syntheticOutPunchId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        deletedAt: null,
        rowVersion: 1,
      })),
      getRequestById: vi.fn().mockResolvedValue({
        id: 'reg-001',
        companyId: sampleCompanyId,
        employeeId: sampleEmployeeId,
        date: '2026-03-10',
        requestType: 'punch_missing',
        inTime: '09:00:00',
        outTime: '18:00:00',
        reason: 'Client site visit with no connectivity',
        status: 'pending',
        workflowRequestId: 'wf-001',
        syntheticInPunchId: null,
        syntheticOutPunchId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: sampleAdminId,
        updatedBy: sampleAdminId,
        deletedAt: null,
        rowVersion: 1,
      }),
      updateStatus: vi.fn().mockImplementation((_cid, id, status, syn, updatedBy) => Promise.resolve({
        id,
        companyId: sampleCompanyId,
        employeeId: sampleEmployeeId,
        date: '2026-03-10',
        requestType: 'punch_missing',
        inTime: '09:00:00',
        outTime: '18:00:00',
        reason: 'Client site visit with no connectivity',
        status,
        syntheticInPunchId: syn?.inPunchId ?? null,
        syntheticOutPunchId: syn?.outPunchId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: sampleAdminId,
        updatedBy,
        deletedAt: null,
        rowVersion: 2,
      })),
      insertSyntheticPunch: vi.fn().mockResolvedValue('synthetic-punch-id-123'),
      listRequests: vi.fn().mockResolvedValue([]),
    };

    mockLockService = {
      isDateLocked: vi.fn().mockResolvedValue(false),
    };

    mockDayService = {
      recomputeDay: vi.fn().mockResolvedValue({} as unknown as RecomputeDayResult),
    };

    mockWorkflowService = {
      submitRequest: vi.fn().mockResolvedValue({ requestId: 'wf-001', status: 'pending' }),
    };

    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    };

    service = new RegularizationService(
      mockRepo as RegularizationRepository,
      mockLockService as AttendanceLockService,
      mockDayService as AttendanceDayService,
      mockWorkflowService as WorkflowService,
      mockAuditService as AuditService,
    );
  });

  it('submits a regularization request and routes it to the workflow engine', async () => {
    const res = await service.submitRequest(userCtx, {
      date: '2026-03-10',
      requestType: 'punch_missing',
      inTime: '09:00:00',
      outTime: '18:00:00',
      reason: 'Biometric device offline during entry',
    });

    expect(res).toBeDefined();
    expect(res.status).toBe('pending');
    expect(mockRepo.createRequest).toHaveBeenCalled();
    expect(mockWorkflowService.submitRequest).toHaveBeenCalledWith(
      userCtx,
      expect.objectContaining({
        definitionCode: 'attendance_regularization',
        entityType: 'attendance_regularization',
      }),
      undefined,
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      userCtx,
      expect.objectContaining({
        action: 'attendance.regularization.requested',
      }),
    );
  });

  it('rejects regularization request for dates in a locked period (immutability)', async () => {
    vi.mocked(mockLockService.isDateLocked!).mockResolvedValueOnce(true);

    await expect(
      service.submitRequest(userCtx, {
        date: '2026-01-15',
        requestType: 'punch_missing',
        reason: 'Forgot to clock in',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('rejects regularization request for future dates', async () => {
    await expect(
      service.submitRequest(userCtx, {
        date: '2099-01-01',
        requestType: 'punch_missing',
        reason: 'Future punch',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('approves regularization: creates synthetic punches and recalculates day', async () => {
    const res = await service.decideRequest(adminCtx, 'reg-001', {
      action: 'approve',
      comments: 'Approved by manager',
    });

    expect(res.status).toBe('approved');
    // Both IN and OUT punches synthesized
    expect(mockRepo.insertSyntheticPunch).toHaveBeenCalledTimes(2);
    expect(mockDayService.recomputeDay).toHaveBeenCalledWith(
      adminCtx,
      sampleEmployeeId,
      '2026-03-10',
      undefined,
    );
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      adminCtx,
      expect.objectContaining({
        action: 'attendance.regularization.approved',
      }),
    );
  });

  it('rejects regularization: does not synthesize punches or recalculate', async () => {
    const res = await service.decideRequest(adminCtx, 'reg-001', {
      action: 'reject',
      comments: 'Insufficient justification',
    });

    expect(res.status).toBe('rejected');
    expect(mockRepo.insertSyntheticPunch).not.toHaveBeenCalled();
    expect(mockDayService.recomputeDay).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      adminCtx,
      expect.objectContaining({
        action: 'attendance.regularization.rejected',
      }),
    );
  });

  it('prevents non-manager from approving regularizations', async () => {
    await expect(
      service.decideRequest(userCtx, 'reg-001', {
        action: 'approve',
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});
