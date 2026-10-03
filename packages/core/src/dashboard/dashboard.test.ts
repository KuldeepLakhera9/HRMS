import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '@hrms/shared';
import { DashboardService } from './service.js';
import type { DashboardRepository, DashboardMetricsData } from './repository.js';
import type { RequestContext } from '../routing/context.js';

describe('DashboardService Unit Tests', () => {
  let service: DashboardService;
  let mockRepo: Partial<DashboardRepository>;

  const baseCtx: RequestContext = {
    companyId: 'comp-123',
    userId: 'user-123',
    roles: ['admin'],
    permissions: ['*'],
    requestId: 'req-1',
    isAuthenticated: true,
  };

  const dummyMetrics: DashboardMetricsData = {
    headcount: { total: 100, active: 90, probation: 8, notice: 2 },
    newJoinersThisMonth: 5,
    pendingChangeRequests: 2,
    expiringDocuments: 3,
    recentAuditCount: 14,
  };

  beforeEach(() => {
    mockRepo = {
      getMetrics: vi.fn().mockResolvedValue(dummyMetrics),
    };
    service = new DashboardService(mockRepo as DashboardRepository);
  });

  it('retrieves dashboard metrics for authenticated user', async () => {
    const result = await service.getMetrics(baseCtx);

    expect(result).toEqual(dummyMetrics);
    expect(mockRepo.getMetrics).toHaveBeenCalledWith('comp-123', undefined);
  });

  it('rejects unauthenticated caller with UnauthorizedError', async () => {
    const unauthCtx: RequestContext = {
      ...baseCtx,
      isAuthenticated: false,
    };

    await expect(service.getMetrics(unauthCtx)).rejects.toThrow(UnauthorizedError);
  });
});
