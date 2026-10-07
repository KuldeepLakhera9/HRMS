import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { labourCodeWagesPayloadSchema } from '../rules/schemas.js';

export interface LabourCodeWagesInput {
  totalRemuneration: number | string; // Total gross monthly earnings
  statutoryWageComponents: Record<string, number | string>; // e.g. { BASIC: 20000, DA: 5000 }
  excludedComponents: Record<string, number | string>; // e.g. { HRA: 15000, SPECIAL_ALLOWANCE: 15000 }
  rule: z.infer<typeof labourCodeWagesPayloadSchema>;
}

export interface LabourCodeWagesResult {
  enabled: boolean;
  statutoryWagesSum: string;
  excludedAllowancesSum: string;
  floorAmount: string;
  excessRemunerationAddedBack: string;
  finalStatutoryWageBase: string;
  warningBelowFloor: boolean;
}

/**
 * Pure Labour Code on Wages wage base calculation engine.
 * Section 2(y) rule: Wages must not be less than 50% of total remuneration.
 * If excluded allowances exceed 50% of total remuneration, the excess is deemed as wages and added back.
 */
export function calculateLabourCodeWages(input: LabourCodeWagesInput): LabourCodeWagesResult {
  const { rule } = input;
  const totalRemuneration = new Decimal(input.totalRemuneration);

  let statutorySum = new Decimal(0);
  for (const val of Object.values(input.statutoryWageComponents)) {
    statutorySum = statutorySum.add(new Decimal(val));
  }

  let excludedSum = new Decimal(0);
  for (const val of Object.values(input.excludedComponents)) {
    excludedSum = excludedSum.add(new Decimal(val));
  }

  if (!rule.enabled) {
    return {
      enabled: false,
      statutoryWagesSum: statutorySum.toFixed(2),
      excludedAllowancesSum: excludedSum.toFixed(2),
      floorAmount: '0.00',
      excessRemunerationAddedBack: '0.00',
      finalStatutoryWageBase: statutorySum.toFixed(2),
      warningBelowFloor: false,
    };
  }

  // Floor: statutory floor percentage of total remuneration (e.g. 50%)
  const ruleFallback = rule as unknown as Record<string, number | undefined>;
  const floorVal = rule.statutoryWagesFloorPct ?? ruleFallback.floorPct;
  if (floorVal == null) {
    throw new Error('Statutory Labour Code rule must define statutoryWagesFloorPct');
  }
  const floorPct = new Decimal(floorVal).div(100);
  const floorAmount = totalRemuneration.mul(floorPct);

  // If excluded allowances exceed 50% of total remuneration
  // Excess = max(0, excludedSum - (totalRemuneration * (1 - floorPct)))
  const allowedExcludedMax = totalRemuneration.mul(new Decimal(1).sub(floorPct));
  let excessAddedBack = new Decimal(0);

  if (excludedSum.gt(allowedExcludedMax)) {
    excessAddedBack = excludedSum.sub(allowedExcludedMax);
  }

  const finalStatutoryWageBase = statutorySum.add(excessAddedBack);
  const warningBelowFloor = statutorySum.lt(floorAmount);

  return {
    enabled: true,
    statutoryWagesSum: statutorySum.toFixed(2),
    excludedAllowancesSum: excludedSum.toFixed(2),
    floorAmount: floorAmount.toFixed(2),
    excessRemunerationAddedBack: excessAddedBack.toFixed(2),
    finalStatutoryWageBase: finalStatutoryWageBase.toFixed(2),
    warningBelowFloor,
  };
}
