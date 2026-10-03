import crypto from 'node:crypto';
import type { EffectivePunchRecord } from './punch-repository.js';
import type { ShiftRecord } from './shift-repository.js';
import type { AttendancePolicyRecord } from './repository.js';

export const RULE_VERSION = 1;

export interface DayContext {
  isWeeklyOff: boolean;
  isHoliday: boolean;
  isApprovedOD: boolean;
  isApprovedWFH: boolean;
}

export type DayStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'on_leave'
  | 'holiday'
  | 'weekly_off'
  | 'missing_punch';

export interface DayCalculationResult {
  firstIn: Date | null;
  lastOut: Date | null;
  punchCount: number;
  totalWorkMinutes: number;
  effectiveMinutes: number;
  lateInMinutes: number;
  earlyOutMinutes: number;
  overtimeMinutes: number;
  status: DayStatus;
  ruleVersion: number;
  sourceHash: string;
  flags: string[];
}

/**
 * Parses "HH:mm:ss" or "HH:mm" time string into minutes from 00:00.
 */
function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(p => parseInt(p, 10));
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  return hours * 60 + minutes;
}

/**
 * Computes difference in minutes between two timestamps.
 */
function diffMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

/**
 * Generates deterministic SHA-256 source hash from calculation inputs.
 */
function computeSourceHash(
  punches: EffectivePunchRecord[],
  shiftId: string | null,
  context: DayContext,
): string {
  const sorted = [...punches].sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
  const punchSignatures = sorted
    .map(p => `${p.id}:${p.punchType}:${p.punchTime.toISOString()}`)
    .join(';');

  const raw = [
    `v=${RULE_VERSION}`,
    `shift=${shiftId ?? 'none'}`,
    `wo=${context.isWeeklyOff}`,
    `hol=${context.isHoliday}`,
    `od=${context.isApprovedOD}`,
    `wfh=${context.isApprovedWFH}`,
    `punches=[${punchSignatures}]`,
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Pure Attendance Day Calculation Engine (P2-DAY-01)
 * Follows specification rules for punch pairing, grace period, night shifts, and status categorization.
 */
export function computeDay(
  punches: EffectivePunchRecord[],
  shift: ShiftRecord | null,
  policy: AttendancePolicyRecord,
  context: DayContext,
): DayCalculationResult {
  const flags: string[] = [];
  const sourceHash = computeSourceHash(punches, shift?.id ?? null, context);

  // 1. Handle No-Punch Scenarios
  if (!punches || punches.length === 0) {
    if (context.isHoliday) {
      return {
        firstIn: null,
        lastOut: null,
        punchCount: 0,
        totalWorkMinutes: 0,
        effectiveMinutes: 0,
        lateInMinutes: 0,
        earlyOutMinutes: 0,
        overtimeMinutes: 0,
        status: 'holiday',
        ruleVersion: RULE_VERSION,
        sourceHash,
        flags: ['HOLIDAY'],
      };
    }

    if (context.isWeeklyOff) {
      return {
        firstIn: null,
        lastOut: null,
        punchCount: 0,
        totalWorkMinutes: 0,
        effectiveMinutes: 0,
        lateInMinutes: 0,
        earlyOutMinutes: 0,
        overtimeMinutes: 0,
        status: 'weekly_off',
        ruleVersion: RULE_VERSION,
        sourceHash,
        flags: ['WEEKLY_OFF'],
      };
    }

    if (context.isApprovedOD) {
      flags.push('APPROVED_OD');
      return {
        firstIn: null,
        lastOut: null,
        punchCount: 0,
        totalWorkMinutes: 0,
        effectiveMinutes: policy.fullDayMinutes,
        lateInMinutes: 0,
        earlyOutMinutes: 0,
        overtimeMinutes: 0,
        status: 'present',
        ruleVersion: RULE_VERSION,
        sourceHash,
        flags,
      };
    }

    if (context.isApprovedWFH) {
      flags.push('APPROVED_WFH');
      return {
        firstIn: null,
        lastOut: null,
        punchCount: 0,
        totalWorkMinutes: 0,
        effectiveMinutes: policy.fullDayMinutes,
        lateInMinutes: 0,
        earlyOutMinutes: 0,
        overtimeMinutes: 0,
        status: 'present',
        ruleVersion: RULE_VERSION,
        sourceHash,
        flags,
      };
    }

    return {
      firstIn: null,
      lastOut: null,
      punchCount: 0,
      totalWorkMinutes: 0,
      effectiveMinutes: 0,
      lateInMinutes: 0,
      earlyOutMinutes: 0,
      overtimeMinutes: 0,
      status: 'absent',
      ruleVersion: RULE_VERSION,
      sourceHash,
      flags: ['NO_PUNCHES'],
    };
  }

  // 2. Sort valid punches chronologically
  const validPunches = punches
    .filter(p => p.status !== 'rejected')
    .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());

  const punchCount = validPunches.length;
  const firstIn = validPunches[0]?.punchTime ?? null;
  const lastOut = validPunches[validPunches.length - 1]?.punchTime ?? null;

  // 3. Pair Punches (IN -> OUT)
  let totalWorkMinutes = 0;
  let hasMissingPunch = false;
  let currentIn: Date | null = null;

  for (const punch of validPunches) {
    if (punch.punchType === 'in') {
      if (currentIn) {
        // Two consecutive INs -> missing OUT on first
        hasMissingPunch = true;
      }
      currentIn = punch.punchTime;
    } else if (punch.punchType === 'out' || punch.punchType === 'auto_out') {
      if (punch.punchType === 'auto_out') {
        flags.push('AUTO_PUNCH_OUT');
      }
      if (currentIn) {
        totalWorkMinutes += diffMinutes(currentIn, punch.punchTime);
        currentIn = null;
      } else {
        // OUT without prior IN
        hasMissingPunch = true;
      }
    }
  }

  // If ended with unclosed IN
  if (currentIn) {
    hasMissingPunch = true;
  }

  if (hasMissingPunch) {
    flags.push('MISSING_PUNCH');
  }

  // 4. Effective Minutes calculation
  let effectiveMinutes = totalWorkMinutes;
  if (context.isApprovedOD || context.isApprovedWFH) {
    effectiveMinutes = Math.max(totalWorkMinutes, policy.fullDayMinutes);
    flags.push(context.isApprovedOD ? 'APPROVED_OD' : 'APPROVED_WFH');
  }

  // 5. Late In & Early Out against Shift
  let lateInMinutes = 0;
  let earlyOutMinutes = 0;

  if (shift && firstIn) {
    const shiftStartMinutes = parseTimeToMinutes(shift.startTime);
    const shiftEndMinutes = parseTimeToMinutes(shift.endTime);

    // Get time in UTC/local minutes for firstIn
    const inHours = firstIn.getUTCHours();
    const inMinutes = firstIn.getUTCMinutes();
    const punchInMinutes = inHours * 60 + inMinutes;

    // Grace threshold
    const graceThreshold = shiftStartMinutes + policy.graceMinutes;
    if (punchInMinutes > graceThreshold) {
      lateInMinutes = punchInMinutes - shiftStartMinutes;
      flags.push('LATE_IN');
    }

    if (lastOut) {
      const outHours = lastOut.getUTCHours();
      const outMinutes = lastOut.getUTCMinutes();
      let punchOutMinutes = outHours * 60 + outMinutes;

      let effectiveEndMinutes = shiftEndMinutes;
      if (shift.crossesMidnight) {
        effectiveEndMinutes += 1440;
        if (punchOutMinutes < shiftStartMinutes) {
          punchOutMinutes += 1440;
        }
      }

      const earlyThreshold = effectiveEndMinutes - policy.graceMinutes;
      if (punchOutMinutes < earlyThreshold) {
        earlyOutMinutes = effectiveEndMinutes - punchOutMinutes;
        flags.push('EARLY_OUT');
      }
    }
  }

  // 6. Overtime Calculation
  let overtimeMinutes = 0;
  if (context.isWeeklyOff || context.isHoliday) {
    // Work on weekly off or holiday counts fully towards overtime
    overtimeMinutes = effectiveMinutes;
    flags.push(context.isWeeklyOff ? 'WORKED_WEEKLY_OFF' : 'WORKED_HOLIDAY');
  } else if (shift && shift.workHours) {
    const standardWorkMinutes = Math.round(parseFloat(shift.workHours) * 60);
    if (effectiveMinutes > standardWorkMinutes) {
      overtimeMinutes = effectiveMinutes - standardWorkMinutes;
      flags.push('OVERTIME');
    }
  }

  // 7. Status Resolution
  let status: DayStatus;
  if (hasMissingPunch && totalWorkMinutes === 0) {
    status = 'missing_punch';
  } else if (effectiveMinutes >= policy.fullDayMinutes) {
    status = 'present';
  } else if (effectiveMinutes >= policy.halfDayMinutes) {
    status = 'half_day';
  } else if (hasMissingPunch) {
    status = 'missing_punch';
  } else {
    status = 'absent';
  }

  return {
    firstIn,
    lastOut,
    punchCount,
    totalWorkMinutes,
    effectiveMinutes,
    lateInMinutes,
    earlyOutMinutes,
    overtimeMinutes,
    status,
    ruleVersion: RULE_VERSION,
    sourceHash,
    flags,
  };
}
