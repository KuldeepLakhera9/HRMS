import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflinePunchQueue } from './offline-queue.js';
import * as apiModule from './api.js';

vi.mock('expo-secure-store', () => {
  const memoryStore = new Map<string, string>();
  return {
    setItemAsync: vi.fn(async (key: string, value: string) => {
      memoryStore.set(key, value);
    }),
    getItemAsync: vi.fn(async (key: string) => {
      return memoryStore.get(key) ?? null;
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      memoryStore.delete(key);
    }),
  };
});

describe('P2-MOB-03: OfflinePunchQueue Tests', () => {
  let queue: OfflinePunchQueue;

  beforeEach(() => {
    vi.restoreAllMocks();
    queue = new OfflinePunchQueue();
    queue.clear();
  });

  it('enqueues a punch with pending status and increments count', () => {
    const punch = queue.enqueue({
      id: '018e38f9-b88d-78c6-a675-9b2f6ef13928',
      punchType: 'in',
      eventTs: '2026-03-10T09:00:00Z',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
    });

    expect(punch.status).toBe('pending');
    expect(punch.attempts).toBe(0);
    expect(queue.getPendingCount()).toBe(1);
  });

  it('caps queue size to 20 punches max', () => {
    for (let i = 0; i < 25; i++) {
      queue.enqueue({
        id: `punch-id-${i}`,
        punchType: 'in',
        eventTs: new Date(Date.now() + i * 1000).toISOString(),
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 10,
      });
    }

    expect(queue.getQueue().length).toBe(20);
  });

  it('synchronizes pending punches in strict FIFO order', async () => {
    const callOrder: string[] = [];

    vi.spyOn(apiModule, 'apiClient').mockImplementation(async (_endpoint, options) => {
      const body = JSON.parse(options?.body as string);
      callOrder.push(body.idempotencyKey);
      return { success: true };
    });

    queue.enqueue({
      id: 'punch-older',
      punchType: 'in',
      eventTs: '2026-03-10T09:00:00Z',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
    });

    queue.enqueue({
      id: 'punch-newer',
      punchType: 'out',
      eventTs: '2026-03-10T18:00:00Z',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
    });

    const result = await queue.syncQueue();

    expect(result.synced).toBe(2);
    expect(callOrder).toEqual(['punch-older', 'punch-newer']);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('marks non-retryable 4xx errors as rejected and continues sync', async () => {
    vi.spyOn(apiModule, 'apiClient').mockImplementation(async (_endpoint, options) => {
      const body = JSON.parse(options?.body as string);
      if (body.idempotencyKey === 'bad-punch') {
        throw new apiModule.ApiError('Device not recognized', 403);
      }
      return { success: true };
    });

    queue.enqueue({
      id: 'bad-punch',
      punchType: 'in',
      eventTs: '2026-03-10T09:00:00Z',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
    });

    queue.enqueue({
      id: 'good-punch',
      punchType: 'out',
      eventTs: '2026-03-10T18:00:00Z',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
    });

    const result = await queue.syncQueue();

    expect(result.rejected).toBe(1);
    expect(result.synced).toBe(1);

    const all = queue.getQueue();
    expect(all.find(p => p.id === 'bad-punch')?.status).toBe('rejected');
    expect(all.find(p => p.id === 'good-punch')).toBeUndefined(); // synced and removed
  });

  it('halts FIFO queue on network error to preserve event sequence', async () => {
    let calls = 0;
    vi.spyOn(apiModule, 'apiClient').mockImplementation(async () => {
      calls++;
      throw new Error('Network request failed');
    });

    queue.enqueue({
      id: 'first-punch',
      punchType: 'in',
      eventTs: '2026-03-10T09:00:00Z',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
    });

    queue.enqueue({
      id: 'second-punch',
      punchType: 'out',
      eventTs: '2026-03-10T18:00:00Z',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
    });

    const result = await queue.syncQueue();

    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
    expect(calls).toBe(1); // Second punch not called to preserve FIFO
    expect(queue.getPendingCount()).toBe(2);
  });
});
