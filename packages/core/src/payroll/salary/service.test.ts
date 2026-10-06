import { describe, it, expect, vi } from 'vitest';
import { SalaryService } from './service.js';
import { SalaryRepository } from './repository.js';
import { calculateCtcBreakup, StructureComponentDef } from './ctc-calculator.js';
import { Database, EmployeeSalary } from '@hrms/db';
import { PERMISSIONS } from '@hrms/shared';

describe('Salary Module (Service & CTC Calculator)', () => {
  describe('1. Pure calculateCtcBreakup', () => {
    const standardStructure: StructureComponentDef[] = [
      {
        code: 'BASIC',
        kind: 'earning',
        calc: 'formula',
        formula: 'MONTHLY_CTC * 0.50',
      },
      {
        code: 'HRA',
        kind: 'earning',
        calc: 'formula',
        formula: 'BASIC * 0.40',
      },
      {
        code: 'SPECIAL_ALLOWANCE',
        kind: 'earning',
        calc: 'fixed',
        isBalancing: true,
      },
    ];

    it('calculates correct component breakdown and balances special allowance', () => {
      // Annual CTC: 6,00,000 => Monthly CTC: 50,000
      // Basic: 50,000 * 0.50 = 25,000
      // HRA: 25,000 * 0.40 = 10,000
      // Special Allowance: 50,000 - 25,000 - 10,000 = 15,000
      const result = calculateCtcBreakup(600000, standardStructure);

      expect(result.ctcAnnual).toBe('600000.00');
      expect(result.monthlyCtc).toBe('50000.00');
      expect(result.grossMonthlyEarnings).toBe('50000.00');

      const basicLine = result.lines.find(l => l.code === 'BASIC');
      const hraLine = result.lines.find(l => l.code === 'HRA');
      const specialLine = result.lines.find(l => l.code === 'SPECIAL_ALLOWANCE');

      expect(basicLine?.monthlyAmount).toBe('25000.00');
      expect(hraLine?.monthlyAmount).toBe('10000.00');
      expect(specialLine?.monthlyAmount).toBe('15000.00');
      expect(specialLine?.isBalancing).toBe(true);
      expect(result.labourCodeFloorWarning).toBe(false);
    });

    it('throws validation error if balancing allowance becomes negative', () => {
      const topHeavyStructure: StructureComponentDef[] = [
        {
          code: 'BASIC',
          kind: 'earning',
          calc: 'formula',
          formula: 'MONTHLY_CTC * 0.80',
        },
        {
          code: 'HRA',
          kind: 'earning',
          calc: 'formula',
          formula: 'MONTHLY_CTC * 0.40', // 80% + 40% = 120% > 100%
        },
        {
          code: 'SPECIAL',
          kind: 'earning',
          calc: 'fixed',
          isBalancing: true,
        },
      ];

      expect(() => calculateCtcBreakup(600000, topHeavyStructure)).toThrow(
        /Salary structure balancing error: Computed balancing component 'SPECIAL' is negative/,
      );
    });
  });

  describe('2. SalaryService Maker-Checker & Segregation of Duties', () => {
    const mockRepo = {
      createComponent: vi.fn(),
      getComponentById: vi.fn(),
      getComponentByCode: vi.fn(),
      listComponents: vi.fn(),
      updateComponent: vi.fn(),
      createStructure: vi.fn(),
      getStructureById: vi.fn(),
      listStructures: vi.fn(),
      updateStructure: vi.fn(),
      createSalaryAssignment: vi.fn(),
      getSalaryAssignmentById: vi.fn(),
      getActiveSalaryAssignment: vi.fn(),
      listSalariesForEmployee: vi.fn(),
      updateSalaryAssignment: vi.fn(),
    } as unknown as SalaryRepository;

    const mockDb = {} as unknown as Database;
    const service = new SalaryService(mockRepo);

    const makerCtx = {
      companyId: 'comp-1',
      userId: 'maker-hr-1',
      roles: ['hr_manager'],
      permissions: [PERMISSIONS.PAYROLL_SALARY_ASSIGN, PERMISSIONS.PAYROLL_STRUCTURE_MANAGE],
      requestId: 'req-maker-1',
      isAuthenticated: true,
    };

    const checkerCtx = {
      companyId: 'comp-1',
      userId: 'checker-fin-2',
      roles: ['finance_head'],
      permissions: [PERMISSIONS.PAYROLL_SALARY_APPROVE, PERMISSIONS.PAYROLL_STRUCTURE_MANAGE],
      requestId: 'req-checker-2',
      isAuthenticated: true,
    };

    it('creates draft salary assignment with makerId = ctx.userId', async () => {
      vi.mocked(mockRepo.getStructureById).mockResolvedValue({
        id: 'struct-1',
        companyId: 'comp-1',
        name: 'Standard',
        version: 1,
        components: [],
        validations: {},
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'admin',
        updatedBy: 'admin',
        deletedAt: null,
        rowVersion: 1,
      });

      vi.mocked(mockRepo.createSalaryAssignment).mockImplementation(async (_db, data) => ({
        ...data,
        id: 'assign-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        rowVersion: 1,
        checkerId: null,
        effectiveTo: null,
        overrides: {},
      } as unknown as EmployeeSalary));

      const result = await service.assignSalary(makerCtx, mockDb, {
        employeeId: 'emp-101',
        structureId: 'struct-1',
        structureVersion: 1,
        ctcAnnual: '600000.00',
        effectiveFrom: '2026-10-01',
        reason: 'join',
      });

      expect(result.status).toBe('draft');
      expect(result.makerId).toBe(makerCtx.userId);
    });

    it('rejects salary assignment approval if checker is the maker', async () => {
      vi.mocked(mockRepo.getSalaryAssignmentById).mockResolvedValue({
        id: 'assign-1',
        companyId: 'comp-1',
        employeeId: 'emp-101',
        structureId: 'struct-1',
        structureVersion: 1,
        ctcAnnual: '600000.00',
        overrides: {},
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
        reason: 'join',
        status: 'draft',
        makerId: 'maker-hr-1', // Same user!
        checkerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'maker-hr-1',
        updatedBy: 'maker-hr-1',
        deletedAt: null,
        rowVersion: 1,
      });

      const dualCtx = {
        ...makerCtx,
        permissions: [PERMISSIONS.PAYROLL_SALARY_APPROVE],
      };

      await expect(
        service.approveSalaryAssignment(dualCtx, mockDb, 'assign-1'),
      ).rejects.toThrow(/Segregation of duties violation/);
    });

    it('approves salary assignment when different checker approves', async () => {
      vi.mocked(mockRepo.getSalaryAssignmentById).mockResolvedValue({
        id: 'assign-1',
        companyId: 'comp-1',
        employeeId: 'emp-101',
        structureId: 'struct-1',
        structureVersion: 1,
        ctcAnnual: '600000.00',
        overrides: {},
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
        reason: 'join',
        status: 'draft',
        makerId: 'maker-hr-1',
        checkerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'maker-hr-1',
        updatedBy: 'maker-hr-1',
        deletedAt: null,
        rowVersion: 1,
      });

      vi.mocked(mockRepo.updateSalaryAssignment).mockImplementation(async (_db, _cid, _id, update) => ({
        id: 'assign-1',
        companyId: 'comp-1',
        employeeId: 'emp-101',
        structureId: 'struct-1',
        structureVersion: 1,
        ctcAnnual: '600000.00',
        overrides: {},
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
        reason: 'join',
        status: update.status ?? 'approved',
        makerId: 'maker-hr-1',
        checkerId: update.checkerId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'maker-hr-1',
        updatedBy: update.updatedBy ?? 'maker-hr-1',
        deletedAt: null,
        rowVersion: 1,
      }));

      const result = await service.approveSalaryAssignment(checkerCtx, mockDb, 'assign-1');
      expect(result.status).toBe('approved');
      expect(result.checkerId).toBe(checkerCtx.userId);
    });
  });
});
