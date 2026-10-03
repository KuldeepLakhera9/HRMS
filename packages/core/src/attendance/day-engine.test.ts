import { describe, it, expect } from 'vitest';
import { computeDay, RULE_VERSION, type DayContext } from './day-engine.js';
import type { EffectivePunchRecord } from './punch-repository.js';
import type { ShiftRecord } from './shift-repository.js';
import type { AttendancePolicyRecord } from './repository.js';

describe('P2-DAY-01 & P2-QA-01: Attendance Day Engine Golden Table Suite (>= 25 Cases)', () => {
  const defaultPolicy: AttendancePolicyRecord = {
    id: 'pol-1',
    companyId: 'comp-1',
    code: 'DEF',
    name: 'Default Policy',
    description: null,
    geofenceMode: 'strict',
    allowSelfie: true,
    requireSelfie: false,
    maxGpsAccuracyMeters: 50,
    allowedSources: ['web', 'mobile'],
    graceMinutes: 15,
    halfDayMinutes: 240,
    fullDayMinutes: 480,
    autoPunchOutHours: '12.0',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const generalShift: ShiftRecord = {
    id: 'shift-gen',
    companyId: 'comp-1',
    code: 'GEN',
    name: 'General Shift',
    startTime: '09:00:00',
    endTime: '18:00:00',
    crossesMidnight: false,
    graceMinutes: 15,
    breakMinutes: 60,
    workHours: '8.00',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const nightShift: ShiftRecord = {
    id: 'shift-night',
    companyId: 'comp-1',
    code: 'NIGHT',
    name: 'Night Shift',
    startTime: '22:00:00',
    endTime: '06:00:00',
    crossesMidnight: true,
    graceMinutes: 15,
    breakMinutes: 60,
    workHours: '8.00',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseContext: DayContext = {
    isWeeklyOff: false,
    isHoliday: false,
    isApprovedOD: false,
    isApprovedWFH: false,
  };

  function createPunch(
    id: string,
    timeIso: string,
    type: 'in' | 'out' | 'auto_out',
    status: 'valid' | 'soft_pending' | 'rejected' = 'valid',
  ): EffectivePunchRecord {
    return {
      id,
      companyId: 'comp-1',
      employeeId: 'emp-1',
      punchTime: new Date(timeIso),
      punchType: type,
      source: 'web',
      workDate: timeIso.slice(0, 10),
      shiftId: 'shift-gen',
      locationId: 'loc-1',
      latitude: 12.9716,
      longitude: 77.5946,
      gpsAccuracy: 10,
      isInsideGeofence: true,
      distanceMeters: 5,
      selfieFileId: null,
      deviceId: null,
      deviceModel: null,
      isMockLocation: false,
      status,
      reasonCode: 'PUNCH_SUCCESS',
      flagReasons: [],
      idempotencyKey: id,
      createdAt: new Date(timeIso),
      effectiveStatus: status,
      reviewId: null,
      workflowRequestId: null,
      reviewerId: null,
      reviewComments: null,
      reviewedAt: null,
    };
  }

  // --- Case 01: Standard full day on time ---
  it('Case 01: Standard full day on time -> present, 0 late, 0 early, 0 overtime', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T18:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('present');
    expect(res.totalWorkMinutes).toBe(540);
    expect(res.effectiveMinutes).toBe(540);
    expect(res.lateInMinutes).toBe(0);
    expect(res.earlyOutMinutes).toBe(0);
    expect(res.ruleVersion).toBe(RULE_VERSION);
  });

  // --- Case 02: Standard full day with grace late ---
  it('Case 02: In within grace period (09:10) -> present, 0 late in', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:10:00Z', 'in'),
      createPunch('p2', '2026-10-03T18:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('present');
    expect(res.lateInMinutes).toBe(0);
  });

  // --- Case 03: Late in beyond grace ---
  it('Case 03: Late in beyond grace (09:25) -> present, 25m late in', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:25:00Z', 'in'),
      createPunch('p2', '2026-10-03T18:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('present');
    expect(res.lateInMinutes).toBe(25);
    expect(res.flags).toContain('LATE_IN');
  });

  // --- Case 04: Early out within grace ---
  it('Case 04: Early out within grace (17:50 on 18:00 shift) -> present, 0 early out', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T17:50:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('present');
    expect(res.earlyOutMinutes).toBe(0);
  });

  // --- Case 05: Early out beyond grace ---
  it('Case 05: Early out beyond grace (17:30 on 18:00 shift) -> present, 30m early out', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T17:30:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('present');
    expect(res.earlyOutMinutes).toBe(30);
    expect(res.flags).toContain('EARLY_OUT');
  });

  // --- Case 06: Both late in and early out ---
  it('Case 06: Both late in and early out -> present, tracks both penalties', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:30:00Z', 'in'),
      createPunch('p2', '2026-10-03T17:30:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('present');
    expect(res.lateInMinutes).toBe(30);
    expect(res.earlyOutMinutes).toBe(30);
  });

  // --- Case 07: Exact half day hours worked ---
  it('Case 07: Exactly 240 minutes worked -> half_day', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T13:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(240);
    expect(res.status).toBe('half_day');
  });

  // --- Case 08: Between half day and full day ---
  it('Case 08: 360 minutes worked (between 240 and 480) -> half_day', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T15:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(360);
    expect(res.status).toBe('half_day');
  });

  // --- Case 09: Less than half day hours worked ---
  it('Case 09: 180 minutes worked (< 240) -> absent', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T12:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(180);
    expect(res.status).toBe('absent');
  });

  // --- Case 10: Multiple punch pairs (split shift) ---
  it('Case 10: Multiple punch pairs (split shift: morning + afternoon) -> present', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T13:00:00Z', 'out'),
      createPunch('p3', '2026-10-03T14:00:00Z', 'in'),
      createPunch('p4', '2026-10-03T18:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(480);
    expect(res.status).toBe('present');
    expect(res.punchCount).toBe(4);
  });

  // --- Case 11: Three punch pairs (short break) ---
  it('Case 11: Three punch pairs summed accurately', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T12:00:00Z', 'out'), // 180m
      createPunch('p3', '2026-10-03T12:30:00Z', 'in'),
      createPunch('p4', '2026-10-03T15:30:00Z', 'out'), // 180m
      createPunch('p5', '2026-10-03T16:00:00Z', 'in'),
      createPunch('p6', '2026-10-03T18:00:00Z', 'out'), // 120m
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(480);
    expect(res.status).toBe('present');
  });

  // --- Case 12: Single punch (no out) ---
  it('Case 12: Single punch without out -> missing_punch', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('missing_punch');
    expect(res.totalWorkMinutes).toBe(0);
    expect(res.flags).toContain('MISSING_PUNCH');
  });

  // --- Case 13: Odd punch count (3 punches) ---
  it('Case 13: Odd punch count -> missing_punch flag with partial minutes', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T13:00:00Z', 'out'),
      createPunch('p3', '2026-10-03T14:00:00Z', 'in'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(240);
    expect(res.flags).toContain('MISSING_PUNCH');
  });

  // --- Case 14: Night shift crossing midnight ---
  it('Case 14: Night shift crossing midnight (22:00 to 06:00) -> 480m, present', () => {
    const punches = [
      createPunch('p1', '2026-10-03T22:00:00Z', 'in'),
      createPunch('p2', '2026-10-04T06:00:00Z', 'out'),
    ];
    const res = computeDay(punches, nightShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(480);
    expect(res.status).toBe('present');
    expect(res.lateInMinutes).toBe(0);
    expect(res.earlyOutMinutes).toBe(0);
  });

  // --- Case 15: Night shift late in ---
  it('Case 15: Night shift late in (22:30 on 22:00 shift) -> late 30m', () => {
    const punches = [
      createPunch('p1', '2026-10-03T22:30:00Z', 'in'),
      createPunch('p2', '2026-10-04T06:00:00Z', 'out'),
    ];
    const res = computeDay(punches, nightShift, defaultPolicy, baseContext);

    expect(res.lateInMinutes).toBe(30);
    expect(res.flags).toContain('LATE_IN');
  });

  // --- Case 16: Night shift early out ---
  it('Case 16: Night shift early out (05:00 on 06:00 shift) -> early 60m', () => {
    const punches = [
      createPunch('p1', '2026-10-03T22:00:00Z', 'in'),
      createPunch('p2', '2026-10-04T05:00:00Z', 'out'),
    ];
    const res = computeDay(punches, nightShift, defaultPolicy, baseContext);

    expect(res.earlyOutMinutes).toBe(60);
    expect(res.flags).toContain('EARLY_OUT');
  });

  // --- Case 17: Weekly off with zero punches ---
  it('Case 17: Weekly off with no punches -> weekly_off', () => {
    const res = computeDay([], generalShift, defaultPolicy, {
      ...baseContext,
      isWeeklyOff: true,
    });

    expect(res.status).toBe('weekly_off');
    expect(res.effectiveMinutes).toBe(0);
    expect(res.flags).toContain('WEEKLY_OFF');
  });

  // --- Case 18: Weekly off with punches -> overtime ---
  it('Case 18: Weekly off with punches -> present and full overtime', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T17:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, {
      ...baseContext,
      isWeeklyOff: true,
    });

    expect(res.status).toBe('present');
    expect(res.totalWorkMinutes).toBe(480);
    expect(res.overtimeMinutes).toBe(480);
    expect(res.flags).toContain('WORKED_WEEKLY_OFF');
  });

  // --- Case 19: Holiday with zero punches ---
  it('Case 19: Holiday with no punches -> holiday', () => {
    const res = computeDay([], generalShift, defaultPolicy, {
      ...baseContext,
      isHoliday: true,
    });

    expect(res.status).toBe('holiday');
    expect(res.effectiveMinutes).toBe(0);
    expect(res.flags).toContain('HOLIDAY');
  });

  // --- Case 20: Holiday with punches -> overtime ---
  it('Case 20: Holiday with punches -> present and full overtime', () => {
    const punches = [
      createPunch('p1', '2026-10-03T10:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T15:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, {
      ...baseContext,
      isHoliday: true,
    });

    expect(res.status).toBe('half_day');
    expect(res.totalWorkMinutes).toBe(300);
    expect(res.overtimeMinutes).toBe(300);
    expect(res.flags).toContain('WORKED_HOLIDAY');
  });

  // --- Case 21: Approved On-Duty (OD) with zero punches ---
  it('Case 21: Approved On-Duty (OD) with zero punches -> present, full day credit', () => {
    const res = computeDay([], generalShift, defaultPolicy, {
      ...baseContext,
      isApprovedOD: true,
    });

    expect(res.status).toBe('present');
    expect(res.effectiveMinutes).toBe(defaultPolicy.fullDayMinutes);
    expect(res.flags).toContain('APPROVED_OD');
  });

  // --- Case 22: Approved Work-From-Home (WFH) with zero punches ---
  it('Case 22: Approved WFH with zero punches -> present, full day credit', () => {
    const res = computeDay([], generalShift, defaultPolicy, {
      ...baseContext,
      isApprovedWFH: true,
    });

    expect(res.status).toBe('present');
    expect(res.effectiveMinutes).toBe(defaultPolicy.fullDayMinutes);
    expect(res.flags).toContain('APPROVED_WFH');
  });

  // --- Case 23: Approved OD with partial punches ---
  it('Case 23: Approved OD with partial 2h punches -> present, credited full day', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T11:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, {
      ...baseContext,
      isApprovedOD: true,
    });

    expect(res.status).toBe('present');
    expect(res.totalWorkMinutes).toBe(120);
    expect(res.effectiveMinutes).toBe(defaultPolicy.fullDayMinutes);
  });

  // --- Case 24: Overtime on normal working day ---
  it('Case 24: Worked 10 hours on 8h shift -> 120m overtime', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T19:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(600);
    expect(res.overtimeMinutes).toBe(120);
    expect(res.flags).toContain('OVERTIME');
  });

  // --- Case 25: Absent on working day with no punches ---
  it('Case 25: Working day with no punches and no OD/WFH -> absent', () => {
    const res = computeDay([], generalShift, defaultPolicy, baseContext);

    expect(res.status).toBe('absent');
    expect(res.effectiveMinutes).toBe(0);
    expect(res.flags).toContain('NO_PUNCHES');
  });

  // --- Case 26: Auto punch-out handled ---
  it('Case 26: Synthetic auto punch-out handled and flagged', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T21:00:00Z', 'auto_out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.flags).toContain('AUTO_PUNCH_OUT');
    expect(res.totalWorkMinutes).toBe(720);
  });

  // --- Case 27: Rejected punches excluded ---
  it('Case 27: Rejected punches are excluded from worked minutes', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2_bad', '2026-10-03T12:00:00Z', 'out', 'rejected'),
      createPunch('p3', '2026-10-03T18:00:00Z', 'out'),
    ];
    const res = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res.totalWorkMinutes).toBe(540);
    expect(res.status).toBe('present');
  });

  // --- Case 28: Source hash determinism & idempotency ---
  it('Case 28: Deterministic source_hash idempotency across multiple runs', () => {
    const punches = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T18:00:00Z', 'out'),
    ];
    const res1 = computeDay(punches, generalShift, defaultPolicy, baseContext);
    const res2 = computeDay(punches, generalShift, defaultPolicy, baseContext);

    expect(res1.sourceHash).toBeDefined();
    expect(res1.sourceHash).toBe(res2.sourceHash);
  });

  // --- Case 29: Source hash sensitivity to punch changes ---
  it('Case 29: Modifying a punch timestamp changes the source_hash', () => {
    const punches1 = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T18:00:00Z', 'out'),
    ];
    const punches2 = [
      createPunch('p1', '2026-10-03T09:00:00Z', 'in'),
      createPunch('p2', '2026-10-03T18:05:00Z', 'out'),
    ];
    const res1 = computeDay(punches1, generalShift, defaultPolicy, baseContext);
    const res2 = computeDay(punches2, generalShift, defaultPolicy, baseContext);

    expect(res1.sourceHash).not.toBe(res2.sourceHash);
  });
});
