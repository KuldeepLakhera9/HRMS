import { describe, it, expect } from 'vitest';
import {
  calculatePf,
  calculateEsi,
  calculatePt,
  calculateLwf,
  calculateGratuityProvision,
  calculateLabourCodeWages,
} from './index.js';

describe('Pure Statutory Engines (Rule Payload Driven)', () => {
  // Synthetic Test Rule Fixtures (Prefixed with TEST_ per prompt specifications)
  const TEST_PF_RULE = {
    employeeRatePct: 12,
    employerEpsRatePct: 8.33,
    employerEpfRatePct: 3.67,
    edliRatePct: 0.5,
    adminChargeRatePct: 0.5,
    wageCeilingMonthly: 15000,
    allowContributeOnActual: true,
    allowVpf: true,
    roundingMode: 'half_up' as const,
    ecrFileFormatVersion: '2.0',
    ncpDaysRule: 'lop_only' as const,
  };

  const TEST_ESI_RULE = {
    wageThresholdMonthly: 21000,
    employeeRatePct: 0.75,
    employerRatePct: 3.25,
    contributionPeriods: [
      { startMonth: 4, endMonth: 9 },
      { startMonth: 10, endMonth: 3 },
    ],
    continuityStickiness: true,
    roundingMode: 'ceil' as const,
  };

  const TEST_PT_MH_RULE = {
    stateCode: 'MH',
    slabs: [
      { minMonthlyGross: 0, maxMonthlyGross: 7500, taxAmount: 0 },
      { minMonthlyGross: 7501, maxMonthlyGross: 10000, taxAmount: 175 },
      {
        minMonthlyGross: 10001,
        maxMonthlyGross: null,
        taxAmount: 200,
        specialMonth: 2, // February
        specialMonthTaxAmount: 300,
      },
    ],
    genderSpecificRules: {
      femaleExemptionThreshold: 25000,
    },
  };

  const TEST_LWF_MH_RULE = {
    stateCode: 'MH',
    employeeContribution: 12,
    employerContribution: 36,
    deductionMonths: [6, 12], // June & December
    wageEligibilityCeiling: null,
  };

  const TEST_GRATUITY_RULE = {
    formulaBasisDays: 15,
    divisorDays: 26,
    eligibilityYearsPermanent: 5,
    eligibilityYearsFixedTerm: 1,
    maxCeilingAmount: 2000000, // 20 Lakhs
  };

  const TEST_LABOUR_CODE_RULE = {
    enabled: true,
    statutoryWagesFloorPct: 50,
    excludedComponentCategories: ['HRA', 'SPECIAL_ALLOWANCE', 'CONVEYANCE'],
    excessRemunerationAddBackRule: 'balancing_allowance' as const,
  };

  describe('1. PF Engine (calculatePf)', () => {
    it('caps wages at statutory ceiling when actual contribution is false', () => {
      // Gross PF wage: 30,000, Ceiling: 15,000
      const res = calculatePf({
        pfWages: 30000,
        contributeOnActual: false,
        rule: TEST_PF_RULE,
      });

      expect(res.wageBase).toBe('15000.00');
      expect(res.employeePf).toBe('1800.00'); // 15,000 * 12% = 1800
      expect(res.employerEps).toBe('1250.00'); // 15,000 * 8.33% = 1249.5 -> 1250
      expect(res.employerEpf).toBe('551.00');  // 15,000 * 3.67% = 550.5 -> 551
      expect(res.edli).toBe('75.00');         // 15,000 * 0.5% = 75
      expect(res.adminCharges).toBe('75.00'); // 15,000 * 0.5% = 75
    });

    it('computes on actual wages when contributeOnActual is true', () => {
      // Gross PF wage: 20,000, Actual: true
      const res = calculatePf({
        pfWages: 20000,
        contributeOnActual: true,
        vpfAmount: 1000,
        rule: TEST_PF_RULE,
      });

      expect(res.wageBase).toBe('20000.00');
      expect(res.employeePf).toBe('2400.00'); // 20,000 * 12% = 2400
      expect(res.vpf).toBe('1000.00');
      expect(res.totalEmployeeDeduction).toBe('3400.00');
      // EPS is still capped at 15,000: 15,000 * 8.33% = 1250
      expect(res.employerEps).toBe('1250.00');
      // Employer EPF on actual: 20,000 * 3.67% = 734
      expect(res.employerEpf).toBe('734.00');
    });

    it('handles wages below ceiling correctly', () => {
      // Gross PF wage: 10,000
      const res = calculatePf({
        pfWages: 10000,
        rule: TEST_PF_RULE,
      });

      expect(res.wageBase).toBe('10000.00');
      expect(res.employeePf).toBe('1200.00');
      expect(res.employerEps).toBe('833.00');
      expect(res.employerEpf).toBe('367.00');
    });
  });

  describe('2. ESI Engine (calculateEsi)', () => {
    it('calculates employee and employer share for eligible wages', () => {
      // Gross wage: 16,000 <= 21,000 ceiling
      const res = calculateEsi({
        grossWages: 16000,
        rule: TEST_ESI_RULE,
      });

      expect(res.eligible).toBe(true);
      // 16,000 * 0.75% = 120
      expect(res.employeeEsi).toBe('120.00');
      // 16,000 * 3.25% = 520
      expect(res.employerEsi).toBe('520.00');
      expect(res.totalEsi).toBe('640.00');
    });

    it('returns zero and ineligible when gross wage exceeds threshold without stickiness', () => {
      // Gross wage: 25,000 > 21,000
      const res = calculateEsi({
        grossWages: 25000,
        hasExistingCoverage: false,
        rule: TEST_ESI_RULE,
      });

      expect(res.eligible).toBe(false);
      expect(res.employeeEsi).toBe('0.00');
      expect(res.employerEsi).toBe('0.00');
    });

    it('maintains coverage when gross wage increases mid-contribution period if stickiness is enabled', () => {
      // Gross wage: 25,000 but has existing coverage in active period
      const res = calculateEsi({
        grossWages: 25000,
        hasExistingCoverage: true,
        rule: TEST_ESI_RULE,
      });

      expect(res.eligible).toBe(true);
      expect(res.employeeEsi).toBe('188.00'); // 25,000 * 0.75% = 187.5 -> ceil = 188
      expect(res.employerEsi).toBe('813.00'); // 25,000 * 3.25% = 812.5 -> ceil = 813
    });
  });

  describe('3. Professional Tax Engine (calculatePt)', () => {
    it('returns standard slab tax for regular month', () => {
      // Gross: 15,000 in January (month 1)
      const res = calculatePt({
        grossEarnings: 15000,
        month: 1,
        gender: 'male',
        rule: TEST_PT_MH_RULE,
      });

      expect(res.isExempt).toBe(false);
      expect(res.taxAmount).toBe('200.00');
    });

    it('returns special month tax amount in February (₹300 in Maharashtra)', () => {
      // Gross: 15,000 in February (month 2)
      const res = calculatePt({
        grossEarnings: 15000,
        month: 2,
        gender: 'male',
        rule: TEST_PT_MH_RULE,
      });

      expect(res.isExempt).toBe(false);
      expect(res.taxAmount).toBe('300.00');
    });

    it('exempts female employee below state exemption threshold', () => {
      // Gross: 20,000 <= 25,000 female exemption threshold
      const res = calculatePt({
        grossEarnings: 20000,
        month: 1,
        gender: 'female',
        rule: TEST_PT_MH_RULE,
      });

      expect(res.isExempt).toBe(true);
      expect(res.taxAmount).toBe('0.00');
    });
  });

  describe('4. Labour Welfare Fund Engine (calculateLwf)', () => {
    it('applies deduction during configured deduction months', () => {
      // June (month 6)
      const res = calculateLwf({
        grossEarnings: 30000,
        month: 6,
        rule: TEST_LWF_MH_RULE,
      });

      expect(res.isDeductionMonth).toBe(true);
      expect(res.employeeContribution).toBe('12.00');
      expect(res.employerContribution).toBe('36.00');
      expect(res.totalContribution).toBe('48.00');
    });

    it('does not deduct during non-deduction months', () => {
      // July (month 7)
      const res = calculateLwf({
        grossEarnings: 30000,
        month: 7,
        rule: TEST_LWF_MH_RULE,
      });

      expect(res.isDeductionMonth).toBe(false);
      expect(res.employeeContribution).toBe('0.00');
      expect(res.employerContribution).toBe('0.00');
    });
  });

  describe('5. Gratuity Engine (calculateGratuityProvision)', () => {
    it('calculates gratuity provision for permanent employee with >= 5 years tenure', () => {
      // Basic: 30,000, Tenure: 6 years
      // Formula: (30,000 * 15 * 6) / 26 = 2,700,000 / 26 = 103,846.15
      const res = calculateGratuityProvision({
        basicWageMonthly: 30000,
        tenureYears: 6,
        employmentType: 'permanent',
        rule: TEST_GRATUITY_RULE,
      });

      expect(res.eligible).toBe(true);
      expect(res.provisionAmount).toBe('103846.15');
      expect(res.isCapped).toBe(false);
    });

    it('marks ineligible when permanent employee has < 5 years tenure', () => {
      const res = calculateGratuityProvision({
        basicWageMonthly: 30000,
        tenureYears: 4,
        employmentType: 'permanent',
        rule: TEST_GRATUITY_RULE,
      });

      expect(res.eligible).toBe(false);
      expect(res.provisionAmount).toBe('69230.77');
    });

    it('caps gratuity provision at statutory max limit', () => {
      // Very high basic & tenure
      const res = calculateGratuityProvision({
        basicWageMonthly: 500000,
        tenureYears: 20,
        employmentType: 'permanent',
        rule: TEST_GRATUITY_RULE,
      });

      expect(res.eligible).toBe(true);
      expect(res.isCapped).toBe(true);
      expect(res.provisionAmount).toBe('2000000.00');
    });
  });

  describe('6. Labour Code Wages Engine (calculateLabourCodeWages)', () => {
    it('verifies compliant salary structure where statutory wages >= 50%', () => {
      // Total Remuneration: 100,000
      // Statutory (Basic + DA): 55,000 (55%)
      // Excluded (HRA + Special Allowance): 45,000 (45%)
      const res = calculateLabourCodeWages({
        totalRemuneration: 100000,
        statutoryWageComponents: { BASIC: 50000, DA: 5000 },
        excludedComponents: { HRA: 25000, SPECIAL_ALLOWANCE: 20000 },
        rule: TEST_LABOUR_CODE_RULE,
      });

      expect(res.warningBelowFloor).toBe(false);
      expect(res.statutoryWagesSum).toBe('55000.00');
      expect(res.excludedAllowancesSum).toBe('45000.00');
      expect(res.floorAmount).toBe('50000.00');
      expect(res.excessRemunerationAddedBack).toBe('0.00');
      expect(res.finalStatutoryWageBase).toBe('55000.00');
    });

    it('adds back excess excluded allowances when allowances exceed 50% floor', () => {
      // Total Remuneration: 100,000
      // Statutory (Basic): 30,000 (30%)
      // Excluded (HRA + Special Allowance): 70,000 (70%)
      // Maximum allowed excluded = 50,000
      // Excess added back = 70,000 - 50,000 = 20,000
      // Final statutory wage base = 30,000 + 20,000 = 50,000
      const res = calculateLabourCodeWages({
        totalRemuneration: 100000,
        statutoryWageComponents: { BASIC: 30000 },
        excludedComponents: { HRA: 40000, SPECIAL_ALLOWANCE: 30000 },
        rule: TEST_LABOUR_CODE_RULE,
      });

      expect(res.warningBelowFloor).toBe(true);
      expect(res.floorAmount).toBe('50000.00');
      expect(res.excessRemunerationAddedBack).toBe('20000.00');
      expect(res.finalStatutoryWageBase).toBe('50000.00');
    });
  });
});
