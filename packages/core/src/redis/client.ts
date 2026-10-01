import { Redis } from 'ioredis';
import { getEnv } from '@hrms/config';

let redisInstance: Redis | null = null;

/**
 * Returns the singleton Redis connection instance for cache and rate limiting operations.
 */
export function getRedisClient(): Redis {
  if (!redisInstance) {
    const env = getEnv();
    redisInstance = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 2000);
      },
    });
  }
  return redisInstance;
}

/**
 * Closes the active Redis connection gracefully.
 */
export async function closeRedisClient(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
