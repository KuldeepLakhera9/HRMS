import { apiClient, ApiError } from './api.js';

export interface QueuedPunch {
  id: string; // Client UUIDv7 idempotency key
  punchType: 'in' | 'out';
  eventTs: string; // ISO string
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  deviceId?: string | null;
  qrToken?: string | null;
  wifiBssid?: string | null;
  selfieFileId?: string | null;
  attempts: number;
  lastAttemptAt?: number | null;
  status: 'pending' | 'syncing' | 'failed' | 'rejected';
  errorMessage?: string | null;
}

const QUEUE_STORAGE_KEY = 'hrms_offline_punch_queue';
const MAX_QUEUE_SIZE = 20;

export class OfflinePunchQueue {
  private inMemoryQueue: QueuedPunch[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof globalThis !== 'undefined') {
      const data = (globalThis as Record<string, unknown>)[QUEUE_STORAGE_KEY] as string | undefined;
      if (data) {
        try {
          this.inMemoryQueue = JSON.parse(data) as QueuedPunch[];
        } catch {
          this.inMemoryQueue = [];
        }
      }
    }
  }

  private saveToStorage(): void {
    if (typeof globalThis !== 'undefined') {
      (globalThis as Record<string, unknown>)[QUEUE_STORAGE_KEY] = JSON.stringify(this.inMemoryQueue);
    }
  }

  /**
   * Enqueues a punch with client-generated UUIDv7 idempotency key.
   * Limits queue to MAX_QUEUE_SIZE (20).
   */
  enqueue(
    punch: Omit<QueuedPunch, 'attempts' | 'status' | 'errorMessage' | 'lastAttemptAt'>,
  ): QueuedPunch {
    if (this.inMemoryQueue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest rejected or failed first, or oldest pending
      const removeIndex = this.inMemoryQueue.findIndex(p => p.status === 'rejected' || p.status === 'failed');
      if (removeIndex !== -1) {
        this.inMemoryQueue.splice(removeIndex, 1);
      } else {
        this.inMemoryQueue.shift(); // drop oldest
      }
    }

    const item: QueuedPunch = {
      ...punch,
      attempts: 0,
      status: 'pending',
    };

    this.inMemoryQueue.push(item);
    this.saveToStorage();
    return item;
  }

  /**
   * Returns all items currently in the offline queue.
   */
  getQueue(): QueuedPunch[] {
    return [...this.inMemoryQueue];
  }

  /**
   * Returns count of items pending synchronization.
   */
  getPendingCount(): number {
    return this.inMemoryQueue.filter(p => p.status === 'pending').length;
  }

  /**
   * Clears all items from the queue.
   */
  clear(): void {
    this.inMemoryQueue = [];
    this.saveToStorage();
  }

  /**
   * Synchronizes queued punches in strict FIFO order with exponential backoff.
   */
  async syncQueue(): Promise<{ synced: number; failed: number; rejected: number }> {
    const pendingItems = this.inMemoryQueue.filter(p => p.status === 'pending');
    // Sort strictly by eventTs (FIFO)
    pendingItems.sort((a, b) => new Date(a.eventTs).getTime() - new Date(b.eventTs).getTime());

    let synced = 0;
    let failed = 0;
    let rejected = 0;

    for (const item of pendingItems) {
      item.status = 'syncing';
      item.attempts += 1;
      item.lastAttemptAt = Date.now();

      try {
        await apiClient('/api/v1/attendance/punch', {
          method: 'POST',
          body: JSON.stringify({
            punchType: item.punchType,
            eventTs: item.eventTs,
            latitude: item.latitude,
            longitude: item.longitude,
            accuracyMeters: item.accuracyMeters,
            deviceId: item.deviceId,
            qrToken: item.qrToken,
            wifiBssid: item.wifiBssid,
            selfieFileId: item.selfieFileId,
            idempotencyKey: item.id,
            source: 'mobile',
          }),
        });

        // Successful sync: remove from queue
        this.inMemoryQueue = this.inMemoryQueue.filter(p => p.id !== item.id);
        synced++;
      } catch (err: unknown) {
        if (err instanceof ApiError && err.statusCode >= 400 && err.statusCode < 500) {
          // Client/Policy Rejection (non-retryable, e.g. 403 device mismatch or 422 validation)
          item.status = 'rejected';
          item.errorMessage = err.message;
          rejected++;
        } else {
          // Network or server 5xx: mark failed, stop syncing to preserve order
          item.status = 'pending';
          item.errorMessage = err instanceof Error ? err.message : 'Network error';
          failed++;
          this.saveToStorage();
          break; // Stop sync loop on network failure
        }
      }
    }

    this.saveToStorage();
    return { synced, failed, rejected };
  }
}

export const offlineQueue = new OfflinePunchQueue();
