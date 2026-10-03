import { z } from 'zod';
import { createNextRoute } from '@hrms/core';
import { withTenant } from '@hrms/db';

const emptyQuerySchema = z.object({});

export const GET = createNextRoute({
  requireAuth: true,
  schema: emptyQuerySchema,
  handler: async (_input, ctx) => {
    return withTenant(
      { companyId: ctx.companyId },
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
          [ctx.companyId],
        );

        // 2. New joiners this month
        const now = new Date();
        const startOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const joinersRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM employees
           WHERE company_id = $1 AND doj >= $2 AND deleted_at IS NULL`,
          [ctx.companyId, startOfMonth],
        );

        // 3. Pending change requests
        const pendingChangeReqsRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM employee_change_requests
           WHERE company_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
          [ctx.companyId],
        );

        // 4. Documents expiring in the next 30 days
        const docExpiringRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM employee_documents
           WHERE company_id = $1
             AND expiry_date IS NOT NULL
             AND expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
             AND expiry_date >= CURRENT_DATE
             AND deleted_at IS NULL`,
          [ctx.companyId],
        );

        // 5. Recent audit logs count (last 24 hours)
        const audit24hRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM audit_logs
           WHERE company_id = $1 AND created_at >= (NOW() - INTERVAL '24 hours')`,
          [ctx.companyId],
        );

        const headcount = headcountRes.rows[0] || { total: '0', active: '0', probation: '0', notice: '0' };

        return {
          data: {
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
          },
        };
      },
    );
  },
});
