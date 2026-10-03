import type pg from 'pg';
import { UnauthorizedError } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { DashboardRepository, type DashboardMetricsData } from './repository.js';

export class DashboardService {
  private repository: DashboardRepository;

  constructor(repository?: DashboardRepository) {
    this.repository = repository ?? new DashboardRepository();
  }

  async getMetrics(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<DashboardMetricsData> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to view dashboard metrics.');
    }

    return this.repository.getMetrics(ctx.companyId, poolOverride);
  }
}
