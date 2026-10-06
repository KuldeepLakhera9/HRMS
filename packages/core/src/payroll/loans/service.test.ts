import { describe, it, expect, vi } from 'vitest';
import { LoanService } from './service.js';
import { Database } from '@hrms/db';
import { PERMISSIONS, ValidationError } from '@hrms/shared';

describe('Employee Loans & EMI Scheduling Service (P4-RUN-01)', () => {
  const service = new LoanService();

  const ctx = {
    companyId: 'comp-1',
    userId: 'hr-user-1',
    requestId: 'req-1',
    isAuthenticated: true,
    roles: ['hr_manager'],
    permissions: [PERMISSIONS.PAYROLL_LOAN_MANAGE, PERMISSIONS.PAYROLL_INPUT_CREATE],
  };

  it('generates an exact loan repayment schedule across N periods with penny correction', async () => {
    // Principal: 10,000, 3 installments, 0% interest
    // 10,000 / 3 = 3333.33 each, remaining 3333.34 on final installment
    const mockDbInsert = vi.fn().mockImplementation((_table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => ({
        returning: vi.fn().mockImplementation(async () => {
          if (Array.isArray(vals)) {
            return vals.map((v: Record<string, unknown>, idx: number) => ({ ...v, id: `inst-${idx + 1}` }));
          }
          return [{ ...(vals as Record<string, unknown>), id: 'loan-1' }];
        }),
      })),
    }));

    const mockDb = {
      insert: mockDbInsert,
    } as unknown as Database;

    const res = await service.createLoan(ctx, mockDb, {
      employeeId: 'emp-101',
      principal: '10000.00',
      installmentsCount: 3,
      startPeriod: '2026-10',
    });

    expect(res.loan.principal).toBe('10000.00');
    expect(res.installments).toHaveLength(3);
    expect(res.installments[0]!.duePeriod).toBe('2026-10');
    expect(res.installments[1]!.duePeriod).toBe('2026-11');
    expect(res.installments[2]!.duePeriod).toBe('2026-12');

    expect(res.installments[0]!.totalAmount).toBe('3333.33');
    expect(res.installments[1]!.totalAmount).toBe('3333.33');
    expect(res.installments[2]!.totalAmount).toBe('3333.34'); // 10000 - 6666.66 = 3333.34
  });

  it('rejects invalid principal or installments count', async () => {
    const mockDb = {} as unknown as Database;
    await expect(
      service.createLoan(ctx, mockDb, {
        employeeId: 'emp-101',
        principal: '0.00',
        installmentsCount: 3,
        startPeriod: '2026-10',
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      service.createLoan(ctx, mockDb, {
        employeeId: 'emp-101',
        principal: '5000.00',
        installmentsCount: 0,
        startPeriod: '2026-10',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('generates payroll inputs for due installments idempotently', async () => {
    const mockDbSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              installmentId: 'inst-1',
              loanId: 'loan-1',
              employeeId: 'emp-101',
              totalAmount: '3333.33',
              installmentNumber: 1,
            },
          ]),
        }),
      }),
    });

    const mockDbInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'input-new' }]),
        }),
      }),
    });

    const mockDb = {
      select: mockDbSelect,
      insert: mockDbInsert,
    } as unknown as Database;

    const res = await service.generateEmiInputsForPeriod(ctx, mockDb, '2026-10');
    expect(res.inputsGenerated).toBe(1);
    expect(mockDbInsert).toHaveBeenCalled();
  });
});
