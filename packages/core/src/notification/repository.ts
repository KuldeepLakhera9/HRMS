import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';

export interface NotificationRow {
  id: string;
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export interface NotificationPreferenceRow {
  id: string;
  companyId: string;
  userId: string;
  channels: { in_app?: boolean; email?: boolean };
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationRepository {
  /**
   * Inserts an in-app notification.
   */
  async createNotification(
    companyId: string,
    data: {
      userId: string;
      type: string;
      title: string;
      body: string;
      link?: string | null | undefined;
    },
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<NotificationRow> {
    const id = generateUuidV7();

    const execute = async (client: pg.PoolClient | pg.Pool) => {
      const res = await client.query<NotificationRow>(
        `INSERT INTO notifications (
           id, company_id, user_id, type, title, body, link
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id, company_id as "companyId", user_id as "userId", type,
           title, body, link, read_at as "readAt",
           created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"`,
        [id, companyId, data.userId, data.type, data.title, data.body, data.link || null],
      );
      return res.rows[0]!;
    };

    if (clientOverride) {
      return execute(clientOverride);
    }

    return withTenant({ companyId }, async (_tx, client) => execute(client), poolOverride);
  }

  /**
   * Computes unread notifications count for a user using the index.
   */
  async getUnreadCount(
    companyId: string,
    userId: string,
    poolOverride?: pg.Pool,
  ): Promise<number> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM notifications
           WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL AND deleted_at IS NULL`,
          [companyId, userId],
        );
        return parseInt(res.rows[0]?.count || '0', 10);
      },
      poolOverride,
    );
  }

  /**
   * Lists notifications for a user with keyset cursor pagination.
   */
  async listUserNotifications(
    companyId: string,
    userId: string,
    params: { cursor?: string | undefined; limit?: number | undefined },
    poolOverride?: pg.Pool,
  ): Promise<{ items: NotificationRow[]; nextCursor?: string | undefined }> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const wheres = ['company_id = $1', 'user_id = $2', 'deleted_at IS NULL'];
        const values: unknown[] = [companyId, userId];
        let pIdx = 3;

        if (params.cursor) {
          wheres.push(`id < $${pIdx++}`);
          values.push(params.cursor);
        }

        const limit = Math.min(params.limit || 20, 50);
        values.push(limit + 1);

        const res = await client.query<NotificationRow>(
          `SELECT
             id, company_id as "companyId", user_id as "userId", type,
             title, body, link, read_at as "readAt",
             created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"
           FROM notifications
           WHERE ${wheres.join(' AND ')}
           ORDER BY created_at DESC, id DESC
           LIMIT $${pIdx}`,
          values,
        );

        const hasMore = res.rows.length > limit;
        const items = hasMore ? res.rows.slice(0, limit) : res.rows;
        const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : undefined;

        return { items, nextCursor };
      },
      poolOverride,
    );
  }

  /**
   * Marks a single notification as read.
   */
  async markAsRead(
    companyId: string,
    id: string,
    userId: string,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE notifications
           SET read_at = now(), updated_at = now()
           WHERE company_id = $1 AND id = $2 AND user_id = $3 AND read_at IS NULL AND deleted_at IS NULL`,
          [companyId, id, userId],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }

  /**
   * Marks all notifications as read for a user.
   */
  async markAllAsRead(
    companyId: string,
    userId: string,
    poolOverride?: pg.Pool,
  ): Promise<number> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE notifications
           SET read_at = now(), updated_at = now()
           WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL AND deleted_at IS NULL`,
          [companyId, userId],
        );
        return res.rowCount ?? 0;
      },
      poolOverride,
    );
  }

  /**
   * Fetches notification preferences for a user.
   */
  async getPreferences(
    companyId: string,
    userId: string,
    poolOverride?: pg.Pool,
  ): Promise<NotificationPreferenceRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<NotificationPreferenceRow>(
          `SELECT
             id, company_id as "companyId", user_id as "userId", channels,
             created_at as "createdAt", updated_at as "updatedAt"
           FROM notification_preferences
           WHERE company_id = $1 AND user_id = $2 AND deleted_at IS NULL
           LIMIT 1`,
          [companyId, userId],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  /**
   * Upserts notification preferences for a user.
   */
  async upsertPreferences(
    companyId: string,
    userId: string,
    channels: { in_app?: boolean; email?: boolean },
    poolOverride?: pg.Pool,
  ): Promise<NotificationPreferenceRow> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const id = generateUuidV7();
        const res = await client.query<NotificationPreferenceRow>(
          `INSERT INTO notification_preferences (
             id, company_id, user_id, channels, updated_at
           ) VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (company_id, user_id) WHERE deleted_at IS NULL
           DO UPDATE SET channels = $4, updated_at = now()
           RETURNING
             id, company_id as "companyId", user_id as "userId", channels,
             created_at as "createdAt", updated_at as "updatedAt"`,
          [id, companyId, userId, JSON.stringify(channels)],
        );
        return res.rows[0]!;
      },
      poolOverride,
    );
  }
}
