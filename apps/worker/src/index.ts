import { Redis } from 'ioredis';
import { getEnv } from '@hrms/config';
import { closePools } from '@hrms/db';
import { getLogger } from '@hrms/core';
import { OutboxRelayWorker } from './outbox-relay.js';
import { PartitionMaintenanceWorker } from './partition-maintenance.js';
import { WorkflowSlaSweepWorker } from './workflow-sweep.js';

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

  // Initialize and start background worker daemons
  const outboxRelay = new OutboxRelayWorker();
  outboxRelay.start(2000); // Poll every 2 seconds

  const partitionMaintenance = new PartitionMaintenanceWorker();
  partitionMaintenance.start(24 * 60 * 60 * 1000); // Check once daily

  const workflowSlaSweep = new WorkflowSlaSweepWorker();
  workflowSlaSweep.start(15 * 60 * 1000); // Check every 15 minutes

  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Received termination signal. Draining queues and shutting down...');

    try {
      outboxRelay.stop();
      partitionMaintenance.stop();
      workflowSlaSweep.stop();
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
