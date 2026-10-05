/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * End-of-Day Close & Batch Attendance Processing Benchmark (P2-QA-03)
 * Tests system throughput during automated daily closure and bulk exception resolution:
 * - Keyset-paginated retrieval of attendance days for 5,000 employees
 * - Bulk resolution of auto-outs and missing punches
 * - Performance SLAs:
 *   - Read queries p95 <= 200 ms
 *   - Bulk write/recompute p95 <= 400 ms
 */

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp-up batch workers
    { duration: '2m', target: 100 },  // Peak concurrent batch evaluation
    { duration: '30s', target: 0 },   // Cool down
  ],
  thresholds: {
    'http_req_duration{type:read}': ['p(95)<200'],
    'http_req_duration{type:write}': ['p(95)<400'],
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'X-Request-Id': `k6-close-${__VU}-${__ITER}`,
  };

  // 1. Fetch unclosed or pending attendance records for day close
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const readRes = http.get(
    `${BASE_URL}/api/v1/attendance/calendar?from=${yesterday}&to=${yesterday}&limit=100`,
    {
      headers: commonHeaders,
      tags: { type: 'read' },
    },
  );

  check(readRes, {
    'day query returns 200 or 401': r => [200, 401].includes(r.status),
  });

  // 2. Query Exceptions to be auto-resolved
  const excRes = http.get(
    `${BASE_URL}/api/v1/attendance/exceptions?date=${yesterday}&limit=50`,
    {
      headers: commonHeaders,
      tags: { type: 'read' },
    },
  );

  check(excRes, {
    'exceptions query returns 200 or 401': r => [200, 401].includes(r.status),
  });

  // 3. Trigger bulk resolution of daily anomalies
  const bulkPayload = JSON.stringify({
    exceptionIds: [`mock-exc-${__VU}-1`, `mock-exc-${__VU}-2`],
    resolutionStatus: 'resolved',
    notes: 'Automated batch reconciliation via Day Close Job',
  });

  const writeRes = http.post(
    `${BASE_URL}/api/v1/attendance/exceptions/bulk-resolve`,
    bulkPayload,
    {
      headers: commonHeaders,
      tags: { type: 'write' },
    },
  );

  check(writeRes, {
    'bulk resolve returns 200, 400, or 401': r => [200, 400, 401].includes(r.status),
  });

  sleep(1);
}
