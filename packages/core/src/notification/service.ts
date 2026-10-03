import type pg from 'pg';
import { Redis } from 'ioredis';
import { UnauthorizedError } from '@hrms/shared';
import { getEnv } from '@hrms/config';
import type { RequestContext } from '../routing/context.js';
import {
  NotificationRepository,
  type NotificationRow,
  type NotificationPreferenceRow,
} from './repository.js';
import { getRedisClient } from '../redis/client.js';

export class NotificationService {
  private repo: NotificationRepository;

  constructor(repo?: NotificationRepository) {
    this.repo = repo ?? new NotificationRepository();
  }

  private ensureUserId(ctx: RequestContext): string {
    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required for notification actions.');
    }
    return ctx.userId;
  }

  /**
   * Helper to create a new Redis subscriber instance (for SSE).
   */
  createSubscriber(): Redis {
    const env = getEnv();
    return new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
  }

  /**
   * Creates an in-app notification if the recipient has enabled in-app channel.
   * Invalidates Redis unread count cache and publishes live SSE notification to Redis.
   */
  async sendNotification(
    companyId: string,
    data: {
      userId: string;
      type: string;
      title: string;
      body: string;
      link?: string | null | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<NotificationRow | null> {
    // 1. Check user preferences
    const prefs = await this.repo.getPreferences(companyId, data.userId, poolOverride);
    if (prefs && prefs.channels && prefs.channels.in_app === false) {
      return null;
    }

    // 2. Insert notification
    const notification = await this.repo.createNotification(companyId, data, undefined, poolOverride);

    // 3. Invalidate Redis unread count cache and publish live event
    try {
      const redis = getRedisClient();
      const cacheKey = `unread_notifs:${companyId}:${data.userId}`;
      await redis.del(cacheKey);

      const channel = `notifications:${companyId}:${data.userId}`;
      await redis.publish(
        channel,
        JSON.stringify({
          event: 'notification_created',
          data: notification,
        }),
      );
    } catch {
      // Redis notification publishing is best-effort and non-fatal
    }

    return notification;
  }

  /**
   * Returns unread notifications count, reading through Redis cache (5 min TTL).
   */
  async getUnreadCount(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<number> {
    const userId = this.ensureUserId(ctx);
    const cacheKey = `unread_notifs:${ctx.companyId}:${userId}`;

    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        return parseInt(cached, 10);
      }
    } catch {
      // Fallback to database
    }

    const count = await this.repo.getUnreadCount(ctx.companyId, userId, poolOverride);

    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, count.toString(), 'EX', 300);
    } catch {
      // Ignore cache write failure
    }

    return count;
  }

  /**
   * Lists notifications for current user with keyset cursor.
   */
  async listNotifications(
    ctx: RequestContext,
    params: { cursor?: string | undefined; limit?: number | undefined },
    poolOverride?: pg.Pool,
  ): Promise<{ items: NotificationRow[]; nextCursor?: string | undefined }> {
    const userId = this.ensureUserId(ctx);
    return this.repo.listUserNotifications(ctx.companyId, userId, params, poolOverride);
  }

  /**
   * Marks a notification as read and refreshes cache.
   */
  async markAsRead(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<{ success: boolean }> {
    const userId = this.ensureUserId(ctx);
    const updated = await this.repo.markAsRead(ctx.companyId, id, userId, poolOverride);
    if (updated) {
      try {
        const redis = getRedisClient();
        await redis.del(`unread_notifs:${ctx.companyId}:${userId}`);
      } catch {
        // Ignore cache failure
      }
    }
    return { success: updated };
  }

  /**
   * Marks all notifications as read for current user.
   */
  async markAllAsRead(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<{ count: number }> {
    const userId = this.ensureUserId(ctx);
    const count = await this.repo.markAllAsRead(ctx.companyId, userId, poolOverride);
    try {
      const redis = getRedisClient();
      await redis.set(`unread_notifs:${ctx.companyId}:${userId}`, '0', 'EX', 300);
      const channel = `notifications:${ctx.companyId}:${userId}`;
      await redis.publish(
        channel,
        JSON.stringify({
          event: 'all_read',
          count,
        }),
      );
    } catch {
      // Ignore cache failure
    }
    return { count };
  }

  /**
   * Retrieves notification preferences for current user.
   */
  async getPreferences(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<NotificationPreferenceRow> {
    const userId = this.ensureUserId(ctx);
    const existing = await this.repo.getPreferences(ctx.companyId, userId, poolOverride);
    if (existing) {
      return existing;
    }
    return this.repo.upsertPreferences(
      ctx.companyId,
      userId,
      { in_app: true, email: true },
      poolOverride,
    );
  }

  /**
   * Updates notification preferences for current user.
   */
  async updatePreferences(
    ctx: RequestContext,
    channels: { in_app?: boolean; email?: boolean },
    poolOverride?: pg.Pool,
  ): Promise<NotificationPreferenceRow> {
    const userId = this.ensureUserId(ctx);
    return this.repo.upsertPreferences(ctx.companyId, userId, channels, poolOverride);
  }
}
