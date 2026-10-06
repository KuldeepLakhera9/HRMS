import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { ptRulePayloadSchema } from '../rules/schemas.js';

export interface PtCalculationInput {
  grossEarnings: number | string;
  month: number; // 1 to 12 (calendar month e.g. 2 for February)
  gender?: 'male' | 'female' | 'other';
  rule: z.infer<typeof ptRulePayloadSchema>;
}

export interface PtCalculationResult {
  taxAmount: string;
  isExempt: boolean;
  exemptionReason?: string;
}

/**
 * Pure Professional Tax (PT) calculation engine.
 * No DB, no clock. Driven entirely by the state rule payload slabs and gender rules.
 */
export function calculatePt(input: PtCalculationInput): PtCalculationResult {
  const { rule, month, gender } = input;
  const gross = new Decimal(input.grossEarnings);

  // Female exemption threshold check if configured
  if (
    gender === 'female' &&
    rule.genderSpecificRules?.femaleExemptionThreshold !== undefined &&
    gross.lte(rule.genderSpecificRules.femaleExemptionThreshold)
  ) {
    return {
      taxAmount: '0.00',
      isExempt: true,
      exemptionReason: 'Female gross income below state exemption threshold',
    };
  }

  // Find matching slab
  for (const slab of rule.slabs) {
    const min = new Decimal(slab.minMonthlyGross);
    const max = slab.maxMonthlyGross !== null ? new Decimal(slab.maxMonthlyGross) : null;

    const matchesMin = gross.gte(min);
    const matchesMax = max === null || gross.lte(max);

    if (matchesMin && matchesMax) {
      // Check if this month is a special month (e.g. February ₹300)
      if (slab.specialMonth === month && slab.specialMonthTaxAmount !== undefined) {
        return {
          taxAmount: new Decimal(slab.specialMonthTaxAmount).toFixed(2),
          isExempt: false,
        };
      }
      return {
        taxAmount: new Decimal(slab.taxAmount).toFixed(2),
        isExempt: false,
      };
    }
  }

  return {
    taxAmount: '0.00',
    isExempt: false,
  };
}
