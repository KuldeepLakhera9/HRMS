import type pg from 'pg';
import { withTenant } from '@hrms/db';

export interface DashboardMetricsData {
  headcount: {
    total: number;
    active: number;
    probation: number;
    notice: number;
  };
  newJoinersThisMonth: number;
  pendingChangeRequests: number;
  expiringDocuments: number;
  recentAuditCount: number;
}

export class DashboardRepository {
  async getMetrics(
    companyId: string,
    poolOverride?: pg.Pool,
  ): Promise<DashboardMetricsData> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        // 1. Employee headcount & status breakdown
        const headcountRes = await client.query<{
          total: string;
          active: string;
          probation: string;
          notice: string;
        }>(
          `SELECT
             COUNT(*)::text as total,
             COUNT(*) FILTER (WHERE status = 'active')::text as active,
             COUNT(*) FILTER (WHERE status = 'probation')::text as probation,
             COUNT(*) FILTER (WHERE status = 'notice')::text as notice
           FROM employees
           WHERE company_id = $1 AND deleted_at IS NULL`,
          [companyId],
        );

        // 2. New joiners this month (utilizes idx_employees_company_doj)
        const now = new Date();
        const startOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const joinersRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM employees
           WHERE company_id = $1 AND doj >= $2 AND deleted_at IS NULL`,
          [companyId, startOfMonth],
        );

        // 3. Pending change requests
        const pendingChangeReqsRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM change_requests
           WHERE company_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
          [companyId],
        );

        // 4. Documents expiring in the next 30 days (column is 'expiry' date)
        const docExpiringRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM employee_documents
           WHERE company_id = $1
             AND expiry IS NOT NULL
             AND expiry <= (CURRENT_DATE + INTERVAL '30 days')
             AND expiry >= CURRENT_DATE
             AND deleted_at IS NULL`,
          [companyId],
        );

        // 5. Recent audit logs count (last 24 hours)
        const audit24hRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM audit_logs
           WHERE company_id = $1 AND created_at >= (NOW() - INTERVAL '24 hours')`,
          [companyId],
        );

        const headcount = headcountRes.rows[0] || { total: '0', active: '0', probation: '0', notice: '0' };

        return {
          headcount: {
            total: parseInt(headcount.total, 10),
            active: parseInt(headcount.active, 10),
            probation: parseInt(headcount.probation, 10),
            notice: parseInt(headcount.notice, 10),
          },
          newJoinersThisMonth: parseInt(joinersRes.rows[0]?.count || '0', 10),
          pendingChangeRequests: parseInt(pendingChangeReqsRes.rows[0]?.count || '0', 10),
          expiringDocuments: parseInt(docExpiringRes.rows[0]?.count || '0', 10),
          recentAuditCount: parseInt(audit24hRes.rows[0]?.count || '0', 10),
        };
      },
      poolOverride,
    );
  }
}
