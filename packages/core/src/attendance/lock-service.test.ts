import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendanceLockService } from './lock-service.js';
import type { RequestContext } from '../routing/context.js';
import type { AuditService } from '../audit/service.js';
import { ValidationError, ForbiddenError, UnauthorizedError } from '@hrms/shared';

describe('P2-DAY-02: AttendanceLockService Tests', () => {
  let mockAuditService: {
    recordEvent: ReturnType<typeof vi.fn>;
  };
  let service: AttendanceLockService;

  const adminCtx: RequestContext = {
    companyId: '11111111-1111-7111-8111-111111111111',
    userId: '22222222-2222-7222-8222-222222222222',
    roles: ['hr_admin'],
    permissions: ['attendance.lock.manage'],
    isAuthenticated: true,
    requestId: 'req-lock-test-1',
  };

  const unprivilegedCtx: RequestContext = {
    companyId: '11111111-1111-7111-8111-111111111111',
    userId: '33333333-3333-7333-8333-333333333333',
    roles: ['employee'],
    permissions: [],
    isAuthenticated: true,
    requestId: 'req-lock-test-2',
  };

  beforeEach(() => {
    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    };
    service = new AttendanceLockService(mockAuditService as unknown as AuditService);
  });

  it('rejects lock if not authenticated', async () => {
    const anonCtx = { ...unprivilegedCtx, isAuthenticated: false };
    await expect(
      service.lockPeriod(anonCtx, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        reason: 'Monthly payroll closure',
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects lock without attendance.lock.manage permission', async () => {
    await expect(
      service.lockPeriod(unprivilegedCtx, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        reason: 'Monthly payroll closure',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects lock without reason', async () => {
    await expect(
      service.lockPeriod(adminCtx, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        reason: '',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects unlock without reason', async () => {
    await expect(
      service.unlockPeriod(adminCtx, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        reason: '   ',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('assertPeriodUnlocked throws ValidationError when date is locked', async () => {
    vi.spyOn(service, 'isDateLocked').mockResolvedValue(true);

    await expect(
      service.assertPeriodUnlocked('11111111-1111-7111-8111-111111111111', '2026-03-15'),
    ).rejects.toThrow(ValidationError);
  });

  it('assertPeriodUnlocked succeeds when date is not locked', async () => {
    vi.spyOn(service, 'isDateLocked').mockResolvedValue(false);

    await expect(
      service.assertPeriodUnlocked('11111111-1111-7111-8111-111111111111', '2026-03-15'),
    ).resolves.toBeUndefined();
  });
});
