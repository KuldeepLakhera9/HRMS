import { DateTime } from 'luxon';

export const LEAVE_RULE_VERSION = 1;
export const RULE_VERSION = LEAVE_RULE_VERSION;

export interface LeaveEmployeeInput {
  id: string;
  gender?: string | undefined;
  doj: string; // 'YYYY-MM-DD'
  employmentType?: string | undefined;
  locationId?: string | undefined;
  departmentId?: string | undefined;
  timezone?: string | undefined;
}

export interface LeaveTypePolicyInput {
  code: string;
  name: string;
  isPaid: boolean;
  unit: 'day' | 'hour';
  allowHalfDay: boolean;
  allowHourly: boolean;
  requiresDocumentAfterDays?: number | null | undefined;
  maxConsecutiveDays?: number | null | undefined;
  minNoticeDays: number;
  sandwichRule: 'none' | 'holidays' | 'weekly_offs' | 'both';
  allowNegativeBalance: boolean;
  negativeLimit: number;
  applicableTo?: {
    gender?: string[];
    employmentType?: string[];
    minTenureDays?: number;
    locations?: string[];
    departments?: string[];
  } | undefined;
  maxBalance?: number | null | undefined;
  probationRule?: {
    allowDuringProbation?: boolean;
    accrueDuringProbation?: boolean;
  } | undefined;
}

export interface LeaveBalanceInput {
  closing: number;
  pending: number;
  available: number;
}

export interface ExistingLeaveDayInput {
  date: string; // 'YYYY-MM-DD'
  part: 'full' | 'first' | 'second' | 'hours';
  status: 'pending' | 'approved';
}

export interface ComputeLeaveDaysInput {
  employee: LeaveEmployeeInput;
  leaveType: LeaveTypePolicyInput;
  balance: LeaveBalanceInput;
  fromDate: string; // 'YYYY-MM-DD'
  toDate: string; // 'YYYY-MM-DD'
  fromPart?: 'full' | 'first' | 'second' | undefined;
  toPart?: 'full' | 'first' | 'second' | undefined;
  hours?: number | undefined;
  shiftFullDayMinutes?: number | undefined;
  requestSubmissionDate?: string | undefined; // 'YYYY-MM-DD', defaults to today
  documentFileId?: string | null | undefined;
  holidays?: string[] | undefined; // array of 'YYYY-MM-DD'
  weeklyOffRules?: Array<{ day: number; weeks?: number[] }> | undefined; // default Sunday (7)
  baseWeeklyOffDays?: number[] | undefined; // e.g. [7] for Sunday
  existingLeaves?: ExistingLeaveDayInput[] | undefined;
}

export interface LeaveDayItem {
  date: string;
  periodStart: Date;
  periodEnd: Date;
  part: 'full' | 'first' | 'second' | 'hours';
  days: number;
  isPaid: boolean;
  isHoliday: boolean;
  isWeeklyOff: boolean;
  isSandwiched: boolean;
}

export interface ComputeLeaveDaysResult {
  ruleVersion: number;
  days: LeaveDayItem[];
  totalDays: number;
  warnings: string[];
  violations: string[];
  balanceAfter: {
    currentClosing: number;
    currentPending: number;
    currentAvailable: number;
    projectedClosing: number;
    projectedPending: number;
    projectedAvailable: number;
  };
}

/**
 * Checks if a specific date is a weekly off based on rules.
 * Luxon weekday: 1 = Monday, ..., 6 = Saturday, 7 = Sunday.
 */
export function isWeeklyOffDate(
  dt: DateTime,
  weeklyOffRules?: Array<{ day: number; weeks?: number[] }>,
  baseWeeklyOffDays: number[] = [7], // Sunday default
): boolean {
  const weekday = dt.weekday;

  // 1. Base weekly off (e.g. Sunday)
  if (baseWeeklyOffDays.includes(weekday)) {
    return true;
  }

  // 2. Specific weekly off rules (e.g. 2nd and 4th Saturday)
  if (weeklyOffRules && weeklyOffRules.length > 0) {
    const dayOfMonth = dt.day;
    const weekOccurrence = Math.ceil(dayOfMonth / 7);

    for (const rule of weeklyOffRules) {
      if (rule.day === weekday) {
        if (!rule.weeks || rule.weeks.length === 0 || rule.weeks.includes(weekOccurrence)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Pure, deterministic, versioned leave day calculation engine (PHASE3_SPEC Section 5.1).
 */
export function computeLeaveDays(input: ComputeLeaveDaysInput): ComputeLeaveDaysResult {
  const warnings: string[] = [];
  const violations: string[] = [];

  const timezone = input.employee.timezone ?? 'Asia/Kolkata';
  const subDateStr =
    input.requestSubmissionDate ?? DateTime.now().setZone(timezone).toISODate()!;
  const subDate = DateTime.fromISO(subDateStr, { zone: timezone });

  const fromDt = DateTime.fromISO(input.fromDate, { zone: timezone });
  const toDt = DateTime.fromISO(input.toDate, { zone: timezone });

  if (!fromDt.isValid || !toDt.isValid) {
    violations.push('Invalid fromDate or toDate format.');
    return buildEmptyResult(input.balance, violations, warnings);
  }

  if (toDt < fromDt) {
    violations.push('toDate cannot be earlier than fromDate.');
    return buildEmptyResult(input.balance, violations, warnings);
  }

  const fromPart = input.fromPart ?? 'full';
  const toPart = input.toPart ?? 'full';
  const isSingleDay = input.fromDate === input.toDate;

  // 1. Half-day validation
  if (!input.leaveType.allowHalfDay && (fromPart !== 'full' || toPart !== 'full')) {
    violations.push(`Leave type ${input.leaveType.name} does not allow half-day leave.`);
  }

  // 2. Hourly validation
  const shiftMinutes = input.shiftFullDayMinutes ?? 480; // default 8 hours
  if (input.hours !== undefined && input.hours > 0) {
    if (!input.leaveType.allowHourly) {
      violations.push(`Leave type ${input.leaveType.name} does not allow hourly leave.`);
    }
    if (!isSingleDay) {
      violations.push('Hourly leave is only supported for single-day requests.');
    }
  }

  // 3. Notice days check
  const noticeDaysDiff = Math.floor(fromDt.diff(subDate, 'days').days);
  if (noticeDaysDiff < input.leaveType.minNoticeDays) {
    if (noticeDaysDiff < 0) {
      warnings.push(`This leave request is for a past date (${Math.abs(noticeDaysDiff)} days in the past).`);
    } else {
      violations.push(
        `Leave type ${input.leaveType.name} requires at least ${input.leaveType.minNoticeDays} days notice.`,
      );
    }
  }

  // 4. Applicability & Probation Rules
  const emp = input.employee;
  const dojDt = DateTime.fromISO(emp.doj, { zone: timezone });
  const tenureDays = Math.floor(fromDt.diff(dojDt, 'days').days);

  const app = input.leaveType.applicableTo;
  if (app) {
    if (app.gender && app.gender.length > 0 && emp.gender) {
      if (!app.gender.map(g => g.toLowerCase()).includes(emp.gender.toLowerCase())) {
        violations.push(`Leave type ${input.leaveType.name} is not applicable for gender ${emp.gender}.`);
      }
    }
    if (app.employmentType && app.employmentType.length > 0 && emp.employmentType) {
      if (!app.employmentType.map(e => e.toLowerCase()).includes(emp.employmentType.toLowerCase())) {
        violations.push(
          `Leave type ${input.leaveType.name} is not applicable for employment type ${emp.employmentType}.`,
        );
      }
    }
    if (app.minTenureDays && tenureDays < app.minTenureDays) {
      violations.push(
        `Employee tenure (${tenureDays} days) is less than required minimum tenure (${app.minTenureDays} days).`,
      );
    }
  }

  const probationRule = input.leaveType.probationRule;
  const isProbation = tenureDays < 180; // standard 6 months probation window
  if (isProbation && probationRule?.allowDuringProbation === false) {
    violations.push(`Leave type ${input.leaveType.name} is not allowed during the probation period.`);
  }

  // 5. Expand date range day-by-day
  const holidaySet = new Set(input.holidays ?? []);
  const existingDayMap = new Map<string, ExistingLeaveDayInput>();
  for (const ex of input.existingLeaves ?? []) {
    existingDayMap.set(ex.date, ex);
  }

  interface RawDay {
    dt: DateTime;
    dateStr: string;
    isHoliday: boolean;
    isWeeklyOff: boolean;
    isNonWorking: boolean;
  }

  const rawDays: RawDay[] = [];
  let cursor = fromDt;
  while (cursor <= toDt) {
    const dStr = cursor.toISODate()!;
    const isHoliday = holidaySet.has(dStr);
    const isWeeklyOff = isWeeklyOffDate(cursor, input.weeklyOffRules, input.baseWeeklyOffDays);
    rawDays.push({
      dt: cursor,
      dateStr: dStr,
      isHoliday,
      isWeeklyOff,
      isNonWorking: isHoliday || isWeeklyOff,
    });
    cursor = cursor.plus({ days: 1 });
  }

  // 6. Check existing leave overlap
  for (const day of rawDays) {
    const existing = existingDayMap.get(day.dateStr);
    if (existing) {
      violations.push(
        `Requested date ${day.dateStr} overlaps with an existing ${existing.status} leave (${existing.part}).`,
      );
    }
  }

  // 7. Sandwich Rule Processing
  // A non-working day sequence is sandwiched if there is leave immediately before and after it.
  const sandwichRule = input.leaveType.sandwichRule;
  const isSandwichedMap = new Map<string, boolean>();

  if (sandwichRule !== 'none') {
    let i = 0;
    while (i < rawDays.length) {
      if (rawDays[i]!.isNonWorking) {
        const startIndex = i;
        while (i < rawDays.length && rawDays[i]!.isNonWorking) {
          i++;
        }
        const endIndex = i - 1;

        // Check if there is leave before startIndex and after endIndex
        const hasLeaveBefore =
          startIndex > 0 && !rawDays[startIndex - 1]!.isNonWorking;
        const hasLeaveAfter =
          endIndex < rawDays.length - 1 && !rawDays[endIndex + 1]!.isNonWorking;

        if (hasLeaveBefore && hasLeaveAfter) {
          for (let k = startIndex; k <= endIndex; k++) {
            const rd = rawDays[k]!;
            let applySandwich = false;
            if (sandwichRule === 'both') {
              applySandwich = true;
            } else if (sandwichRule === 'holidays' && rd.isHoliday) {
              applySandwich = true;
            } else if (sandwichRule === 'weekly_offs' && rd.isWeeklyOff) {
              applySandwich = true;
            }

            if (applySandwich) {
              isSandwichedMap.set(rd.dateStr, true);
            }
          }
        }
      } else {
        i++;
      }
    }
  }

  // 8. Build final LeaveDayItem list
  const dayItems: LeaveDayItem[] = [];
  let totalDays = 0;

  for (let idx = 0; idx < rawDays.length; idx++) {
    const rd = rawDays[idx]!;
    const isFirst = idx === 0;
    const isLast = idx === rawDays.length - 1;

    let part: 'full' | 'first' | 'second' | 'hours' = 'full';
    let dayCount = 0;

    const isSandwiched = Boolean(isSandwichedMap.get(rd.dateStr));

    if (rd.isNonWorking && !isSandwiched) {
      // Non-working day not sandwiched => 0 days leave count
      dayCount = 0;
      part = 'full';
    } else {
      if (input.hours !== undefined && input.hours > 0 && isSingleDay) {
        part = 'hours';
        dayCount = Math.round((input.hours / (shiftMinutes / 60)) * 1000) / 1000;
      } else if (isSingleDay) {
        if (fromPart === 'first' || fromPart === 'second') {
          part = fromPart;
          dayCount = 0.5;
        } else {
          part = 'full';
          dayCount = 1.0;
        }
      } else if (isFirst) {
        if (fromPart === 'first' || fromPart === 'second') {
          part = fromPart;
          dayCount = 0.5;
        } else {
          part = 'full';
          dayCount = 1.0;
        }
      } else if (isLast) {
        if (toPart === 'first' || toPart === 'second') {
          part = toPart;
          dayCount = 0.5;
        } else {
          part = 'full';
          dayCount = 1.0;
        }
      } else {
        part = 'full';
        dayCount = 1.0;
      }
    }

    // Time boundaries for period tstzrange
    let periodStart: Date;
    let periodEnd: Date;

    if (part === 'first') {
      periodStart = rd.dt.startOf('day').toJSDate();
      periodEnd = rd.dt.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    } else if (part === 'second') {
      periodStart = rd.dt.set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toJSDate();
      periodEnd = rd.dt.plus({ days: 1 }).startOf('day').toJSDate();
    } else if (part === 'hours') {
      const startH = 9;
      periodStart = rd.dt.set({ hour: startH, minute: 0, second: 0, millisecond: 0 }).toJSDate();
      periodEnd = rd.dt.set({ hour: startH + (input.hours ?? 1), minute: 0, second: 0, millisecond: 0 }).toJSDate();
    } else {
      periodStart = rd.dt.startOf('day').toJSDate();
      periodEnd = rd.dt.plus({ days: 1 }).startOf('day').toJSDate();
    }

    totalDays += dayCount;

    dayItems.push({
      date: rd.dateStr,
      periodStart,
      periodEnd,
      part,
      days: dayCount,
      isPaid: input.leaveType.isPaid,
      isHoliday: rd.isHoliday,
      isWeeklyOff: rd.isWeeklyOff,
      isSandwiched,
    });
  }

  totalDays = Math.round(totalDays * 1000) / 1000;

  // 9. Consecutive Days Rule
  if (input.leaveType.maxConsecutiveDays && totalDays > input.leaveType.maxConsecutiveDays) {
    violations.push(
      `Total consecutive leave (${totalDays} days) exceeds maximum allowed (${input.leaveType.maxConsecutiveDays} days).`,
    );
  }

  // 10. Document Required Rule
  if (
    input.leaveType.requiresDocumentAfterDays !== null &&
    input.leaveType.requiresDocumentAfterDays !== undefined &&
    totalDays >= input.leaveType.requiresDocumentAfterDays &&
    !input.documentFileId
  ) {
    violations.push(
      `Supporting document is mandatory for leave requests of ${input.leaveType.requiresDocumentAfterDays} days or more.`,
    );
  }

  // 11. Balance Sufficiency & Projected Balance
  const curClosing = input.balance.closing;
  const curPending = input.balance.pending;
  const curAvailable = input.balance.available;

  const projClosing = curClosing;
  const projPending = Math.round((curPending + totalDays) * 1000) / 1000;
  const projAvailable = Math.round((curAvailable - totalDays) * 1000) / 1000;

  const minAllowedBalance = input.leaveType.allowNegativeBalance
    ? -Math.abs(input.leaveType.negativeLimit)
    : 0;

  if (projAvailable < minAllowedBalance) {
    violations.push(
      `Insufficient leave balance. Available: ${curAvailable}, Requested: ${totalDays}, Minimum allowed: ${minAllowedBalance}.`,
    );
  }

  // Informative warnings for holidays and weekly offs in range
  const holidaysInRange = dayItems.filter(d => d.isHoliday && !d.isSandwiched);
  if (holidaysInRange.length > 0) {
    warnings.push(
      `Leave range contains ${holidaysInRange.length} holiday(s) which are excluded from deduction.`,
    );
  }

  return {
    ruleVersion: RULE_VERSION,
    days: dayItems,
    totalDays,
    warnings,
    violations,
    balanceAfter: {
      currentClosing: curClosing,
      currentPending: curPending,
      currentAvailable: curAvailable,
      projectedClosing: projClosing,
      projectedPending: projPending,
      projectedAvailable: projAvailable,
    },
  };
}

function buildEmptyResult(
  balance: LeaveBalanceInput,
  violations: string[],
  warnings: string[],
): ComputeLeaveDaysResult {
  return {
    ruleVersion: RULE_VERSION,
    days: [],
    totalDays: 0,
    warnings,
    violations,
    balanceAfter: {
      currentClosing: balance.closing,
      currentPending: balance.pending,
      currentAvailable: balance.available,
      projectedClosing: balance.closing,
      projectedPending: balance.pending,
      projectedAvailable: balance.available,
    },
  };
}
