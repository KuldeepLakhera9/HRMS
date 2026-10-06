import { Decimal } from 'decimal.js';

export interface ArrearsPeriodDiff {
  period: string; // YYYY-MM
  monthlyOldCtc: string;
  monthlyNewCtc: string;
  difference: string;
}

export interface ArrearsCalculationResult {
  effectiveFromPeriod: string;
  currentPeriod: string;
  monthsCount: number;
  monthlyDifference: string;
  totalArrears: string;
  periods: ArrearsPeriodDiff[];
}

/**
 * Returns list of YYYY-MM months strictly prior to currentPeriod, starting from startPeriod (inclusive).
 * e.g. startPeriod '2026-07', currentPeriod '2026-10' => ['2026-07', '2026-08', '2026-09']
 */
export function getPastPeriodsBetween(startPeriod: string, currentPeriod: string): string[] {
  if (startPeriod >= currentPeriod) return [];

  const startParts = startPeriod.split('-');
  const currParts = currentPeriod.split('-');
  const startYear = Number(startParts[0]) || 0;
  const startMonth = Number(startParts[1]) || 1;
  const currYear = Number(currParts[0]) || 0;
  const currMonth = Number(currParts[1]) || 1;

  const result: string[] = [];
  let y = startYear;
  let m = startMonth;

  while (y < currYear || (y === currYear && m < currMonth)) {
    const formattedMonth = String(m).padStart(2, '0');
    result.push(`${y}-${formattedMonth}`);

    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return result;
}

/**
 * Pure function to calculate arrears for backdated salary revisions.
 */
export function calculateArrears(params: {
  currentCtcAnnual: string | number;
  newCtcAnnual: string | number;
  effectiveFromPeriod: string; // 'YYYY-MM'
  currentPeriod: string; // 'YYYY-MM'
}): ArrearsCalculationResult {
  const oldMonthly = new Decimal(params.currentCtcAnnual).div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const newMonthly = new Decimal(params.newCtcAnnual).div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const diffMonthly = newMonthly.minus(oldMonthly);

  const pastMonths = getPastPeriodsBetween(params.effectiveFromPeriod, params.currentPeriod);

  const periods: ArrearsPeriodDiff[] = pastMonths.map(period => ({
    period,
    monthlyOldCtc: oldMonthly.toFixed(2),
    monthlyNewCtc: newMonthly.toFixed(2),
    difference: diffMonthly.toFixed(2),
  }));

  const totalArrears = diffMonthly.mul(pastMonths.length).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    effectiveFromPeriod: params.effectiveFromPeriod,
    currentPeriod: params.currentPeriod,
    monthsCount: pastMonths.length,
    monthlyDifference: diffMonthly.toFixed(2),
    totalArrears: totalArrears.toFixed(2),
    periods,
  };
}
