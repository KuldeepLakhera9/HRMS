import { describe, it, expect, vi } from 'vitest';
import { calculateArrears, getPastPeriodsBetween } from './arrears.js';
import { SalaryRevisionService } from './revision-service.js';
import { SalaryRepository } from './repository.js';
import { Database } from '@hrms/db';
import { PERMISSIONS, ForbiddenError } from '@hrms/shared';

describe('Salary Revision & Arrears Engine (P4-SAL-03)', () => {
  describe('1. Pure calculateArrears', () => {
    it('generates correct past period list', () => {
      expect(getPastPeriodsBetween('2026-07', '2026-10')).toEqual([
        '2026-07',
        '2026-08',
        '2026-09',
      ]);
      expect(getPastPeriodsBetween('2026-11', '2027-02')).toEqual([
        '2026-11',
        '2026-12',
        '2027-01',
      ]);
      expect(getPastPeriodsBetween('2026-10', '2026-10')).toEqual([]);
      expect(getPastPeriodsBetween('2026-11', '2026-10')).toEqual([]);
    });

    it('calculates exact arrears for 3 backdated months with half-up rounding', () => {
      // Old CTC: 6,00,000 => 50,000/mo
      // New CTC: 7,20,000 => 60,000/mo
      // Diff: 10,000/mo * 3 months = 30,000
      const result = calculateArrears({
        currentCtcAnnual: '600000.00',
        newCtcAnnual: '720000.00',
        effectiveFromPeriod: '2026-07',
        currentPeriod: '2026-10',
      });

      expect(result.monthsCount).toBe(3);
      expect(result.monthlyDifference).toBe('10000.00');
      expect(result.totalArrears).toBe('30000.00');
      expect(result.periods).toHaveLength(3);
      expect(result.periods[0]).toEqual({
        period: '2026-07',
        monthlyOldCtc: '50000.00',
        monthlyNewCtc: '60000.00',
        difference: '10000.00',
      });
    });

    it('produces zero arrears when revision is for current or future period', () => {
      const result = calculateArrears({
        currentCtcAnnual: '600000.00',
        newCtcAnnual: '720000.00',
        effectiveFromPeriod: '2026-10',
        currentPeriod: '2026-10',
      });

      expect(result.monthsCount).toBe(0);
      expect(result.totalArrears).toBe('0.00');
    });
  });

  describe('2. SalaryRevisionService Preview & Maker-Checker Approval', () => {
    const mockRepo = {
      getActiveSalaryAssignment: vi.fn(),
      updateSalaryAssignment: vi.fn(),
      createSalaryAssignment: vi.fn(),
      createRevisionBatch: vi.fn(),
      lockRevisionBatchById: vi.fn(),
      updateRevisionBatch: vi.fn(),
    } as unknown as SalaryRepository;

    const mockDbInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'input-new' }]),
        }),
      }),
    });

    const mockDb = {
      insert: mockDbInsert,
    } as unknown as Database;

    const service = new SalaryRevisionService(mockRepo);

    const makerCtx = {
      companyId: 'comp-1',
      userId: 'maker-hr-1',
      requestId: 'req-maker',
      isAuthenticated: true,
      roles: ['hr_manager'],
      permissions: [PERMISSIONS.PAYROLL_SALARY_ASSIGN, PERMISSIONS.PAYROLL_SALARY_VIEW],
    };

    const checkerCtx = {
      companyId: 'comp-1',
      userId: 'checker-finance-1',
      requestId: 'req-checker',
      isAuthenticated: true,
      roles: ['finance_head'],
      permissions: [PERMISSIONS.PAYROLL_SALARY_APPROVE],
    };

    it('previews cost impact across multiple employees with backdated arrears', async () => {
      vi.mocked(mockRepo.getActiveSalaryAssignment).mockImplementation(async (_db, _cid, empId) => {
        if (empId === 'emp-1') {
          return {
            id: 'asgn-1',
            companyId: 'comp-1',
            employeeId: 'emp-1',
            structureId: 'struct-1',
            structureVersion: 1,
            ctcAnnual: '600000.00',
            overrides: {},
            effectiveFrom: '2026-04-01',
            effectiveTo: null,
            reason: 'join',
            status: 'approved',
            makerId: 'maker-hr-1',
            checkerId: 'checker-finance-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'maker-hr-1',
            updatedBy: 'checker-finance-1',
            deletedAt: null,
            rowVersion: 1,
          };
        }
        return null;
      });

      const preview = await service.previewBulkRevision(makerCtx, mockDb, {
        effectiveFrom: '2026-07-01',
        currentPeriod: '2026-10',
        items: [
          { employeeId: 'emp-1', newCtcAnnual: '720000.00' },
          { employeeId: 'emp-2', newCtcAnnual: '840000.00' },
        ],
      });

      expect(preview.totalEmployees).toBe(2);
      expect(preview.totalCurrentCtcAnnual).toBe('600000.00');
      expect(preview.totalNewCtcAnnual).toBe('1560000.00');
      expect(preview.totalAnnualCostImpact).toBe('960000.00');
      // emp-1 has 30,000 arrears (10,000 * 3 mos), emp-2 has 210,000 arrears (70,000 * 3 mos)
      expect(preview.totalEstimatedArrears).toBe('240000.00');
    });

    it('enforces Segregation of Duties when approving revision batch', async () => {
      vi.mocked(mockRepo.lockRevisionBatchById).mockResolvedValue({
        id: 'batch-db-1',
        companyId: 'comp-1',
        batchId: 'BATCH-2026-Q3',
        effectiveFrom: '2026-07-01',
        rows: [{ employeeId: 'emp-1', newCtcAnnual: '720000.00' }],
        status: 'draft',
        arrearsPolicy: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'maker-hr-1', // created by maker-hr-1
        updatedBy: 'maker-hr-1',
        deletedAt: null,
        rowVersion: 1,
      });

      // Maker cannot approve own batch
      await expect(
        service.approveRevisionBatch(makerCtx, mockDb, 'batch-db-1', '2026-10'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('approves revision batch, updates assignments, and creates idempotent arrears inputs', async () => {
      vi.mocked(mockRepo.lockRevisionBatchById).mockResolvedValue({
        id: 'batch-db-1',
        companyId: 'comp-1',
        batchId: 'BATCH-2026-Q3',
        effectiveFrom: '2026-07-01',
        rows: [{ employeeId: 'emp-1', newCtcAnnual: '720000.00', structureId: 'struct-1' }],
        status: 'draft',
        arrearsPolicy: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'maker-hr-1',
        updatedBy: 'maker-hr-1',
        deletedAt: null,
        rowVersion: 1,
      });

      vi.mocked(mockRepo.getActiveSalaryAssignment).mockResolvedValue({
        id: 'asgn-1',
        companyId: 'comp-1',
        employeeId: 'emp-1',
        structureId: 'struct-1',
        structureVersion: 1,
        ctcAnnual: '600000.00',
        overrides: {},
        effectiveFrom: '2026-04-01',
        effectiveTo: null,
        reason: 'join',
        status: 'approved',
        makerId: 'maker-hr-1',
        checkerId: 'checker-finance-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'maker-hr-1',
        updatedBy: 'checker-finance-1',
        deletedAt: null,
        rowVersion: 1,
      });

      vi.mocked(mockRepo.updateRevisionBatch).mockImplementation(async (_db, _cid, _id, update) => ({
        id: 'batch-db-1',
        companyId: 'comp-1',
        batchId: 'BATCH-2026-Q3',
        effectiveFrom: '2026-07-01',
        rows: [{ employeeId: 'emp-1', newCtcAnnual: '720000.00', structureId: 'struct-1' }],
        status: update.status ?? 'applied',
        arrearsPolicy: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'maker-hr-1',
        updatedBy: update.updatedBy ?? 'checker-finance-1',
        deletedAt: null,
        rowVersion: 1,
      }));

      const res = await service.approveRevisionBatch(checkerCtx, mockDb, 'batch-db-1', '2026-10');

      expect(res.batch.status).toBe('applied');
      expect(res.arrearsGenerated).toBe(3); // 2026-07, 2026-08, 2026-09
      expect(mockRepo.updateSalaryAssignment).toHaveBeenCalledWith(
        mockDb,
        'comp-1',
        'asgn-1',
        expect.objectContaining({ effectiveTo: '2026-06-30' }),
      );
      expect(mockRepo.createSalaryAssignment).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          employeeId: 'emp-1',
          ctcAnnual: '720000.00',
          effectiveFrom: '2026-07-01',
          status: 'approved',
        }),
      );
    });
  });
});
