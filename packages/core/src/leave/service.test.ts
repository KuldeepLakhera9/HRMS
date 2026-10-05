import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeaveService, type SubmitLeaveInput } from './service.js';
import type { LeaveBalanceRepository } from './balance-repository.js';
import type { LeaveLedgerRepository } from './ledger-repository.js';
import type { LeavePolicyResolver } from './policy-resolver.js';
import type { HolidayService } from './holiday-service.js';
import type { WorkflowService } from '../workflow/service.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';
import { PERMISSIONS } from '@hrms/shared';
import type pg from 'pg';

describe('LeaveService Unit Tests (PHASE3_SPEC Section 5.2)', () => {
  let service: LeaveService;
  let mockBalanceRepo: LeaveBalanceRepository;
  let mockLedgerRepo: LeaveLedgerRepository;
  let mockPolicyResolver: LeavePolicyResolver;
  let mockHolidayService: HolidayService;
  let mockWorkflowService: WorkflowService;
  let mockAuditService: AuditService;

  const baseCtx: RequestContext = {
    isAuthenticated: true,
    companyId: '11111111-1111-7111-8111-111111111111',
    userId: '22222222-2222-7222-8222-222222222222',
    employeeId: '33333333-3333-7333-8333-333333333333',
    roles: ['employee'],
    permissions: [
      PERMISSIONS.LEAVE_REQUEST_CREATE,
      PERMISSIONS.LEAVE_REQUEST_READ,
      PERMISSIONS.LEAVE_REQUEST_CANCEL,
      PERMISSIONS.LEAVE_REQUEST_APPROVE,
    ],
    requestId: 'req-test-1',
  };

  beforeEach(() => {
    mockBalanceRepo = {
      getOrCreateBalance: vi.fn().mockResolvedValue({
        id: 'bal-1',
        closing: '10.000',
        pending: '0.000',
      }),
      lockBalanceForUpdate: vi.fn().mockResolvedValue({
        id: 'bal-1',
        closing: '10.000',
        pending: '0.000',
        used: '2.000',
      }),
      updateBalance: vi.fn().mockResolvedValue({
        id: 'bal-1',
        closing: '10.000',
        pending: '2.000',
      }),
    } as unknown as LeaveBalanceRepository;

    mockLedgerRepo = {
      recordEntry: vi.fn().mockResolvedValue({
        id: 'led-1',
      }),
    } as unknown as LeaveLedgerRepository;

    mockPolicyResolver = {
      resolvePolicy: vi.fn().mockResolvedValue({
        policy: {
          id: 'pol-1',
          version: 1,
        },
      }),
    } as unknown as LeavePolicyResolver;

    mockHolidayService = {
      resolveHolidaysForEmployee: vi.fn().mockResolvedValue([]),
    } as unknown as HolidayService;

    mockWorkflowService = {
      simulateWorkflow: vi.fn().mockResolvedValue({
        steps: [{ stepIndex: 0, name: 'Manager Approval', approverType: 'manager' }],
      }),
      submitRequest: vi.fn().mockResolvedValue({
        requestId: 'wf-1',
        status: 'pending',
      }),
    } as unknown as WorkflowService;

    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue('audit-1'),
      recordOutboxEvent: vi.fn().mockResolvedValue('outbox-1'),
    } as unknown as AuditService;

    service = new LeaveService(
      mockBalanceRepo,
      mockLedgerRepo,
      mockPolicyResolver,
      mockHolidayService,
      mockWorkflowService,
      mockAuditService,
    );
  });

  it('validates input and throws ValidationError if reason is empty on submitRequest', async () => {
    const input: SubmitLeaveInput = {
      employeeId: baseCtx.employeeId,
      leaveTypeId: 'lt-1',
      fromDate: '2026-05-10',
      toDate: '2026-05-12',
      reason: '   ',
    };

    await expect(service.submitRequest(baseCtx, input)).rejects.toThrow(
      'A reason is mandatory for leave requests.',
    );
  });

  it('rejects leave submission if payable days exceed available balance', async () => {
    // Balance available is 1, but requesting 3 days
    (
      mockBalanceRepo.lockBalanceForUpdate as unknown as {
        mockResolvedValueOnce: (val: unknown) => void;
      }
    ).mockResolvedValueOnce({
      id: 'bal-1',
      closing: '1.000',
      pending: '0.000',
      used: '0.000',
    });

    const mockPoolClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM employees')) {
          return {
            rows: [
              {
                id: baseCtx.employeeId,
                doj: '2025-01-01',
                gender: 'female',
                employment_type: 'full_time',
                location_id: 'loc-1',
                department_id: 'dept-1',
                timezone: 'Asia/Kolkata',
              },
            ],
          };
        }
        if (sql.includes('FROM leave_types')) {
          return {
            rows: [
              {
                id: 'lt-1',
                code: 'AL',
                name: 'Annual Leave',
                isPaid: true,
                unit: 'day',
                allowHalfDay: true,
                allowHourly: false,
                minNoticeDays: 0,
                sandwichRule: 'none',
                genderAllowed: 'all',
                minServiceDays: 0,
              },
            ],
          };
        }
        if (sql.includes('FROM leave_request_days')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as pg.PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockPoolClient),
    } as unknown as pg.Pool;

    const input: SubmitLeaveInput = {
      employeeId: baseCtx.employeeId,
      leaveTypeId: 'lt-1',
      fromDate: '2026-05-11', // Monday
      toDate: '2026-05-13',   // Wednesday (3 days)
      reason: 'Family trip',
    };

    await expect(service.submitRequest(baseCtx, input, mockPool)).rejects.toThrow(
      'Insufficient leave balance',
    );
  });

  it('previewLeave returns breakdown, warnings, clash warnings, and approval route', async () => {
    const mockPoolClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM employees') && sql.includes('LIMIT 1')) {
          return {
            rows: [
              {
                id: baseCtx.employeeId,
                doj: '2025-01-01',
                gender: 'female',
                employment_type: 'full_time',
                location_id: 'loc-1',
                department_id: 'dept-1',
                timezone: 'Asia/Kolkata',
                first_name: 'Jane',
                last_name: 'Doe',
              },
            ],
          };
        }
        if (sql.includes('FROM leave_types')) {
          return {
            rows: [
              {
                id: 'lt-1',
                code: 'AL',
                name: 'Annual Leave',
                isPaid: true,
                unit: 'day',
                allowHalfDay: true,
                allowHourly: false,
                minNoticeDays: 0,
                sandwichRule: 'none',
                genderAllowed: 'all',
                minServiceDays: 0,
              },
            ],
          };
        }
        if (sql.includes('FROM leave_request_days') && sql.includes('WHERE d.company_id = $1')) {
          // Clash detection returns a colleague on leave
          return {
            rows: [
              {
                leave_date: '2026-05-11',
                employee_id: 'emp-colleague-1',
                first_name: 'Alice',
                last_name: 'Smith',
              },
            ],
          };
        }
        if (sql.includes('FROM leave_request_days')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as pg.PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockPoolClient),
    } as unknown as pg.Pool;

    const res = await service.previewLeave(
      baseCtx,
      {
        leaveTypeId: 'lt-1',
        fromDate: '2026-05-11',
        toDate: '2026-05-12',
      },
      mockPool,
    );

    expect(res.payableDays).toBe(2);
    expect(res.clashWarnings.length).toBe(1);
    expect(res.clashWarnings[0]?.employeeName).toBe('Alice Smith');
    expect(res.approvalRoute.length).toBe(1);
    expect(res.balanceBefore).toBe(10);
    expect(res.balanceAfter).toBe(8);
  });

  it('cancelRequest verifies status, appends reversal ledger, updates used balance, and emits events', async () => {
    let balanceUpdated = false;
    let ledgerRecorded = false;

    (mockBalanceRepo.updateBalance as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async () => {
        balanceUpdated = true;
        return { id: 'bal-1' };
      },
    );

    (mockLedgerRepo.recordEntry as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async () => {
        ledgerRecorded = true;
        return { id: 'led-rev-1' };
      },
    );

    const mockPoolClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM leave_requests') && sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: 'req-approved-1',
                employeeId: baseCtx.employeeId,
                leaveTypeId: 'lt-1',
                fromDate: '2026-05-11',
                toDate: '2026-05-12',
                days: '2.000',
                status: 'approved',
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as pg.PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockPoolClient),
    } as unknown as pg.Pool;

    await service.cancelRequest(baseCtx, 'req-approved-1', 'Project emergency', mockPool);

    expect(balanceUpdated).toBe(true);
    expect(ledgerRecorded).toBe(true);
    expect(mockAuditService.recordOutboxEvent).toHaveBeenCalledWith(
      baseCtx,
      'leave_request',
      'leave.cancelled',
      expect.objectContaining({ requestId: 'req-approved-1' }),
      expect.anything(),
    );
  });
});

