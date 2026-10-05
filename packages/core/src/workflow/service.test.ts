import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenError, UnauthorizedError, PERMISSIONS } from '@hrms/shared';
import { WorkflowService } from './service.js';
import type { WorkflowRepository } from './repository.js';
import type { RequestContext } from '../routing/context.js';
import type { AuditService } from '../audit/service.js';

describe('WorkflowService Unit Tests (P2-WF-01, P2-WF-02, P2-WF-03)', () => {
  let service: WorkflowService;
  let mockRepo: Partial<WorkflowRepository>;
  let mockAudit: Partial<AuditService>;

  const baseCtx: RequestContext = {
    companyId: 'comp-123',
    userId: 'user-admin',
    employeeId: 'emp-admin',
    roles: ['admin'],
    permissions: [PERMISSIONS.WORKFLOW_DEFINITION_MANAGE, PERMISSIONS.WORKFLOW_REQUEST_CREATE],
    requestId: 'req-1',
    isAuthenticated: true,
  };

  beforeEach(() => {
    mockRepo = {
      createDefinition: vi.fn().mockResolvedValue({ id: 'def-1', version: 1 }),
      createRequest: vi.fn().mockResolvedValue({ requestId: 'req-101', status: 'pending' }),
      getInbox: vi.fn().mockResolvedValue({
        items: [
          {
            assigneeRecordId: 'assign-1',
            requestId: 'req-101',
            stepId: 'step-1',
            stepName: 'Manager Approval',
            stepIndex: 0,
            entityType: 'attendance_regularization',
            entityId: 'att-1',
            requesterId: 'emp-2',
            requesterName: 'Jane Smith',
            status: 'pending',
            payload: { reason: 'Forgot to punch' },
            dueAt: null,
            isDelegated: false,
            createdAt: '2026-10-01T10:00:00Z',
          },
        ],
      }),
      executeAction: vi.fn().mockResolvedValue({ status: 'approved' }),
    };

    mockAudit = {
      recordEvent: vi.fn().mockResolvedValue('audit-1'),
    };

    service = new WorkflowService(mockRepo as WorkflowRepository, mockAudit as AuditService);
  });

  it('creates workflow definition when caller has permission', async () => {
    const result = await service.createDefinition(baseCtx, {
      code: 'att_reg_v1',
      name: 'Attendance Regularization',
      entityType: 'attendance_regularization',
      steps: [
        {
          stepIndex: 0,
          name: 'Manager Approval',
          mode: 'any',
          resolver: { type: 'reporting_manager' },
        },
      ],
    });

    expect(result.id).toBe('def-1');
    expect(result.version).toBe(1);
    expect(mockRepo.createDefinition).toHaveBeenCalled();
    expect(mockAudit.recordEvent).toHaveBeenCalled();
  });

  it('rejects definition creation without permission', async () => {
    const unauthCtx: RequestContext = {
      ...baseCtx,
      permissions: [],
    };

    await expect(
      service.createDefinition(unauthCtx, {
        code: 'test',
        name: 'test',
        entityType: 'test',
        steps: [{ stepIndex: 0, name: 'S1', mode: 'any', resolver: { type: 'reporting_manager' } }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('submits a request and records audit event', async () => {
    const res = await service.submitRequest(baseCtx, {
      definitionCode: 'att_reg_v1',
      entityType: 'attendance_regularization',
      entityId: 'att-1',
      payload: { reason: 'Traffic delay' },
    });

    expect(res.requestId).toBe('req-101');
    expect(res.status).toBe('pending');
    expect(mockRepo.createRequest).toHaveBeenCalled();
    expect(mockAudit.recordEvent).toHaveBeenCalled();
  });

  it('fetches inbox items for authenticated employee', async () => {
    const inbox = await service.getInbox(baseCtx, { status: 'pending' });

    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.requesterName).toBe('Jane Smith');
    expect(mockRepo.getInbox).toHaveBeenCalledWith('comp-123', 'emp-admin', { status: 'pending' }, undefined);
  });

  it('executes approval action and records audit event', async () => {
    const res = await service.executeAction(baseCtx, {
      requestId: 'req-101',
      action: 'approve',
      comments: 'Looks good',
    });

    expect(res.status).toBe('approved');
    expect(mockRepo.executeAction).toHaveBeenCalled();
    expect(mockAudit.recordEvent).toHaveBeenCalled();
  });

  it('rejects anonymous access to inbox', async () => {
    const anonCtx: RequestContext = {
      ...baseCtx,
      isAuthenticated: false,
    };

    await expect(service.getInbox(anonCtx, {})).rejects.toThrow(UnauthorizedError);
  });

  it('lists workflow definitions for authenticated user', async () => {
    mockRepo.listDefinitions = vi.fn().mockResolvedValue([
      {
        id: 'def-1',
        code: 'profile_change',
        name: 'Profile Change',
        entityType: 'change_request',
        version: 1,
        isActive: true,
        steps: [],
        createdAt: new Date(),
      },
    ]);

    const defs = await service.listDefinitions(baseCtx);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.code).toBe('profile_change');
  });

  it('simulates workflow evaluation with conditions (P2-WF-06)', async () => {
    const sim = await service.simulateWorkflow(baseCtx, {
      steps: [
        {
          stepIndex: 0,
          name: 'Low Value Approval',
          mode: 'any',
          resolver: { type: 'reporting_manager' },
          condition: { field: 'amount', op: '<=', value: 1000 },
        },
        {
          stepIndex: 1,
          name: 'Executive Review',
          mode: 'any',
          resolver: { type: 'role', roleName: 'cfo' },
          condition: { field: 'amount', op: '>', value: 1000 },
        },
      ],
      payload: { amount: 5000 },
    });

    expect(sim.activeStepCount).toBe(1);
    expect(sim.autoApproved).toBe(false);
    expect(sim.steps[0]?.conditionMet).toBe(false);
    expect(sim.steps[1]?.conditionMet).toBe(true);
    expect(sim.steps[1]?.approverRole).toBe('cfo');
  });
});

