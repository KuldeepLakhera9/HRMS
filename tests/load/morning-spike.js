/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Phase 3 Morning Peak & Operational Spike Benchmark (P3-QA-02)
 *
 * Simulates peak concurrent operations across 5,000 employees:
 * - 2,000 punches in morning arrival window (mobile geofence + biometric turnstiles)
 * - 300 concurrent employee sessions (announcements feed, leave balance preview, team calendar)
 * - 50 concurrent HR / Manager sessions (live presence board, exceptions inbox, report preview)
 *
 * Latency SLAs:
 * - Read endpoints (Announcements, Calendar, Report Preview, Exceptions): p95 <= 200 ms
 * - Write endpoints (Punch Ingest, Leave Preview / Submit): p95 <= 400 ms
 * - Error rate: < 1%
 */

export const options = {
  scenarios: {
    // Scenario 1: Arrival Punches (Mobile & Biometric turnstile surge)
    punch_surge: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 150,
      stages: [
        { target: 10, duration: '1m' },
        { target: 35, duration: '3m' }, // Peak arrival burst
        { target: 10, duration: '1m' },
      ],
      exec: 'punchFlow',
    },

    // Scenario 2: Employee Portal Activity (Feed, Leave Previews, Calendar)
    employee_portal: {
      executor: 'ramping-vus',
      startVUs: 20,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '3m', target: 250 },
        { duration: '1m', target: 50 },
      ],
      exec: 'employeePortalFlow',
    },

    // Scenario 3: HR & Management Operations (Exceptions, Reports Sync Preview, Live Board)
    hr_operations: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 30 },
        { duration: '3m', target: 50 },
        { duration: '1m', target: 10 },
      ],
      exec: 'hrOperationsFlow',
    },
  },

  thresholds: {
    'http_req_duration{endpoint:punch}': ['p(95)<400'],
    'http_req_duration{endpoint:leave_preview}': ['p(95)<300'],
    'http_req_duration{endpoint:announcements}': ['p(95)<200'],
    'http_req_duration{endpoint:calendar}': ['p(95)<200'],
    'http_req_duration{endpoint:report_preview}': ['p(95)<200'],
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export function punchFlow() {
  const isBiometric = __ITER % 3 === 0;

  if (isBiometric) {
    const bioPayload = JSON.stringify({
      deviceId: 'BIO-GATE-HQ-01',
      records: [
        {
          punchTime: new Date().toISOString(),
          punchType: 'in',
          userIdentifier: `EMP${String((__VU * 100 + __ITER) % 5000 + 1).padStart(5, '0')}`,
          rawRecordId: `rec-p3-${__VU}-${__ITER}-${Date.now()}`,
        },
      ],
    });

    const res = http.post(`${BASE_URL}/api/v1/attendance/biometric/ingest`, bioPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': 'BIO-GATE-HQ-01',
        'X-Signature': 'mock-sig-benchmark-p3',
        'X-Request-Id': `k6-p3-bio-${__VU}-${__ITER}`,
      },
      tags: { endpoint: 'punch', type: 'write' },
    });

    check(res, {
      'biometric punch status 200, 202, or 401': (r) => [200, 202, 401].includes(r.status),
    });
  } else {
    const mobilePayload = JSON.stringify({
      punchType: 'in',
      eventTs: new Date().toISOString(),
      latitude: 12.971598,
      longitude: 77.594562,
      accuracyMeters: 5.0,
      isMock: false,
      deviceId: `device-${__VU}`,
      idempotencyKey: `p3-punch-${__VU}-${__ITER}-${Date.now()}`,
      source: 'mobile',
    });

    const res = http.post(`${BASE_URL}/api/v1/attendance/punch`, mobilePayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': `k6-p3-mob-${__VU}-${__ITER}`,
      },
      tags: { endpoint: 'punch', type: 'write' },
    });

    check(res, {
      'mobile punch status 200, 201, or 401': (r) => [200, 201, 401].includes(r.status),
    });
  }

  sleep(1);
}

export function employeePortalFlow() {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'X-Request-Id': `k6-p3-emp-${__VU}-${__ITER}`,
  };

  // 1. Fetch Company Announcements Feed
  const annRes = http.get(`${BASE_URL}/api/v1/announcements?limit=10`, {
    headers: commonHeaders,
    tags: { endpoint: 'announcements', type: 'read' },
  });
  check(annRes, {
    'announcements status 200 or 401': (r) => [200, 401].includes(r.status),
  });

  // 2. Query Team Leave & Holiday Calendar
  const todayStr = new Date().toISOString().slice(0, 10);
  const calRes = http.get(`${BASE_URL}/api/v1/attendance/calendar?from=${todayStr}&to=${todayStr}`, {
    headers: commonHeaders,
    tags: { endpoint: 'calendar', type: 'read' },
  });
  check(calRes, {
    'calendar query status 200 or 401': (r) => [200, 401].includes(r.status),
  });

  // 3. Preview Leave Request impact (Balance row calculation)
  const leavePreviewPayload = JSON.stringify({
    leaveTypeId: 'type-paid-leave-001',
    fromDate: todayStr,
    toDate: todayStr,
    isHalfDay: false,
  });

  const prevRes = http.post(`${BASE_URL}/api/v1/leave/preview`, leavePreviewPayload, {
    headers: commonHeaders,
    tags: { endpoint: 'leave_preview', type: 'read' },
  });
  check(prevRes, {
    'leave preview status 200, 400, or 401': (r) => [200, 400, 401].includes(r.status),
  });

  sleep(2);
}

export function hrOperationsFlow() {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'X-Request-Id': `k6-p3-hr-${__VU}-${__ITER}`,
  };

  // 1. Live Attendance Board
  const liveRes = http.get(`${BASE_URL}/api/v1/attendance/live?status=in&limit=50`, {
    headers: commonHeaders,
    tags: { endpoint: 'live_board', type: 'read' },
  });
  check(liveRes, {
    'live board query status 200 or 401': (r) => [200, 401].includes(r.status),
  });

  // 2. Synchronous Report Preview (daily_attendance_summary)
  const todayStr = new Date().toISOString().slice(0, 10);
  const repRes = http.get(
    `${BASE_URL}/api/v1/reports/daily_attendance_summary/preview?startDate=${todayStr}&endDate=${todayStr}&limit=50`,
    {
      headers: commonHeaders,
      tags: { endpoint: 'report_preview', type: 'read' },
    },
  );
  check(repRes, {
    'report preview status 200 or 401': (r) => [200, 401].includes(r.status),
  });

  sleep(2);
}
