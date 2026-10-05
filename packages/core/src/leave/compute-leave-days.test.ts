import { describe, it, expect } from 'vitest';
import {
  computeLeaveDays,
  isWeeklyOffDate,
  type ComputeLeaveDaysInput,
  type LeaveEmployeeInput,
  type LeaveTypePolicyInput,
  type LeaveBalanceInput,
} from './compute-leave-days.js';
import { DateTime } from 'luxon';

describe('computeLeaveDays Golden Table Test Suite (PHASE3_SPEC Section 5.1 & 15)', () => {
  const baseEmployee: LeaveEmployeeInput = {
    id: 'emp-001',
    gender: 'female',
    doj: '2025-01-01',
    employmentType: 'full_time',
    locationId: 'loc-001',
    departmentId: 'dept-001',
    timezone: 'Asia/Kolkata',
  };

  const baseLeaveType: LeaveTypePolicyInput = {
    code: 'AL',
    name: 'Annual Leave',
    isPaid: true,
    unit: 'day',
    allowHalfDay: true,
    allowHourly: true,
    minNoticeDays: 0,
    sandwichRule: 'none',
    allowNegativeBalance: false,
    negativeLimit: 0,
  };

  const baseBalance: LeaveBalanceInput = {
    closing: 15,
    pending: 0,
    available: 15,
  };

  const sampleWeeklyOffRules = [{ day: 6, weeks: [2, 4] }]; // 2nd and 4th Saturday off

  function createInput(overrides: Partial<ComputeLeaveDaysInput> = {}): ComputeLeaveDaysInput {
    return {
      employee: { ...baseEmployee, ...(overrides.employee || {}) },
      leaveType: { ...baseLeaveType, ...(overrides.leaveType || {}) },
      balance: { ...baseBalance, ...(overrides.balance || {}) },
      fromDate: '2026-06-01', // Monday
      toDate: '2026-06-01',
      requestSubmissionDate: '2026-05-20',
      weeklyOffRules: sampleWeeklyOffRules,
      baseWeeklyOffDays: [7], // Sunday
      ...overrides,
    };
  }

  // 1. Single full day
  it('1. calculates single full day leave', () => {
    const res = computeLeaveDays(createInput({ fromDate: '2026-06-01', toDate: '2026-06-01' }));
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(1.0);
    expect(res.days).toHaveLength(1);
    expect(res.days[0]!.part).toBe('full');
    expect(res.days[0]!.days).toBe(1.0);
    expect(res.balanceAfter.projectedAvailable).toBe(14);
  });

  // 2. Single first half day
  it('2. calculates single first half day leave', () => {
    const res = computeLeaveDays(
      createInput({ fromDate: '2026-06-01', toDate: '2026-06-01', fromPart: 'first' }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(0.5);
    expect(res.days[0]!.part).toBe('first');
    expect(res.days[0]!.days).toBe(0.5);
  });

  // 3. Single second half day
  it('3. calculates single second half day leave', () => {
    const res = computeLeaveDays(
      createInput({ fromDate: '2026-06-01', toDate: '2026-06-01', fromPart: 'second' }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(0.5);
    expect(res.days[0]!.part).toBe('second');
    expect(res.days[0]!.days).toBe(0.5);
  });

  // 4. Single hourly leave (2 hours on 8h shift = 0.25 days)
  it('4. calculates single hourly leave fraction', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-01',
        hours: 2,
        shiftFullDayMinutes: 480,
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(0.25);
    expect(res.days[0]!.part).toBe('hours');
  });

  // 5. Multi-day full days (Mon-Wed = 3 days)
  it('5. calculates multi-day full days range', () => {
    const res = computeLeaveDays(
      createInput({ fromDate: '2026-06-01', toDate: '2026-06-03' }), // Mon-Wed
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(3.0);
    expect(res.days).toHaveLength(3);
    expect(res.days.every(d => d.days === 1.0)).toBe(true);
  });

  // 6. Half day at start only (first day 2nd half + full days = 2.5)
  it('6. calculates half day at start of range', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-03',
        fromPart: 'second',
        toPart: 'full',
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(2.5);
    expect(res.days[0]!.part).toBe('second');
    expect(res.days[0]!.days).toBe(0.5);
    expect(res.days[1]!.days).toBe(1.0);
    expect(res.days[2]!.days).toBe(1.0);
  });

  // 7. Half day at end only (full days + last day 1st half = 2.5)
  it('7. calculates half day at end of range', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-03',
        fromPart: 'full',
        toPart: 'first',
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(2.5);
    expect(res.days[2]!.part).toBe('first');
    expect(res.days[2]!.days).toBe(0.5);
  });

  // 8. Half day at both start and end (start 2nd half + full + end 1st half = 2.0)
  it('8. calculates half day at both start and end of range', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-03',
        fromPart: 'second',
        toPart: 'first',
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(2.0);
    expect(res.days[0]!.days).toBe(0.5);
    expect(res.days[1]!.days).toBe(1.0);
    expect(res.days[2]!.days).toBe(0.5);
  });

  // 9. Half day disallowed by policy
  it('9. blocks half day if policy disables half days', () => {
    const res = computeLeaveDays(
      createInput({
        leaveType: { ...baseLeaveType, allowHalfDay: false },
        fromDate: '2026-06-01',
        toDate: '2026-06-01',
        fromPart: 'first',
      }),
    );
    expect(res.violations.some(v => v.includes('does not allow half-day'))).toBe(true);
  });

  // 10. Hourly leave disallowed by policy
  it('10. blocks hourly leave if policy disables hourly', () => {
    const res = computeLeaveDays(
      createInput({
        leaveType: { ...baseLeaveType, allowHourly: false },
        fromDate: '2026-06-01',
        toDate: '2026-06-01',
        hours: 2,
      }),
    );
    expect(res.violations.some(v => v.includes('does not allow hourly'))).toBe(true);
  });

  // 11. Hourly leave across multi-day range rejected
  it('11. blocks hourly leave across multi-day range', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-02',
        hours: 3,
      }),
    );
    expect(res.violations.some(v => v.includes('only supported for single-day'))).toBe(true);
  });

  // 12. Holiday inside range, sandwich rule = 'none' (holiday not deducted)
  it('12. excludes holiday from deduction when sandwich rule is none', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01', // Mon
        toDate: '2026-06-03', // Wed
        holidays: ['2026-06-02'], // Tue is holiday
        leaveType: { ...baseLeaveType, sandwichRule: 'none' },
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(2.0); // Mon + Wed
    expect(res.days[1]!.isHoliday).toBe(true);
    expect(res.days[1]!.days).toBe(0);
    expect(res.warnings.some(w => w.includes('1 holiday'))).toBe(true);
  });

  // 13. Weekly off (Sunday) inside range, sandwich rule = 'none' (Sunday not deducted)
  it('13. excludes weekly off from deduction when sandwich rule is none', () => {
    // 2026-06-05 (Fri) to 2026-06-08 (Mon)
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-05',
        toDate: '2026-06-08',
        leaveType: { ...baseLeaveType, sandwichRule: 'none' },
      }),
    );
    // Sat June 6 is 1st Saturday (working), Sun June 7 is Sunday (weekly off)
    // Fri (1) + Sat (1) + Sun (0) + Mon (1) = 3 days
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(3.0);
    const sun = res.days.find(d => d.date === '2026-06-07');
    expect(sun?.isWeeklyOff).toBe(true);
    expect(sun?.days).toBe(0);
  });

  // 14. Holiday inside range, sandwich rule = 'holidays' (holiday IS counted)
  it('14. deducts holiday as leave when sandwiched and rule is holidays', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01', // Mon (leave)
        toDate: '2026-06-03', // Wed (leave)
        holidays: ['2026-06-02'], // Tue is holiday
        leaveType: { ...baseLeaveType, sandwichRule: 'holidays' },
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(3.0);
    expect(res.days[1]!.isHoliday).toBe(true);
    expect(res.days[1]!.isSandwiched).toBe(true);
    expect(res.days[1]!.days).toBe(1.0);
  });

  // 15. Sunday inside range, sandwich rule = 'weekly_offs' (Sunday IS counted)
  it('15. deducts weekly off as leave when sandwiched and rule is weekly_offs', () => {
    // 2026-06-06 (Sat - working) to 2026-06-08 (Mon)
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-06',
        toDate: '2026-06-08',
        leaveType: { ...baseLeaveType, sandwichRule: 'weekly_offs' },
      }),
    );
    // Sat (1) + Sun (sandwiched WO = 1) + Mon (1) = 3 days
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(3.0);
    const sun = res.days.find(d => d.date === '2026-06-07');
    expect(sun?.isSandwiched).toBe(true);
    expect(sun?.days).toBe(1.0);
  });

  // 16. Both holiday and weekly off inside range, sandwich rule = 'both'
  it('16. deducts both holidays and weekly offs when sandwich rule is both', () => {
    // 2026-06-05 (Fri) to 2026-06-09 (Tue)
    // Sat June 6 (working), Sun June 7 (WO), Mon June 8 (Holiday), Tue June 9 (Working)
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-05',
        toDate: '2026-06-09',
        holidays: ['2026-06-08'],
        leaveType: { ...baseLeaveType, sandwichRule: 'both' },
      }),
    );
    // Fri (1) + Sat (1) + Sun (WO sandwiched=1) + Mon (Hol sandwiched=1) + Tue (1) = 5 days
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(5.0);
    const sun = res.days.find(d => d.date === '2026-06-07');
    const mon = res.days.find(d => d.date === '2026-06-08');
    expect(sun?.isSandwiched).toBe(true);
    expect(mon?.isSandwiched).toBe(true);
  });

  // 17. Alternate Saturday: 2nd Saturday is off
  it('17. detects 2nd Saturday as weekly off', () => {
    // June 2026: 1st Sat = June 6, 2nd Sat = June 13
    const dt = DateTime.fromISO('2026-06-13', { zone: 'Asia/Kolkata' });
    expect(isWeeklyOffDate(dt, sampleWeeklyOffRules, [7])).toBe(true);
  });

  // 18. Alternate Saturday: 4th Saturday is off
  it('18. detects 4th Saturday as weekly off', () => {
    // June 2026: 4th Sat = June 27
    const dt = DateTime.fromISO('2026-06-27', { zone: 'Asia/Kolkata' });
    expect(isWeeklyOffDate(dt, sampleWeeklyOffRules, [7])).toBe(true);
  });

  // 19. Working Saturday: 1st Saturday is working
  it('19. detects 1st Saturday as working day', () => {
    // June 2026: 1st Sat = June 6
    const dt = DateTime.fromISO('2026-06-06', { zone: 'Asia/Kolkata' });
    expect(isWeeklyOffDate(dt, sampleWeeklyOffRules, [7])).toBe(false);
  });

  // 20. Working Saturday: 3rd Saturday is working
  it('20. detects 3rd Saturday as working day', () => {
    // June 2026: 3rd Sat = June 20
    const dt = DateTime.fromISO('2026-06-20', { zone: 'Asia/Kolkata' });
    expect(isWeeklyOffDate(dt, sampleWeeklyOffRules, [7])).toBe(false);
  });

  // 21. Working Saturday: 5th Saturday is working
  it('21. detects 5th Saturday (in months with 5 Saturdays) as working day', () => {
    // August 2026: 5th Sat = August 29
    const dt = DateTime.fromISO('2026-08-29', { zone: 'Asia/Kolkata' });
    expect(isWeeklyOffDate(dt, sampleWeeklyOffRules, [7])).toBe(false);
  });

  // 22. 2nd Saturday in leave range without sandwich rule is excluded
  it('22. excludes 2nd Saturday weekly off when sandwich is none', () => {
    // 2026-06-12 (Fri) to 2026-06-15 (Mon)
    // Fri (1), Sat June 13 (2nd Sat WO = 0), Sun June 14 (Sun WO = 0), Mon (1) => 2 days
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-12',
        toDate: '2026-06-15',
        leaveType: { ...baseLeaveType, sandwichRule: 'none' },
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(2.0);
    const sat = res.days.find(d => d.date === '2026-06-13');
    expect(sat?.isWeeklyOff).toBe(true);
    expect(sat?.days).toBe(0);
  });

  // 23. 2nd Saturday + Sunday in leave range with sandwich 'both' are counted
  it('23. counts 2nd Saturday and Sunday when sandwiched with rule both', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-12', // Fri
        toDate: '2026-06-15', // Mon
        leaveType: { ...baseLeaveType, sandwichRule: 'both' },
      }),
    );
    // Fri (1) + Sat (WO=1) + Sun (WO=1) + Mon (1) = 4 days
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(4.0);
    const sat = res.days.find(d => d.date === '2026-06-13');
    const sun = res.days.find(d => d.date === '2026-06-14');
    expect(sat?.isSandwiched).toBe(true);
    expect(sun?.isSandwiched).toBe(true);
  });

  // 24. Non-sandwiched holiday (holiday on first day of range)
  it('24. does not sandwich holiday when leave is only on one side (start of range)', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01', // Mon (holiday)
        toDate: '2026-06-03', // Wed
        holidays: ['2026-06-01'],
        leaveType: { ...baseLeaveType, sandwichRule: 'both' },
      }),
    );
    // Mon is holiday at start of range -> no preceding leave in range -> not sandwiched
    expect(res.totalDays).toBe(2.0); // Tue + Wed
    expect(res.days[0]!.days).toBe(0);
    expect(res.days[0]!.isSandwiched).toBe(false);
  });

  // 25. Non-sandwiched holiday (holiday on last day of range)
  it('25. does not sandwich holiday when leave is only on one side (end of range)', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01', // Mon
        toDate: '2026-06-03', // Wed (holiday)
        holidays: ['2026-06-03'],
        leaveType: { ...baseLeaveType, sandwichRule: 'both' },
      }),
    );
    expect(res.totalDays).toBe(2.0); // Mon + Tue
    expect(res.days[2]!.days).toBe(0);
    expect(res.days[2]!.isSandwiched).toBe(false);
  });

  // 26. Notice days requirement satisfied
  it('26. accepts request when notice days requirement is met', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-10',
        toDate: '2026-06-10',
        requestSubmissionDate: '2026-06-05', // 5 days notice
        leaveType: { ...baseLeaveType, minNoticeDays: 3 },
      }),
    );
    expect(res.violations).toHaveLength(0);
  });

  // 27. Notice days requirement violated
  it('27. rejects request when notice days requirement is violated', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-06',
        toDate: '2026-06-06',
        requestSubmissionDate: '2026-06-05', // 1 day notice
        leaveType: { ...baseLeaveType, minNoticeDays: 3 },
      }),
    );
    expect(res.violations.some(v => v.includes('requires at least 3 days notice'))).toBe(true);
  });

  // 28. Past date application emits warning
  it('28. produces warning when applying for past dates', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-05-10',
        toDate: '2026-05-10',
        requestSubmissionDate: '2026-05-20', // applied 10 days later
      }),
    );
    expect(res.warnings.some(w => w.includes('past date'))).toBe(true);
  });

  // 29. Max consecutive days satisfied
  it('29. allows leave within max consecutive days limit', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-04', // 4 days
        leaveType: { ...baseLeaveType, maxConsecutiveDays: 5 },
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(4.0);
  });

  // 30. Max consecutive days exceeded
  it('30. blocks leave exceeding max consecutive days limit', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-06', // 6 days
        leaveType: { ...baseLeaveType, maxConsecutiveDays: 5 },
      }),
    );
    expect(res.violations.some(v => v.includes('exceeds maximum allowed'))).toBe(true);
  });

  // 31. Document required threshold: under threshold, no document needed
  it('31. does not require document for short leave under threshold', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-02', // 2 days
        documentFileId: null,
        leaveType: { ...baseLeaveType, requiresDocumentAfterDays: 3 },
      }),
    );
    expect(res.violations).toHaveLength(0);
  });

  // 32. Document required threshold: over threshold with document
  it('32. accepts leave meeting document requirement with documentFileId provided', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-04', // 4 days
        documentFileId: '01a10a60-e697-716e-8f7a-b260664de3bf',
        leaveType: { ...baseLeaveType, requiresDocumentAfterDays: 3 },
      }),
    );
    expect(res.violations).toHaveLength(0);
  });

  // 33. Document required threshold: over threshold without document
  it('33. blocks leave over threshold when documentFileId is missing', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-04', // 4 days
        documentFileId: null,
        leaveType: { ...baseLeaveType, requiresDocumentAfterDays: 3 },
      }),
    );
    expect(res.violations.some(v => v.includes('Supporting document is mandatory'))).toBe(true);
  });

  // 34. Probation rule: probation not allowed, employee under probation
  it('34. blocks leave during probation when policy prohibits probation leave', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, doj: '2026-05-01' }, // joined 1 month ago
        fromDate: '2026-06-01',
        toDate: '2026-06-01',
        leaveType: {
          ...baseLeaveType,
          probationRule: { allowDuringProbation: false },
        },
      }),
    );
    expect(res.violations.some(v => v.includes('not allowed during the probation'))).toBe(true);
  });

  // 35. Probation rule: probation allowed
  it('35. allows leave during probation when policy permits it', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, doj: '2026-05-01' },
        fromDate: '2026-06-01',
        toDate: '2026-06-01',
        leaveType: {
          ...baseLeaveType,
          probationRule: { allowDuringProbation: true },
        },
      }),
    );
    expect(res.violations).toHaveLength(0);
  });

  // 36. Gender restriction: matching gender
  it('36. allows leave when employee gender matches applicability', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, gender: 'female' },
        leaveType: {
          ...baseLeaveType,
          applicableTo: { gender: ['female'] },
        },
      }),
    );
    expect(res.violations).toHaveLength(0);
  });

  // 37. Gender restriction: mismatching gender
  it('37. blocks leave when employee gender does not match applicability', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, gender: 'male' },
        leaveType: {
          ...baseLeaveType,
          applicableTo: { gender: ['female'] },
        },
      }),
    );
    expect(res.violations.some(v => v.includes('not applicable for gender male'))).toBe(true);
  });

  // 38. Employment type restriction matching
  it('38. allows leave when employment type matches', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, employmentType: 'full_time' },
        leaveType: {
          ...baseLeaveType,
          applicableTo: { employmentType: ['full_time', 'probation'] },
        },
      }),
    );
    expect(res.violations).toHaveLength(0);
  });

  // 39. Employment type restriction mismatching
  it('39. blocks leave when employment type does not match', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, employmentType: 'contractor' },
        leaveType: {
          ...baseLeaveType,
          applicableTo: { employmentType: ['full_time'] },
        },
      }),
    );
    expect(res.violations.some(v => v.includes('not applicable for employment type contractor'))).toBe(true);
  });

  // 40. Minimum tenure requirement satisfied
  it('40. allows leave when employee tenure meets minimum requirement', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, doj: '2025-01-01' }, // > 365 days
        leaveType: {
          ...baseLeaveType,
          applicableTo: { minTenureDays: 180 },
        },
      }),
    );
    expect(res.violations).toHaveLength(0);
  });

  // 41. Minimum tenure requirement violated
  it('41. blocks leave when employee tenure is below requirement', () => {
    const res = computeLeaveDays(
      createInput({
        employee: { ...baseEmployee, doj: '2026-05-15' }, // 17 days
        fromDate: '2026-06-01',
        toDate: '2026-06-01',
        leaveType: {
          ...baseLeaveType,
          applicableTo: { minTenureDays: 90 },
        },
      }),
    );
    expect(res.violations.some(v => v.includes('less than required minimum tenure'))).toBe(true);
  });

  // 42. Sufficient balance calculation
  it('42. verifies balance after calculation with sufficient balance', () => {
    const res = computeLeaveDays(
      createInput({
        balance: { closing: 10, pending: 2, available: 8 },
        fromDate: '2026-06-01',
        toDate: '2026-06-03', // 3 days
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.balanceAfter.currentAvailable).toBe(8);
    expect(res.balanceAfter.projectedPending).toBe(5);
    expect(res.balanceAfter.projectedAvailable).toBe(5);
  });

  // 43. Insufficient balance without negative limit
  it('43. blocks leave when requested days exceed available balance', () => {
    const res = computeLeaveDays(
      createInput({
        balance: { closing: 2, pending: 0, available: 2 },
        fromDate: '2026-06-01',
        toDate: '2026-06-03', // 3 days
        leaveType: { ...baseLeaveType, allowNegativeBalance: false },
      }),
    );
    expect(res.violations.some(v => v.includes('Insufficient leave balance'))).toBe(true);
  });

  // 44. Negative balance allowed within limit
  it('44. allows leave when balance goes negative within allowed negative limit', () => {
    const res = computeLeaveDays(
      createInput({
        balance: { closing: 0, pending: 0, available: 0 },
        fromDate: '2026-06-01',
        toDate: '2026-06-02', // 2 days
        leaveType: {
          ...baseLeaveType,
          allowNegativeBalance: true,
          negativeLimit: 3,
        },
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.balanceAfter.projectedAvailable).toBe(-2);
  });

  // 45. Negative balance exceeding negative limit
  it('45. blocks leave when requested days exceed allowed negative limit', () => {
    const res = computeLeaveDays(
      createInput({
        balance: { closing: 0, pending: 0, available: 0 },
        fromDate: '2026-06-01',
        toDate: '2026-06-03', // 3 days
        leaveType: {
          ...baseLeaveType,
          allowNegativeBalance: true,
          negativeLimit: 2, // limit is 2, requested 3
        },
      }),
    );
    expect(res.violations.some(v => v.includes('Insufficient leave balance'))).toBe(true);
  });

  // 46. Overlap with existing pending leave
  it('46. blocks request overlapping with existing pending leave', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-03',
        existingLeaves: [
          { date: '2026-06-02', part: 'full', status: 'pending' },
        ],
      }),
    );
    expect(res.violations.some(v => v.includes('overlaps with an existing pending leave'))).toBe(true);
  });

  // 47. Overlap with existing approved leave
  it('47. blocks request overlapping with existing approved leave', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-01',
        toDate: '2026-06-03',
        existingLeaves: [
          { date: '2026-06-01', part: 'second', status: 'approved' },
        ],
      }),
    );
    expect(res.violations.some(v => v.includes('overlaps with an existing approved leave'))).toBe(true);
  });

  // 48. Adjacent non-overlapping leave allowed
  it('48. allows leave immediately adjacent to existing leave without overlap', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-04',
        toDate: '2026-06-05',
        existingLeaves: [
          { date: '2026-06-03', part: 'full', status: 'approved' },
        ],
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(2.0);
  });

  // 49. Unpaid leave type marks days as unpaid
  it('49. preserves isPaid = false on unpaid leave days', () => {
    const res = computeLeaveDays(
      createInput({
        leaveType: { ...baseLeaveType, isPaid: false },
        fromDate: '2026-06-01',
        toDate: '2026-06-02',
      }),
    );
    expect(res.violations).toHaveLength(0);
    expect(res.days.every(d => d.isPaid === false)).toBe(true);
  });

  // 50. Year boundary transition (Dec 31 to Jan 2)
  it('50. correctly calculates multi-day leave spanning year boundary', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-12-31', // Thu
        toDate: '2027-01-02', // Sat (1st Sat = working)
        balance: { closing: 10, pending: 0, available: 10 },
      }),
    );
    // 2026-12-31 (1), 2027-01-01 (1), 2027-01-02 (Sat 1st = 1) => 3 days
    expect(res.violations).toHaveLength(0);
    expect(res.totalDays).toBe(3.0);
    expect(res.days).toHaveLength(3);
  });

  // 51. Invalid date range (toDate < fromDate)
  it('51. blocks request where toDate is earlier than fromDate', () => {
    const res = computeLeaveDays(
      createInput({
        fromDate: '2026-06-05',
        toDate: '2026-06-01',
      }),
    );
    expect(res.violations.some(v => v.includes('toDate cannot be earlier than fromDate'))).toBe(true);
  });

  // 52. Deterministic ruleVersion assertion
  it('52. returns deterministic RULE_VERSION = 1', () => {
    const res = computeLeaveDays(createInput());
    expect(res.ruleVersion).toBe(1);
  });
});
