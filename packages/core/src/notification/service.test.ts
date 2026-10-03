import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, SYSTEM_ROLES } from '@hrms/shared';
import { NotificationService } from './service.js';
import type { NotificationRepository, NotificationRow, NotificationPreferenceRow } from './repository.js';
import type { RequestContext } from '../routing/context.js';

// Mock Redis client
const mockRedis = {
  del: vi.fn().mockResolvedValue(1),
  publish: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
};

vi.mock('../redis/client.js', () => ({
  getRedisClient: vi.fn(() => mockRedis),
}));

describe('NotificationService Unit Tests (P1-NOTIF-01 & P1-NOTIF-02)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const notifId = '33333333-3333-3333-3333-333333333333';

  let mockRepo: Partial<NotificationRepository>;
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepo = {
      getPreferences: vi.fn(),
      upsertPreferences: vi.fn(),
      createNotification: vi.fn(),
      getUnreadCount: vi.fn(),
      listUserNotifications: vi.fn(),
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
    };

    service = new NotificationService(mockRepo as NotificationRepository);
  });

  const userCtx: RequestContext = {
    requestId: 'req-1',
    companyId,
    userId,
    isAuthenticated: true,
    roles: [SYSTEM_ROLES.EMPLOYEE],
    permissions: [],
  };

  const unauthCtx: RequestContext = {
    requestId: 'req-2',
    companyId,
    isAuthenticated: false,
    roles: [],
    permissions: [],
  };

  it('respects user preferences and skips in-app notification if channel in_app is disabled', async () => {
    const disabledPrefs: NotificationPreferenceRow = {
      id: 'pref-1',
      companyId,
      userId,
      channels: { in_app: false, email: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockRepo.getPreferences!).mockResolvedValue(disabledPrefs);

    const result = await service.sendNotification(companyId, {
      userId,
      type: 'change_request_decided',
      title: 'Request Approved',
      body: 'Your profile changes have been approved.',
    });

    expect(result).toBeNull();
    expect(mockRepo.createNotification).not.toHaveBeenCalled();
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  it('creates in-app notification, invalidates cache, and publishes SSE message when enabled', async () => {
    const dummyNotif: NotificationRow = {
      id: notifId,
      companyId,
      userId,
      type: 'change_request_decided',
      title: 'Request Approved',
      body: 'Your profile changes have been approved.',
      link: '/profile',
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    };

    vi.mocked(mockRepo.getPreferences!).mockResolvedValue(null); // Defaults to enabled
    vi.mocked(mockRepo.createNotification!).mockResolvedValue(dummyNotif);

    const result = await service.sendNotification(companyId, {
      userId,
      type: 'change_request_decided',
      title: 'Request Approved',
      body: 'Your profile changes have been approved.',
      link: '/profile',
    });

    expect(result).toEqual(dummyNotif);
    expect(mockRepo.createNotification).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith(`unread_notifs:${companyId}:${userId}`);
    expect(mockRedis.publish).toHaveBeenCalledWith(
      `notifications:${companyId}:${userId}`,
      JSON.stringify({
        event: 'notification_created',
        data: dummyNotif,
      }),
    );
  });

  it('returns unread count from Redis cache without querying database', async () => {
    mockRedis.get.mockResolvedValueOnce('5');

    const count = await service.getUnreadCount(userCtx);

    expect(count).toBe(5);
    expect(mockRedis.get).toHaveBeenCalledWith(`unread_notifs:${companyId}:${userId}`);
    expect(mockRepo.getUnreadCount).not.toHaveBeenCalled();
  });

  it('queries database on cache miss and sets count in Redis with TTL', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    vi.mocked(mockRepo.getUnreadCount!).mockResolvedValue(3);

    const count = await service.getUnreadCount(userCtx);

    expect(count).toBe(3);
    expect(mockRepo.getUnreadCount).toHaveBeenCalledWith(companyId, userId, undefined);
    expect(mockRedis.set).toHaveBeenCalledWith(`unread_notifs:${companyId}:${userId}`, '3', 'EX', 300);
  });

  it('marks notification as read and invalidates unread count cache', async () => {
    vi.mocked(mockRepo.markAsRead!).mockResolvedValue(true);

    const result = await service.markAsRead(userCtx, notifId);

    expect(result).toEqual({ success: true });
    expect(mockRepo.markAsRead).toHaveBeenCalledWith(companyId, notifId, userId, undefined);
    expect(mockRedis.del).toHaveBeenCalledWith(`unread_notifs:${companyId}:${userId}`);
  });

  it('marks all notifications as read and invalidates unread count cache', async () => {
    vi.mocked(mockRepo.markAllAsRead!).mockResolvedValue(4);

    const result = await service.markAllAsRead(userCtx);

    expect(result).toEqual({ count: 4 });
    expect(mockRepo.markAllAsRead).toHaveBeenCalledWith(companyId, userId, undefined);
    expect(mockRedis.set).toHaveBeenCalledWith(`unread_notifs:${companyId}:${userId}`, '0', 'EX', 300);
    expect(mockRedis.publish).toHaveBeenCalledWith(
      `notifications:${companyId}:${userId}`,
      JSON.stringify({ event: 'all_read', count: 4 }),
    );
  });

  it('rejects unauthenticated user from reading or updating notifications', async () => {
    await expect(service.getUnreadCount(unauthCtx)).rejects.toThrow(UnauthorizedError);
    await expect(service.markAsRead(unauthCtx, notifId)).rejects.toThrow(UnauthorizedError);
    await expect(service.listNotifications(unauthCtx, {})).rejects.toThrow(UnauthorizedError);
  });
});
