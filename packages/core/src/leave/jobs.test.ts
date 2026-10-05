import { describe, it, expect, vi } from 'vitest';
import { LeaveBalanceRepository } from './balance-repository.js';
import { LeaveLedgerRepository } from './ledger-repository.js';
import { LeaveJobsService } from './jobs.js';
import type { RequestContext } from '../routing/context.js';
import { PERMISSIONS } from '@hrms/shared';

import type pg from 'pg';

describe('Leave Balances, Ledger & Jobs Invariant Tests', () => {
  it('enforces closing = opening + accrued + adjusted - used - expired - encashed', async () => {
    const repo = new LeaveBalanceRepository();

    const mockRow = {
      id: 'bal-1',
      company_id: 'cmp-1',
      employee_id: 'emp-1',
      leave_type_id: 'lt-1',
      period_key: '2026',
      opening: '10.000',
      accrued: '2.000',
      used: '3.000',
      adjusted: '1.000',
      expired: '0.000',
      encashed: '0.000',
      pending: '1.000',
      closing: '10.000',
    };

    let executedParams: unknown[] = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        executedParams = params;
        if (sql.includes('FROM leave_balances') && sql.includes('SELECT')) {
          return { rows: [mockRow] };
        }
        if (sql.includes('UPDATE leave_balances')) {
          return {
            rows: [
              {
                ...mockRow,
                accrued: params[3],
                closing: params[9],
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as pg.PoolClient;

    // Current: opening 10, accrued 2, used 3, adjusted 1, expired 0, encashed 0 => closing = 10
    // If we update accrued to 4.5:
    // New closing = 10 + 4.5 + 1 - 3 - 0 - 0 = 12.5
    const updated = await repo.updateBalance('cmp-1', 'bal-1', { accrued: 4.5 }, mockClient);

    expect(mockClient.query).toHaveBeenCalled();
    // In params: $10 is closing
    const closingParam = executedParams[9];
    expect(closingParam).toBe(12.5);
    expect(updated.closing).toBe(12.5);
  });

  it('ledger repository respects dedupeKey to prevent duplicate records', async () => {
    const repo = new LeaveLedgerRepository();

    const existingEntry = {
      id: 'led-1',
      company_id: 'cmp-1',
      employee_id: 'emp-1',
      leave_type_id: 'lt-1',
      period_key: '2026',
      entry_type: 'accrual',
      delta_days: '1.750',
      effective_date: '2026-02-01',
      dedupe_key: 'accrual:emp-1:lt-1:2026:2',
    };

    const mockClient = {
      query: vi.fn(async (sql: string, _params: unknown[]) => {
        if (sql.includes('SELECT *') && sql.includes('dedupe_key = $2')) {
          return { rows: [existingEntry] };
        }
        return { rows: [] };
      }),
    } as unknown as pg.PoolClient;

    const result = await repo.recordEntry(
      'cmp-1',
      {
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        periodKey: '2026',
        entryType: 'accrual',
        deltaDays: 1.75,
        effectiveDate: '2026-02-01',
        dedupeKey: 'accrual:emp-1:lt-1:2026:2',
        createdBy: 'user-system',
      },
      mockClient,
    );

    expect(result.id).toBe('led-1');
    // Ensure INSERT query was NOT called because dedupe matched
    const queryCalls = (mockClient.query as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const insertCalls = queryCalls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO leave_ledger'),
    );
    expect(insertCalls.length).toBe(0);
  });

  it('rejects manual adjustments without valid reason or zero delta', async () => {
    const service = new LeaveJobsService();
    const ctx: RequestContext = {
      isAuthenticated: true,
      companyId: 'cmp-1',
      userId: 'usr-admin',
      employeeId: 'emp-admin',
      roles: ['hr_admin'],
      permissions: [PERMISSIONS.LEAVE_BALANCE_ADJUST],
      requestId: 'req-1',
    };

    await expect(
      service.adjustBalance(ctx, {
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        periodKey: '2026',
        deltaDays: 0,
        reason: 'Correction',
      }),
    ).rejects.toThrow('Adjustment deltaDays must be non-zero.');

    await expect(
      service.adjustBalance(ctx, {
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        periodKey: '2026',
        deltaDays: 2,
        reason: '   ',
      }),
    ).rejects.toThrow('A mandatory reason is required');

    const unauthorizedCtx: RequestContext = {
      isAuthenticated: true,
      companyId: 'cmp-1',
      userId: 'usr-employee',
      employeeId: 'emp-2',
      roles: ['employee'],
      permissions: [],
      requestId: 'req-2',
    };

    await expect(
      service.adjustBalance(unauthorizedCtx, {
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        periodKey: '2026',
        deltaDays: 2,
        reason: 'Valid reason',
      }),
    ).rejects.toThrow('Permission denied');
  });
});
