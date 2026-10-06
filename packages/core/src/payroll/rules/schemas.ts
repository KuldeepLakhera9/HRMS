import { z } from 'zod';

// PF (Provident Fund) Payload Schema
export const pfRulePayloadSchema = z.object({
  employeeRatePct: z.number().min(0).max(100),
  employerEpsRatePct: z.number().min(0).max(100),
  employerEpfRatePct: z.number().min(0).max(100),
  edliRatePct: z.number().min(0).max(100),
  adminChargeRatePct: z.number().min(0).max(100),
  wageCeilingMonthly: z.number().min(0),
  allowContributeOnActual: z.boolean(),
  allowVpf: z.boolean(),
  roundingMode: z.enum(['half_up', 'floor', 'ceil']),
  ecrFileFormatVersion: z.string(),
  ncpDaysRule: z.enum(['lop_only', 'lop_and_unpaid']),
});

// ESI (Employee State Insurance) Payload Schema
export const esiRulePayloadSchema = z.object({
  wageThresholdMonthly: z.number().min(0),
  employeeRatePct: z.number().min(0).max(100),
  employerRatePct: z.number().min(0).max(100),
  contributionPeriods: z.array(
    z.object({
      startMonth: z.number().min(1).max(12),
      endMonth: z.number().min(1).max(12),
    }),
  ),
  continuityStickiness: z.boolean(),
  roundingMode: z.enum(['half_up', 'ceil']),
});

// PT (Professional Tax) State Slabs Schema
export const ptRulePayloadSchema = z.object({
  stateCode: z.string().length(2),
  registrationNumber: z.string().optional(),
  slabs: z.array(
    z.object({
      minMonthlyGross: z.number().min(0),
      maxMonthlyGross: z.number().nullable(),
      taxAmount: z.number().min(0),
      specialMonth: z.number().min(1).max(12).optional(),
      specialMonthTaxAmount: z.number().min(0).optional(),
    }),
  ),
  genderSpecificRules: z
    .object({
      femaleExemptionThreshold: z.number().optional(),
    })
    .optional(),
});

// LWF (Labour Welfare Fund) State Schema
export const lwfRulePayloadSchema = z.object({
  stateCode: z.string().length(2),
  employeeContribution: z.number().min(0),
  employerContribution: z.number().min(0),
  deductionMonths: z.array(z.number().min(1).max(12)),
  wageEligibilityCeiling: z.number().nullable(),
});

// TDS (Income Tax Section 392) Payload Schema
export const tdsRulePayloadSchema = z.object({
  financialYear: z.string().regex(/^\d{4}-\d{4}$/),
  regimes: z.record(
    z.enum(['new', 'old']),
    z.object({
      standardDeduction: z.number().min(0),
      taxSlabs: z.array(
        z.object({
          minIncome: z.number().min(0),
          maxIncome: z.number().nullable(),
          ratePct: z.number().min(0).max(100),
        }),
      ),
      rebate: z.object({
        thresholdTaxableIncome: z.number().min(0),
        maxRebateAmount: z.number().min(0),
        marginalReliefEnabled: z.boolean(),
      }),
      surchargeSlabs: z.array(
        z.object({
          minIncome: z.number().min(0),
          maxIncome: z.number().nullable(),
          ratePct: z.number().min(0).max(100),
          marginalReliefEnabled: z.boolean(),
        }),
      ),
      healthAndEducationCessPct: z.number().min(0).max(100),
      allowedDeductions: z.array(z.string()),
    }),
  ),
});

// Gratuity Rule Schema
export const gratuityRulePayloadSchema = z.object({
  formulaBasisDays: z.number().min(1).max(31), // Usually 15 / 26
  divisorDays: z.number().min(1).max(31),      // Usually 26
  eligibilityYearsPermanent: z.number().min(0), // Usually 5
  eligibilityYearsFixedTerm: z.number().min(0), // Under codes 1
  maxCeilingAmount: z.number().min(0),
});

// Statutory Bonus Schema
export const bonusRulePayloadSchema = z.object({
  eligibilityWageCeiling: z.number().min(0),
  calcWageCeiling: z.number().min(0),
  minPct: z.number().min(0).max(100), // Usually 8.33
  maxPct: z.number().min(0).max(100), // Usually 20.0
  computationPeriodMonths: z.number().min(1).max(12),
});

// Code on Wages (Statutory Wages Definition) Schema
export const labourCodeWagesPayloadSchema = z.object({
  enabled: z.boolean(),
  statutoryWagesFloorPct: z.number().min(0).max(100),
  excludedComponentCategories: z.array(z.string()),
  excessRemunerationAddBackRule: z.enum(['pro_rata_excluded', 'balancing_allowance']),
});

// Form Labels (Externalized Compliance Labels) Schema
export const formLabelsPayloadSchema = z.object({
  annualCertificateLabel: z.string(),
  quarterlyReturnLabel: z.string(),
  regimeDeclarationLabel: z.string(),
  employeeClaimsLabel: z.string(),
});

export const rulePayloadValidators: Record<string, z.ZodTypeAny> = {
  PF_IN: pfRulePayloadSchema,
  ESI_IN: esiRulePayloadSchema,
  TDS_IN: tdsRulePayloadSchema,
  GRATUITY_IN: gratuityRulePayloadSchema,
  BONUS_IN: bonusRulePayloadSchema,
  LABOUR_CODE_WAGES: labourCodeWagesPayloadSchema,
  FORM_LABELS: formLabelsPayloadSchema,
};

export function validateRuleSetPayload(key: string, payload: unknown): Record<string, unknown> {
  if (key.startsWith('PT_')) {
    return ptRulePayloadSchema.parse(payload);
  }
  if (key.startsWith('LWF_')) {
    return lwfRulePayloadSchema.parse(payload);
  }
  const validator = rulePayloadValidators[key];
  if (!validator) {
    throw new Error(`No validation schema registered for rule key '${key}'`);
  }
  return validator.parse(payload);
}
