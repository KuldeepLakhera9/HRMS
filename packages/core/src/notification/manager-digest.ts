import type pg from 'pg';
import { getAppPool, withTenant } from '@hrms/db';
import { createChildLogger } from '../logger/index.js';
import { NotificationService } from './service.js';

const logger = createChildLogger({ module: 'notification:manager-digest' });

export interface ManagerDigestItem {
  managerId: string;
  managerUserId: string;
  managerEmail: string;
  managerName: string;
  pendingLeaves: number;
  pendingRegularizations: number;
  pendingChangeRequests: number;
  totalPending: number;
}

export class ManagerDigestJob {
  private notificationService: NotificationService;

  constructor(notificationService?: NotificationService) {
    this.notificationService = notificationService ?? new NotificationService();
  }

  /**
   * Compiles and dispatches the daily approvals digest for managers who have pending items.
   * Runs daily at 08:30 company time.
   */
  async runDigest(
    companyId: string,
    pool?: pg.Pool
  ): Promise<{ sentCount: number; items: ManagerDigestItem[] }> {
    const targetPool = pool ?? getAppPool();

    const digestItems = await withTenant({ companyId }, async (_tx, client) => {
      // 1. Pending leave requests grouped by manager
      const leaveRes = await client.query<{
        manager_id: string;
        pending_leaves: string;
      }>(
        `SELECT 
          e.manager_id,
          COUNT(lr.id)::text AS pending_leaves
        FROM leave_requests lr
        JOIN employees e ON e.company_id = lr.company_id AND e.id = lr.employee_id
        WHERE lr.company_id = $1 AND lr.status = 'pending' AND e.manager_id IS NOT NULL
        GROUP BY e.manager_id`,
        [companyId]
      );

      // 2. Pending attendance regularizations grouped by manager
      const regRes = await client.query<{
        manager_id: string;
        pending_regs: string;
      }>(
        `SELECT 
          e.manager_id,
          COUNT(ar.id)::text AS pending_regs
        FROM attendance_regularizations ar
        JOIN employees e ON e.company_id = ar.company_id AND e.id = ar.employee_id
        WHERE ar.company_id = $1 AND ar.status = 'pending' AND e.manager_id IS NOT NULL
        GROUP BY e.manager_id`,
        [companyId]
      );

      // 3. Manager details lookup
      const managerIds = Array.from(
        new Set([
          ...leaveRes.rows.map(r => r.manager_id),
          ...regRes.rows.map(r => r.manager_id),
        ])
      );

      if (managerIds.length === 0) {
        return [];
      }

      const mgrDetailsRes = await client.query<{
        id: string;
        user_id: string;
        first_name: string;
        last_name: string;
        email: string;
      }>(
        `SELECT 
          e.id,
          e.user_id,
          e.first_name,
          e.last_name,
          u.email
        FROM employees e
        JOIN users u ON u.company_id = e.company_id AND u.id = e.user_id
        WHERE e.company_id = $1 AND e.id = ANY($2::uuid[])`,
        [companyId, managerIds]
      );

      const items: ManagerDigestItem[] = [];

      for (const mgr of mgrDetailsRes.rows) {
        const leaves = parseInt(
          leaveRes.rows.find(r => r.manager_id === mgr.id)?.pending_leaves || '0',
          10
        );
        const regs = parseInt(
          regRes.rows.find(r => r.manager_id === mgr.id)?.pending_regs || '0',
          10
        );
        const total = leaves + regs;

        if (total > 0) {
          items.push({
            managerId: mgr.id,
            managerUserId: mgr.user_id,
            managerEmail: mgr.email,
            managerName: `${mgr.first_name} ${mgr.last_name}`,
            pendingLeaves: leaves,
            pendingRegularizations: regs,
            pendingChangeRequests: 0,
            totalPending: total,
          });
        }
      }

      return items;
    }, targetPool);

    // Dispatch notification to each manager
    let sentCount = 0;
    for (const item of digestItems) {
      const summaryParts: string[] = [];
      if (item.pendingLeaves > 0) summaryParts.push(`${item.pendingLeaves} leave request(s)`);
      if (item.pendingRegularizations > 0) summaryParts.push(`${item.pendingRegularizations} attendance regularization(s)`);

      await this.notificationService.sendNotification(
        companyId,
        {
          userId: item.managerUserId,
          type: 'manager_daily_digest',
          title: 'Daily Approvals Digest',
          body: `You have ${item.totalPending} pending item(s) awaiting your action: ${summaryParts.join(', ')}.`,
          link: '/workflow/inbox',
        },
        targetPool
      );
      sentCount++;
    }

    logger.info(
      { companyId, sentCount, totalManagersWithPending: digestItems.length },
      'Manager daily approvals digest completed'
    );

    return { sentCount, items: digestItems };
  }
}
