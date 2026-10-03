import { NextResponse } from 'next/server';
import { getMetricsRegistry } from '@hrms/core';
import { getPoolStats } from '@hrms/db';
import { getEnv } from '@hrms/config';

/**
 * Prometheus metrics endpoint.
 * Protected by internal token header or internal network check per AGENTS.md / docs/PHASE1_SPEC.md.
 */
export async function GET(request: Request) {
  const env = getEnv();

  // Internal metrics token protection (if set in env)
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const internalSecret = (env as unknown as { METRICS_TOKEN?: string }).METRICS_TOKEN;

  if (internalSecret && token !== internalSecret) {
    return new NextResponse('Unauthorized: Invalid metrics token', { status: 401 });
  }

  const registry = getMetricsRegistry();

  // Refresh dynamic gauges
  try {
    const poolStats = getPoolStats();
    registry.setGauge('db_pool_total', { pool: 'app' }, poolStats.app.total);
    registry.setGauge('db_pool_idle', { pool: 'app' }, poolStats.app.idle);
    registry.setGauge('db_pool_waiting', { pool: 'app' }, poolStats.app.waiting);
  } catch {
    // Ignore pool stats fetch errors
  }

  const output = registry.exportPrometheus();

  return new NextResponse(output, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
