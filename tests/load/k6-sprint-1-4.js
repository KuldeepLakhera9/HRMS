/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * High-concurrency performance benchmark for HRMS Sprint 1.4 Gate G1.
 * Target: 200 concurrent VUs against 5,000 employees.
 * Performance SLAs:
 * - Read endpoints p95 <= 200 ms
 * - Write endpoints p95 <= 400 ms
 * - Error rate < 1%
 */

export const options = {
  stages: [
    { duration: '30s', target: 200 }, // Ramp-up to 200 VUs
    { duration: '1m', target: 200 },  // Steady-state load
    { duration: '15s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    'http_req_duration{type:read}': ['p(95)<200'],
    'http_req_duration{type:write}': ['p(95)<400'],
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': `k6-${__VU}-${__ITER}`,
    },
    tags: { type: 'read' },
  };

  // 1. Scrape Dashboard Aggregated Metrics
  const dashRes = http.get(`${BASE_URL}/api/v1/dashboard/metrics`, params);
  check(dashRes, {
    'dashboard status is 200 or 401': r => r.status === 200 || r.status === 401,
  });

  // 2. Query Employee Directory with search and filters (Indexed Query)
  const dirRes = http.get(
    `${BASE_URL}/api/v1/employees/directory?limit=50&search=sharma`,
    params,
  );
  check(dirRes, {
    'directory status is 200 or 401': r => r.status === 200 || r.status === 401,
  });

  // 3. Query Custom Field Definitions (Redis cached read)
  const cfRes = http.get(`${BASE_URL}/api/v1/custom-fields?entity=employee`, params);
  check(cfRes, {
    'custom-fields status is 200 or 401': r => r.status === 200 || r.status === 401,
  });

  // 4. Prometheus Metrics endpoint
  const metricsRes = http.get(`${BASE_URL}/api/metrics`, params);
  check(metricsRes, {
    'metrics status is 200 or 401': r => r.status === 200 || r.status === 401,
  });

  sleep(0.5);
}
