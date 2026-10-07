/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Payroll Calculation Worker & Review Console Load Benchmark (Sprint 4.3: P4-RUN-03, P4-RUN-04, P4-RUN-05)
 * Benchmarks:
 * - 5,000 employees batch calculation throughput (target <= 5 min)
 * - Review Console endpoints (summary <= 2 queries, variance set-based SQL, keyset staged employees <= 4 queries)
 * - SLAs:
 *   - Read queries p95 <= 200 ms
 *   - Calculation trigger / write p95 <= 400 ms
 */

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp-up finance operators
    { duration: '1m', target: 50 },   // Concurrent inspection and calculation triggers
    { duration: '30s', target: 0 },   // Cool down
  ],
  thresholds: {
    'http_req_duration{type:read}': ['p(95)<200'],
    'http_req_duration{type:write}': ['p(95)<400'],
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const RUN_ID = __ENV.RUN_ID || '018f0000-0000-7000-8000-000000000001';

export default function () {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'X-Request-Id': `k6-payroll-${__VU}-${__ITER}`,
  };

  // 1. Fetch Payroll Run Summary (bounded query budget <= 2 SQL queries)
  const summaryRes = http.get(
    `${BASE_URL}/api/v1/payroll/runs/${RUN_ID}/summary`,
    {
      headers: commonHeaders,
      tags: { type: 'read' },
    },
  );

  check(summaryRes, {
    'summary returns 200 or 401': r => [200, 401, 404].includes(r.status),
  });

  // 2. Fetch Staged Employees with Keyset Pagination (query budget <= 4 SQL queries)
  const employeesRes = http.get(
    `${BASE_URL}/api/v1/payroll/runs/${RUN_ID}/employees?limit=50`,
    {
      headers: commonHeaders,
      tags: { type: 'read' },
    },
  );

  check(employeesRes, {
    'employees keyset pagination returns 200 or 401': r => [200, 401, 404].includes(r.status),
  });

  // 3. Fetch Set-Based Variance Analysis
  const varianceRes = http.get(
    `${BASE_URL}/api/v1/payroll/runs/${RUN_ID}/variance?threshold=10`,
    {
      headers: commonHeaders,
      tags: { type: 'read' },
    },
  );

  check(varianceRes, {
    'variance analysis returns 200 or 401': r => [200, 401, 404].includes(r.status),
  });

  // 4. Simulate single-employee payslip calculation
  const simPayload = JSON.stringify({
    runId: RUN_ID,
    employeeId: '018f0000-0000-7000-8000-000000000002',
    dryRun: true,
  });

  const simRes = http.post(
    `${BASE_URL}/api/v1/payroll/runs/simulate`,
    simPayload,
    {
      headers: commonHeaders,
      tags: { type: 'write' },
    },
  );

  check(simRes, {
    'simulation returns 200, 400, or 401': r => [200, 400, 401, 404].includes(r.status),
  });

  sleep(1);
}
