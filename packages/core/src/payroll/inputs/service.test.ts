import { describe, it, expect, vi } from 'vitest';
import { PayrollInputService } from './service.js';
import { Database } from '@hrms/db';
import { PERMISSIONS, ForbiddenError } from '@hrms/shared';

describe('Payroll Input Pipeline & SoD Approvals (P4-RUN-01)', () => {
  const service = new PayrollInputService();

  const makerCtx = {
    companyId: 'comp-1',
    userId: 'maker-hr-1',
    requestId: 'req-maker',
    isAuthenticated: true,
    roles: ['hr_manager'],
    permissions: [PERMISSIONS.PAYROLL_INPUT_CREATE],
  };

  const checkerCtx = {
    companyId: 'comp-1',
    userId: 'checker-finance-1',
    requestId: 'req-checker',
    isAuthenticated: true,
    roles: ['finance_head'],
    permissions: [PERMISSIONS.PAYROLL_INPUT_APPROVE],
  };

  it('creates pending payroll inputs by default', async () => {
    const mockDbInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: 'input-1',
            companyId: 'comp-1',
            employeeId: 'emp-101',
            type: 'bonus',
            componentCode: 'BONUS',
            amount: '50000.00',
            taxable: true,
            forPeriod: '2026-10',
            status: 'pending',
            createdBy: 'maker-hr-1',
          },
        ]),
      }),
    });

    const mockDb = { insert: mockDbInsert } as unknown as Database;

    const res = await service.createInput(makerCtx, mockDb, {
      employeeId: 'emp-101',
      type: 'bonus',
      componentCode: 'BONUS',
      amount: '50000.00',
      forPeriod: '2026-10',
    });

    expect(res.status).toBe('pending');
    expect(res.amount).toBe('50000.00');
  });

  it('enforces SoD: creator cannot approve their own payroll input', async () => {
    const mockDbSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 'input-1',
            companyId: 'comp-1',
            createdBy: 'maker-hr-1',
            status: 'pending',
          },
        ]),
      }),
    });

    const mockDb = { select: mockDbSelect } as unknown as Database;

    // Maker attempting to approve own input
    const makerAttemptingApprovalCtx = {
      ...makerCtx,
      permissions: [PERMISSIONS.PAYROLL_INPUT_APPROVE],
    };

    await expect(
      service.approveInput(makerAttemptingApprovalCtx, mockDb, 'input-1'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows distinct checker to approve the input', async () => {
    const mockDbSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 'input-1',
            companyId: 'comp-1',
            createdBy: 'maker-hr-1',
            status: 'pending',
          },
        ]),
      }),
    });

    const mockDbUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: 'input-1',
              companyId: 'comp-1',
              createdBy: 'maker-hr-1',
              status: 'approved',
              approvedBy: 'checker-finance-1',
            },
          ]),
        }),
      }),
    });

    const mockDb = {
      select: mockDbSelect,
      update: mockDbUpdate,
    } as unknown as Database;

    const res = await service.approveInput(checkerCtx, mockDb, 'input-1');
    expect(res.status).toBe('approved');
    expect(res.approvedBy).toBe('checker-finance-1');
  });
});
