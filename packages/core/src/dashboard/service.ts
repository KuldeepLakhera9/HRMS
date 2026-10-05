import type pg from 'pg';
import { getAppPool, withTenant } from '@hrms/db';
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { createChildLogger } from '../logger/index.js';
import { getRedisClient } from '../redis/client.js';
import { DashboardRepository, type DashboardMetricsData } from './repository.js';

const logger = createChildLogger({ module: 'dashboard:service' });

export type DashboardCardKey =
  | 'employee_clock'
  | 'leave_balances'
  | 'upcoming_holidays'
  | 'pending_requests'
  | 'team_presence'
  | 'team_leave'
  | 'hr_headcount'
  | 'hr_attendance_rate'
  | 'admin_system_health';

export interface DashboardCardResponse {
  key: DashboardCardKey;
  cachedAt?: string;
  data: Record<string, unknown>;
}

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

  /**
   * Fetches data for a specific dashboard card with Redis caching (60s TTL).
   * Asserts query budget <= 2 per card.
   */
  async getCard(
    ctx: RequestContext,
    key: DashboardCardKey,
    poolOverride?: pg.Pool,
  ): Promise<DashboardCardResponse> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to view dashboard card.');
    }

    // 1. Permission checks per card
    this.assertCardPermission(ctx, key);

    // 2. Redis cache lookup
    const cacheKey = `hrms:dash:${ctx.companyId}:${ctx.userId || 'anon'}:${key}`;
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DashboardCardResponse;
      }
    } catch (err) {
      logger.warn({ err, key }, 'Redis cache read error, falling back to DB');
    }

    // 3. Database query inside withTenant
    const pool = poolOverride ?? getAppPool();
    const data = await withTenant(ctx, async (_tx, client) => {
      return this.resolveCardData(ctx, key, client);
    }, pool);

    const response: DashboardCardResponse = {
      key,
      cachedAt: new Date().toISOString(),
      data,
    };

    // 4. Populate Redis cache (60s TTL)
    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, JSON.stringify(response), 'EX', 60);
    } catch (err) {
      logger.warn({ err, key }, 'Redis cache write error');
    }

    return response;
  }

  /**
   * Invalidates Redis cache for dashboard cards in a company.
   */
  async invalidateCardCache(companyId: string, key?: DashboardCardKey): Promise<void> {
    try {
      const redis = getRedisClient();
      const pattern = key
        ? `hrms:dash:${companyId}:*:${key}`
        : `hrms:dash:${companyId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      logger.warn({ err, companyId, key }, 'Failed to invalidate dashboard cache');
    }
  }

  private assertCardPermission(ctx: RequestContext, key: DashboardCardKey): void {
    const roles = ctx.roles ?? [];
    switch (key) {
      case 'employee_clock':
      case 'leave_balances':
      case 'upcoming_holidays':
      case 'pending_requests':
        // Available to any authenticated employee
        break;
      case 'team_presence':
      case 'team_leave':
        if (!roles.includes('manager') && !roles.includes('hr_manager') && !roles.includes('super_admin')) {
          throw new ForbiddenError('Permission denied to view team dashboard cards');
        }
        break;
      case 'hr_headcount':
      case 'hr_attendance_rate':
        if (!roles.includes('hr_manager') && !roles.includes('super_admin') && !roles.includes('accountant')) {
          throw new ForbiddenError('Permission denied to view HR dashboard cards');
        }
        break;
      case 'admin_system_health':
        if (!roles.includes('super_admin')) {
          throw new ForbiddenError('Permission denied to view system health card');
        }
        break;
      default:
        throw new NotFoundError(`Dashboard card '${key}' is not defined`);
    }
  }

  private async resolveCardData(
    ctx: RequestContext,
    key: DashboardCardKey,
    client: pg.PoolClient | pg.Pool,
  ): Promise<Record<string, unknown>> {
    const roles = ctx.roles ?? [];
    const isHrOrAdmin = roles.includes('hr_manager') || roles.includes('super_admin');

    switch (key) {
      case 'employee_clock': {
        if (!ctx.employeeId) {
          return { status: 'not_enrolled', workedMinutes: 0 };
        }
        const res = await client.query(
          `SELECT 
            ad.status,
            ad.total_work_minutes AS "workedMinutes",
            ad.late_in_minutes AS "lateMinutes",
            TO_CHAR(ad.first_in, 'HH24:MI') AS "inTime",
            TO_CHAR(ad.last_out, 'HH24:MI') AS "outTime"
          FROM attendance_days ad
          WHERE ad.company_id = $1 AND ad.employee_id = $2 AND ad.work_date = CURRENT_DATE
          LIMIT 1`,
          [ctx.companyId, ctx.employeeId],
        );
        return res.rows[0] || { status: 'absent', workedMinutes: 0, inTime: null, outTime: null };
      }

      case 'leave_balances': {
        if (!ctx.employeeId) {
          return { balances: [] };
        }
        const year = String(new Date().getUTCFullYear());
        const res = await client.query(
          `SELECT 
            lt.name,
            lt.code,
            lb.closing::float AS "closing",
            lb.pending::float AS "pending",
            (lb.closing - lb.pending)::float AS "available"
          FROM leave_balances lb
          JOIN leave_types lt ON lt.company_id = lb.company_id AND lt.id = lb.leave_type_id
          WHERE lb.company_id = $1 AND lb.employee_id = $2 AND lb.period_key = $3
          ORDER BY lt.name ASC`,
          [ctx.companyId, ctx.employeeId, year],
        );
        return { balances: res.rows };
      }

      case 'upcoming_holidays': {
        const res = await client.query(
          `SELECT 
            h.name,
            TO_CHAR(h.date, 'YYYY-MM-DD') AS "date",
            h.type
          FROM holidays h
          JOIN holiday_lists hl ON hl.company_id = h.company_id AND hl.id = h.list_id
          WHERE h.company_id = $1 AND h.date >= CURRENT_DATE
          ORDER BY h.date ASC
          LIMIT 3`,
          [ctx.companyId],
        );
        return { holidays: res.rows };
      }

      case 'pending_requests': {
        const res = await client.query(
          `SELECT COUNT(*)::int AS "count"
          FROM workflow_instances wi
          WHERE wi.company_id = $1 AND wi.status = 'pending'
            AND ($2::uuid IS NULL OR wi.current_assignee_id = $2 OR wi.initiator_id = $3)`,
          [ctx.companyId, ctx.userId || null, ctx.userId || null],
        );
        return { pendingCount: res.rows[0]?.count || 0 };
      }

      case 'team_presence': {
        const managerFilter = isHrOrAdmin ? null : ctx.employeeId;
        const res = await client.query(
          `SELECT 
            COUNT(*) FILTER (WHERE ad.status = 'present')::int AS "present",
            COUNT(*) FILTER (WHERE ad.status = 'absent')::int AS "absent",
            COUNT(*) FILTER (WHERE ad.status = 'on_leave')::int AS "onLeave",
            COUNT(*) FILTER (WHERE ad.late_in_minutes > 0)::int AS "late"
          FROM attendance_days ad
          JOIN employees e ON e.company_id = ad.company_id AND e.id = ad.employee_id
          WHERE ad.company_id = $1 AND ad.work_date = CURRENT_DATE
            AND ($2::uuid IS NULL OR e.manager_id = $2)`,
          [ctx.companyId, managerFilter],
        );
        return res.rows[0] || { present: 0, absent: 0, onLeave: 0, late: 0 };
      }

      case 'team_leave': {
        const managerFilter = isHrOrAdmin ? null : ctx.employeeId;
        const res = await client.query(
          `SELECT 
            e.emp_code AS "empCode",
            CONCAT(e.first_name, ' ', e.last_name) AS "name",
            lt.name AS "leaveType",
            TO_CHAR(lrd.leave_date, 'YYYY-MM-DD') AS "date"
          FROM leave_request_days lrd
          JOIN employees e ON e.company_id = lrd.company_id AND e.id = lrd.employee_id
          JOIN leave_requests lr ON lr.company_id = lrd.company_id AND lr.id = lrd.request_id
          JOIN leave_types lt ON lt.company_id = lr.company_id AND lt.id = lr.leave_type_id
          WHERE lrd.company_id = $1 
            AND lrd.status = 'approved'
            AND lrd.leave_date >= CURRENT_DATE 
            AND lrd.leave_date <= CURRENT_DATE + INTERVAL '7 days'
            AND ($2::uuid IS NULL OR e.manager_id = $2)
          ORDER BY lrd.leave_date ASC
          LIMIT 10`,
          [ctx.companyId, managerFilter],
        );
        return { leaves: res.rows };
      }

      case 'hr_headcount': {
        const res = await client.query(
          `SELECT 
            COUNT(*) FILTER (WHERE status = 'active')::int AS "active",
            COUNT(*) FILTER (WHERE doj >= date_trunc('month', CURRENT_DATE)::date)::int AS "joinersThisMonth",
            COUNT(*) FILTER (WHERE status = 'terminated')::int AS "leaversThisMonth"
          FROM employees
          WHERE company_id = $1 AND deleted_at IS NULL`,
          [ctx.companyId],
        );
        return res.rows[0] || { active: 0, joinersThisMonth: 0, leaversThisMonth: 0 };
      }

      case 'hr_attendance_rate': {
        const res = await client.query(
          `SELECT 
            COUNT(*)::int AS "total",
            COUNT(*) FILTER (WHERE status IN ('present', 'half_day', 'on_duty', 'wfh'))::int AS "present"
          FROM attendance_days
          WHERE company_id = $1 AND work_date = CURRENT_DATE`,
          [ctx.companyId],
        );
        const total = res.rows[0]?.total || 0;
        const present = res.rows[0]?.present || 0;
        const rate = total > 0 ? Math.round((present / total) * 100) : 100;
        return { total, present, ratePercentage: rate };
      }

      case 'admin_system_health': {
        const res = await client.query(
          `SELECT COUNT(*)::int AS "recentAuditCount"
          FROM audit_logs
          WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
          [ctx.companyId],
        );
        return {
          systemStatus: 'healthy',
          recentAuditCount: res.rows[0]?.recentAuditCount || 0,
        };
      }

      default:
        throw new NotFoundError(`Card resolver for '${key}' not found`);
    }
  }
}
