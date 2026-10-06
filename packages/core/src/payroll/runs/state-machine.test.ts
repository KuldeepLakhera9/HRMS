import { describe, it, expect, vi } from 'vitest';
import {
  isAllowedTransition,
  executeRunTransition,
} from './state-machine.js';
import { Database, PayrollRun } from '@hrms/db';
import { PERMISSIONS, ForbiddenError, ValidationError } from '@hrms/shared';

describe('Payroll Run State Machine & Precondition Guards (P4-RUN-02)', () => {
  describe('1. Transition Graph Integrity', () => {
    it('allows valid sequential transitions', () => {
      expect(isAllowedTransition('draft', 'inputs_ready')).toBe(true);
      expect(isAllowedTransition('inputs_ready', 'calculating')).toBe(true);
      expect(isAllowedTransition('calculating', 'calculated')).toBe(true);
      expect(isAllowedTransition('calculated', 'review')).toBe(true);
      expect(isAllowedTransition('review', 'approved')).toBe(true);
      expect(isAllowedTransition('approved', 'locking')).toBe(true);
      expect(isAllowedTransition('locking', 'locked')).toBe(true);
      expect(isAllowedTransition('locked', 'published')).toBe(true);
      expect(isAllowedTransition('published', 'paid')).toBe(true);
    });

    it('allows re-opening run when inputs change', () => {
      expect(isAllowedTransition('inputs_ready', 'draft')).toBe(true);
      expect(isAllowedTransition('calculated', 'draft')).toBe(true);
      expect(isAllowedTransition('review', 'draft')).toBe(true);
    });

    it('allows controlled unlock from locked to review', () => {
      expect(isAllowedTransition('locked', 'review')).toBe(true);
    });

    it('strictly forbids unlocking after published or paid', () => {
      expect(isAllowedTransition('published', 'review')).toBe(false);
      expect(isAllowedTransition('paid', 'review')).toBe(false);
      expect(isAllowedTransition('published', 'draft')).toBe(false);
      expect(isAllowedTransition('paid', 'draft')).toBe(false);
    });

    it('forbids skipping states (e.g. draft directly to locked or approved)', () => {
      expect(isAllowedTransition('draft', 'approved')).toBe(false);
      expect(isAllowedTransition('draft', 'locked')).toBe(false);
      expect(isAllowedTransition('calculating', 'published')).toBe(false);
    });
  });

  describe('2. Guarded executeRunTransition execution', () => {
    const baseRun: PayrollRun = {
      id: 'run-1',
      companyId: 'comp-1',
      periodId: 'period-1',
      runType: 'regular',
      sequence: 1,
      status: 'review',
      calcVersion: 1,
      ruleVersions: {},
      settingsSnapshot: {},
      engineVersion: '1.0.0',
      counts: { total: 10, included: 10, held: 0, excluded: 0, errors: 0 },
      totals: { gross: '100000.00', deductions: '20000.00', employerCost: '110000.00', net: '80000.00' },
      approvedBy: null,
      lockedBy: null,
      lockedAt: null,
      runHash: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'maker-hr-1',
      updatedBy: 'maker-hr-1',
      deletedAt: null,
      rowVersion: 1,
    };

    const mockDbSelectForUpdate = vi.fn();
    const mockDbUpdate = vi.fn();
    const mockDbInsertEvent = vi.fn();

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            for: mockDbSelectForUpdate,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: mockDbUpdate,
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: mockDbInsertEvent.mockResolvedValue({}),
      }),
    } as unknown as Database;

    it('enforces SoD: Creator cannot approve the run', async () => {
      mockDbSelectForUpdate.mockResolvedValue([baseRun]);

      const makerAttemptingApprovalCtx = {
        companyId: 'comp-1',
        userId: 'maker-hr-1', // same as createdBy
        requestId: 'req-appr',
        isAuthenticated: true,
        roles: ['hr_manager'],
        permissions: [PERMISSIONS.PAYROLL_RUN_APPROVE],
      };

      await expect(
        executeRunTransition(makerAttemptingApprovalCtx, mockDb, 'run-1', 'approved'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows distinct checker to approve the run and logs event', async () => {
      mockDbSelectForUpdate.mockResolvedValue([baseRun]);
      mockDbUpdate.mockResolvedValue([{ ...baseRun, status: 'approved', approvedBy: 'checker-finance-1' }]);

      const checkerCtx = {
        companyId: 'comp-1',
        userId: 'checker-finance-1', // distinct from maker-hr-1
        requestId: 'req-appr',
        isAuthenticated: true,
        roles: ['finance_head'],
        permissions: [PERMISSIONS.PAYROLL_RUN_APPROVE],
      };

      const result = await executeRunTransition(checkerCtx, mockDb, 'run-1', 'approved');
      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('checker-finance-1');
      expect(mockDbInsertEvent).toHaveBeenCalled();
    });

    it('enforces SoD: Locker cannot be the approver or creator', async () => {
      const approvedRun: PayrollRun = {
        ...baseRun,
        status: 'locking',
        createdBy: 'maker-hr-1',
        approvedBy: 'checker-finance-1',
      };
      mockDbSelectForUpdate.mockResolvedValue([approvedRun]);

      // Checker attempting to lock
      const checkerAttemptingLockCtx = {
        companyId: 'comp-1',
        userId: 'checker-finance-1',
        requestId: 'req-lock',
        isAuthenticated: true,
        roles: ['finance_head'],
        permissions: [PERMISSIONS.PAYROLL_RUN_LOCK],
      };

      await expect(
        executeRunTransition(checkerAttemptingLockCtx, mockDb, 'run-1', 'locked'),
      ).rejects.toThrow(ForbiddenError);

      // Maker attempting to lock
      const makerAttemptingLockCtx = {
        companyId: 'comp-1',
        userId: 'maker-hr-1',
        requestId: 'req-lock',
        isAuthenticated: true,
        roles: ['hr_manager'],
        permissions: [PERMISSIONS.PAYROLL_RUN_LOCK],
      };

      await expect(
        executeRunTransition(makerAttemptingLockCtx, mockDb, 'run-1', 'locked'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('enforces unlock policy: requires reason, permission, and second approver', async () => {
      const lockedRun: PayrollRun = {
        ...baseRun,
        status: 'locked',
        createdBy: 'user-1',
        approvedBy: 'user-2',
        lockedBy: 'user-3',
      };
      mockDbSelectForUpdate.mockResolvedValue([lockedRun]);

      const unlockerCtx = {
        companyId: 'comp-1',
        userId: 'admin-super',
        requestId: 'req-unlock',
        isAuthenticated: true,
        roles: ['super_admin'],
        permissions: [PERMISSIONS.PAYROLL_RUN_UNLOCK],
      };

      // Fails if reason is missing
      await expect(
        executeRunTransition(unlockerCtx, mockDb, 'run-1', 'review', {
          secondApproverId: 'finance-head-2',
        }),
      ).rejects.toThrow(ValidationError);

      // Fails if second approver is missing or same as unlocker
      await expect(
        executeRunTransition(unlockerCtx, mockDb, 'run-1', 'review', {
          reason: 'Correction of ad-hoc inputs',
          secondApproverId: 'admin-super',
        }),
      ).rejects.toThrow(ValidationError);

      // Succeeds when reason and distinct second approver are provided
      mockDbUpdate.mockResolvedValue([{ ...lockedRun, status: 'review' }]);
      const res = await executeRunTransition(unlockerCtx, mockDb, 'run-1', 'review', {
        reason: 'Correction of ad-hoc inputs',
        secondApproverId: 'finance-head-2',
      });
      expect(res.status).toBe('review');
    });
  });
});
