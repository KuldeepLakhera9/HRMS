import { NextResponse } from 'next/server';
import { getAppPool } from '@hrms/db';
import { getEnv } from '@hrms/config';
import { Redis } from 'ioredis';

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    const env = getEnv();
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
  }
  return redisClient;
}

/**
 * Readiness probe: checks PostgreSQL (hrms_app role) and Redis connectivity.
 */
export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();

  const checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
  } = {
    database: 'down',
    redis: 'down',
  };

  // 1. Check PostgreSQL connectivity as hrms_app
  try {
    const pool = getAppPool();
    const result = await pool.query('SELECT 1 as alive;');
    if (result.rows[0]?.alive === 1) {
      checks.database = 'up';
    }
  } catch {
    // Database check failed
  }

  // 2. Check Redis connectivity
  try {
    const redis = getRedis();
    if (redis.status === 'wait') {
      await redis.connect();
    }
    const pong = await redis.ping();
    if (pong === 'PONG') {
      checks.redis = 'up';
    }
  } catch {
    // Redis check failed
  }

  const isReady = checks.database === 'up' && checks.redis === 'up';

  return NextResponse.json(
    {
      status: isReady ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: isReady ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Request-Id': requestId,
      },
    },
  );
}
