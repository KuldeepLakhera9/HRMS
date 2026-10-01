import { Redis } from 'ioredis';
import { getEnv } from '@hrms/config';
import { closePools } from '@hrms/db';
import { getLogger } from '@hrms/core';

const logger = getLogger().child({ service: 'worker' });

async function startWorker() {
  const env = getEnv();
  logger.info({ redisUrl: env.REDIS_URL }, 'Starting HRMS background worker...');

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  redis.on('connect', () => {
    logger.info('Worker successfully connected to Redis.');
  });

  redis.on('error', err => {
    logger.error({ err }, 'Worker Redis connection error');
  });

  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Received termination signal. Draining queues and shutting down...');

    try {
      await redis.quit();
      await closePools();
      logger.info('Worker shutdown completed cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('HRMS background worker initialized and standing by for outbox jobs.');
}

startWorker().catch(err => {
  logger.fatal({ err }, 'Fatal error during worker bootstrap');
  process.exit(1);
});
