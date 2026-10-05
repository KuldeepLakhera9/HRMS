/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Morning Arrival Spike Benchmark (P2-QA-03)
 * Simulates peak office arrival window:
 * - 2,000 employee punches in 10 minutes
 * - 300 concurrent live viewer sessions (Manager Live Board & Exceptions Inbox)
 * Performance SLAs:
 * - Read endpoints (Live Board, Exceptions, Calendar): p95 <= 200 ms
 * - Write endpoints (Punch Ingest, Biometric, Regularization): p95 <= 400 ms
 * - Overall Error Rate: < 1%
 */

export const options = {
  scenarios: {
    // Scenario 1: Punch Influx (2,000 punches distributed over 10 minutes)
    punch_surge: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 150,
      stages: [
        { target: 5, duration: '2m' },   // Initial trickle of early arrivals
        { target: 15, duration: '6m' },  // Peak 09:00 AM clock-in rush
        { target: 3, duration: '2m' },   // Tapering off
      ],
      exec: 'punchFlow',
    },

    // Scenario 2: Manager & HR Live Monitoring (300 concurrent VUs checking Live Board & Calendar)
    manager_monitoring: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '7m', target: 300 }, // Sustained monitoring during peak arrival
        { duration: '2m', target: 50 },
      ],
      exec: 'managerFlow',
    },
  },

  thresholds: {
    'http_req_duration{endpoint:punch}': ['p(95)<400'],
    'http_req_duration{endpoint:live_board}': ['p(95)<200'],
    'http_req_duration{endpoint:exceptions}': ['p(95)<200'],
    'http_req_duration{endpoint:calendar}': ['p(95)<200'],
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/**
 * Simulates an employee punching in via Mobile Geofencing or Biometric Turnstile
 */
export function punchFlow() {
  const isBiometric = __ITER % 4 === 0;

  if (isBiometric) {
    // Biometric device turnstile punch
    const bioPayload = JSON.stringify({
      deviceId: 'BIO-GATE-HQ-01',
      records: [
        {
          punchTime: new Date().toISOString(),
          punchType: 'in',
          userIdentifier: `EMP${String((__VU * 100 + __ITER) % 5000 + 1).padStart(5, '0')}`,
          rawRecordId: `rec-${__VU}-${__ITER}-${Date.now()}`,
        },
      ],
    });

    const res = http.post(`${BASE_URL}/api/v1/attendance/biometric/ingest`, bioPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': 'BIO-GATE-HQ-01',
        'X-Signature': 'mock-sig-benchmark-gate2',
        'X-Request-Id': `k6-bio-${__VU}-${__ITER}`,
      },
      tags: { endpoint: 'punch', type: 'write' },
    });

    check(res, {
      'biometric punch status 200, 202, or 401': r => [200, 202, 401].includes(r.status),
    });
  } else {
    // Mobile Geofence Punch
    const mobilePayload = JSON.stringify({
      punchType: 'in',
      eventTs: new Date().toISOString(),
      latitude: 12.971598 + (Math.random() - 0.5) * 0.0002, // Within 15m radius
      longitude: 77.594562 + (Math.random() - 0.5) * 0.0002,
      accuracyMeters: 4.5,
      isMock: false,
      deviceId: `dev-phone-${__VU}`,
      idempotencyKey: `punch-${__VU}-${__ITER}-${Date.now()}`,
      source: 'mobile',
    });

    const res = http.post(`${BASE_URL}/api/v1/attendance/punch`, mobilePayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': `k6-mob-${__VU}-${__ITER}`,
      },
      tags: { endpoint: 'punch', type: 'write' },
    });

    check(res, {
      'mobile punch status 200, 201, or 401': r => [200, 201, 401].includes(r.status),
    });
  }

  sleep(1);
}

/**
 * Simulates managers and HR monitoring real-time attendance boards
 */
export function managerFlow() {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'X-Request-Id': `k6-mgr-${__VU}-${__ITER}`,
  };

  // 1. Fetch Manager Live Presence Board
  const liveRes = http.get(`${BASE_URL}/api/v1/attendance/live?status=in&limit=50`, {
    headers: commonHeaders,
    tags: { endpoint: 'live_board', type: 'read' },
  });
  check(liveRes, {
    'live board query status 200 or 401': r => [200, 401].includes(r.status),
  });

  // 2. Poll HR Exceptions Inbox with keyset pagination
  const excRes = http.get(`${BASE_URL}/api/v1/attendance/exceptions?status=pending&limit=25`, {
    headers: commonHeaders,
    tags: { endpoint: 'exceptions', type: 'read' },
  });
  check(excRes, {
    'exceptions inbox status 200 or 401': r => [200, 401].includes(r.status),
  });

  // 3. Employee Attendance Calendar query
  const todayStr = new Date().toISOString().slice(0, 10);
  const calRes = http.get(`${BASE_URL}/api/v1/attendance/calendar?from=${todayStr}&to=${todayStr}`, {
    headers: commonHeaders,
    tags: { endpoint: 'calendar', type: 'read' },
  });
  check(calRes, {
    'calendar query status 200 or 401': r => [200, 401].includes(r.status),
  });

  sleep(2);
}
