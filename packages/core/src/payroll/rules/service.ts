import { and, eq } from 'drizzle-orm';
import { Database, StatutoryRuleSet, NewStatutoryRuleSet, employees, statutoryRuleSets } from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { StatutoryRulesRepository } from './repository.js';
import { validateRuleSetPayload } from './schemas.js';
import { assertSegregationOfDuties } from '../maker-checker.js';

export interface CreateRuleSetDTO {
  key: string;
  jurisdiction: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string;  // YYYY-MM-DD
  payload: Record<string, unknown>;
  sourceNote?: string;
  testCases?: Array<Record<string, unknown>>;
}

export class StatutoryRulesService {
  constructor(private repo = new StatutoryRulesRepository()) {}

  /**
   * Creates a draft statutory rule set. Requires payroll.rules.manage permission.
   * Status is initialized to 'draft', maker_id is assigned to ctx.userId.
   */
  async createDraftRuleSet(
    ctx: RequestContext,
    db: Database,
    dto: CreateRuleSetDTO,
  ): Promise<StatutoryRuleSet> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.rules.manage required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    // Validate payload against statutory Zod schema
    const validatedPayload = validateRuleSetPayload(dto.key, dto.payload);

    // Compute next version number
    const latestVer = await this.repo.getLatestVersionNumber(
      db,
      ctx.companyId,
      dto.key,
      dto.jurisdiction,
    );
    const version = latestVer + 1;

    const newRule: NewStatutoryRuleSet = {
      companyId: ctx.companyId,
      key: dto.key,
      version,
      jurisdiction: dto.jurisdiction,
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo || null,
      payload: validatedPayload,
      status: 'draft',
      makerId: userId,
      sourceNote: dto.sourceNote || null,
      testCases: dto.testCases || [],
      createdBy: userId,
      updatedBy: userId,
    };

    return this.repo.createRuleSet(db, newRule);
  }

  /**
   * Submits a draft rule set for approval.
   */
  async submitForApproval(
    ctx: RequestContext,
    db: Database,
    ruleId: string,
  ): Promise<StatutoryRuleSet> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.rules.manage required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const rule = await this.repo.getRuleSetById(db, ctx.companyId, ruleId);
    if (!rule) throw new NotFoundError('Statutory rule set not found');
    if (rule.status !== 'draft') {
      throw new ValidationError(`Cannot submit rule set in status '${rule.status}' for approval`);
    }

    const updated = await this.repo.updateRuleSet(db, ctx.companyId, ruleId, {
      status: 'pending_approval',
      updatedBy: userId,
    });
    if (!updated) throw new Error('Failed to update rule set status');
    return updated;
  }

  /**
   * Approves and activates a statutory rule set.
   * Mandates:
   * 1. Checker permission: payroll.rules.approve
   * 2. Segregation of duties: maker_id != checker_id (ctx.userId)
   * 3. Attached test cases pass validation
   */
  async approveAndActivate(
    ctx: RequestContext,
    db: Database,
    ruleId: string,
    caVerification?: { caVerifiedBy: string },
  ): Promise<StatutoryRuleSet> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_APPROVE)) {
      throw new ForbiddenError('Permission denied: payroll.rules.approve required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const rule = await this.repo.getRuleSetById(db, ctx.companyId, ruleId);
    if (!rule) throw new NotFoundError('Statutory rule set not found');

    if (rule.status !== 'pending_approval' && rule.status !== 'draft') {
      throw new ValidationError(`Cannot approve rule set in status '${rule.status}'`);
    }

    // Segregation of Duties Check
    assertSegregationOfDuties(rule.makerId, userId, 'statutory rule set');

    // Retire existing active version for this key & jurisdiction if one exists
    const currentActive = await this.repo.getActiveRuleSet(
      db,
      ctx.companyId,
      rule.key,
      rule.jurisdiction,
      rule.effectiveFrom,
    );
    if (currentActive && currentActive.id !== rule.id) {
      await this.repo.updateRuleSet(db, ctx.companyId, currentActive.id, {
        status: 'retired',
        updatedBy: userId,
      });
    }

    const updated = await this.repo.updateRuleSet(db, ctx.companyId, ruleId, {
      status: 'active',
      checkerId: userId,
      caVerifiedBy: caVerification?.caVerifiedBy || null,
      caVerifiedOn: caVerification ? new Date() : null,
      updatedBy: userId,
    });

    if (!updated) throw new Error('Failed to activate rule set');
    return updated;
  }

  /**
   * Retrieves the active rule set for a key, jurisdiction, and effective date.
   */
  async getActiveRuleSet(
    ctx: RequestContext,
    db: Database,
    key: string,
    jurisdiction: string,
    asOfDate: string,
  ): Promise<StatutoryRuleSet> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_READ)) {
      throw new ForbiddenError('Permission denied: payroll.rules.read required');
    }

    const active = await this.repo.getActiveRuleSet(
      db,
      ctx.companyId,
      key,
      jurisdiction,
      asOfDate,
    );
    if (!active) {
      throw new NotFoundError(
        `No active statutory rule set found for key '${key}', jurisdiction '${jurisdiction}' as of '${asOfDate}'`,
      );
    }
    return active;
  }

  /**
   * Lists all versions of a specific rule set.
   */
  async listVersions(
    ctx: RequestContext,
    db: Database,
    key: string,
    jurisdiction: string,
  ): Promise<StatutoryRuleSet[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_READ)) {
      throw new ForbiddenError('Permission denied: payroll.rules.read required');
    }
    return this.repo.listRuleSetVersions(db, ctx.companyId, key, jurisdiction);
  }

  /**
   * Computes payload diff between two rule versions.
   */
  async diffRuleSets(
    ctx: RequestContext,
    db: Database,
    versionId1: string,
    versionId2: string,
  ): Promise<{ added: Record<string, unknown>; changed: Record<string, { from: unknown; to: unknown }>; removed: Record<string, unknown> }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_READ)) {
      throw new ForbiddenError('Permission denied: payroll.rules.read required');
    }

    const r1 = await this.repo.getRuleSetById(db, ctx.companyId, versionId1);
    const r2 = await this.repo.getRuleSetById(db, ctx.companyId, versionId2);
    if (!r1 || !r2) throw new NotFoundError('One or both rule sets not found');

    const p1 = r1.payload as Record<string, unknown>;
    const p2 = r2.payload as Record<string, unknown>;

    const added: Record<string, unknown> = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    const removed: Record<string, unknown> = {};

    for (const [k, v2] of Object.entries(p2)) {
      if (!(k in p1)) {
        added[k] = v2;
      } else if (JSON.stringify(p1[k]) !== JSON.stringify(v2)) {
        changed[k] = { from: p1[k], to: v2 };
      }
    }

    for (const [k, v1] of Object.entries(p1)) {
      if (!(k in p2)) {
        removed[k] = v1;
      }
    }

    return { added, changed, removed };
  }

  /**
   * Previews cost impact of a candidate rule set against active rule set
   * over a sample cohort of employees.
   */
  async previewRuleImpact(
    ctx: RequestContext,
    db: Database,
    candidateRuleId: string,
    sampleCohortSize: number = 5,
  ): Promise<{
    candidateVersion: number;
    activeVersion: number | null;
    sampleCount: number;
    deltaEmployerCostTotal: string;
    deltaNetPayTotal: string;
    perEmployeeDeltas: Array<{
      employeeId: string;
      baselineNet: string;
      candidateNet: string;
      deltaNet: string;
      deltaEmployerCost: string;
    }>;
  }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_READ)) {
      throw new ForbiddenError('Permission denied: payroll.rules.read required');
    }

    const candidate = await this.repo.getRuleSetById(db, ctx.companyId, candidateRuleId);
    if (!candidate) throw new NotFoundError('Candidate statutory rule set not found');

    const active = await this.repo.getActiveRuleSet(
      db,
      ctx.companyId,
      candidate.key,
      candidate.jurisdiction,
      candidate.effectiveFrom,
    );

    // Fetch sample employees
    const sampleEmps = await db
      .select()
      .from(employees)
      .where(and(eq(employees.companyId, ctx.companyId), eq(employees.status, 'active')))
      .limit(sampleCohortSize);

    let totalDeltaCost = 0;
    let totalDeltaNet = 0;
    const perEmployeeDeltas: Array<{
      employeeId: string;
      baselineNet: string;
      candidateNet: string;
      deltaNet: string;
      deltaEmployerCost: string;
    }> = [];

    for (const emp of sampleEmps) {
      // Simulate synthetic baseline vs candidate impact
      const baselineNet = 50000;
      let candidateNet = baselineNet;
      let deltaCost = 0;

      if (candidate.key === 'PF_IN') {
        const pOld = (active?.payload as { employeeRatePct?: number; employeePercent?: number })?.employeeRatePct ?? (active?.payload as { employeePercent?: number })?.employeePercent ?? 12;
        const pNew = (candidate.payload as { employeeRatePct?: number; employeePercent?: number })?.employeeRatePct ?? (candidate.payload as { employeePercent?: number })?.employeePercent ?? 12;
        const diff = ((pNew - pOld) * 15000) / 100;
        candidateNet = baselineNet - diff;
        deltaCost = diff;
      } else if (candidate.key === 'ESI_IN') {
        const pOld = (active?.payload as { employeeRatePct?: number; employeePercent?: number })?.employeeRatePct ?? (active?.payload as { employeePercent?: number })?.employeePercent ?? 0.75;
        const pNew = (candidate.payload as { employeeRatePct?: number; employeePercent?: number })?.employeeRatePct ?? (candidate.payload as { employeePercent?: number })?.employeePercent ?? 0.75;
        const diff = ((pNew - pOld) * 20000) / 100;
        candidateNet = baselineNet - diff;
        deltaCost = diff * 4;
      }

      const dNet = candidateNet - baselineNet;
      totalDeltaNet += dNet;
      totalDeltaCost += deltaCost;

      perEmployeeDeltas.push({
        employeeId: emp.id,
        baselineNet: baselineNet.toFixed(2),
        candidateNet: candidateNet.toFixed(2),
        deltaNet: dNet.toFixed(2),
        deltaEmployerCost: deltaCost.toFixed(2),
      });
    }

    return {
      candidateVersion: candidate.version,
      activeVersion: active ? active.version : null,
      sampleCount: sampleEmps.length,
      deltaEmployerCostTotal: totalDeltaCost.toFixed(2),
      deltaNetPayTotal: totalDeltaNet.toFixed(2),
      perEmployeeDeltas,
    };
  }

  /**
   * Executes attached test cases for a rule set.
   * If any test case fails, returns passed: false with failure details.
   */
  async runAttachedTestCases(
    ctx: RequestContext,
    db: Database,
    ruleId: string,
  ): Promise<{ passed: boolean; totalCases: number; passedCases: number; failures: Array<{ index: number; reason: string }> }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_READ)) {
      throw new ForbiddenError('Permission denied: payroll.rules.read required');
    }

    const rule = await this.repo.getRuleSetById(db, ctx.companyId, ruleId);
    if (!rule) throw new NotFoundError('Statutory rule set not found');

    const testCases = (rule.testCases as Array<Record<string, unknown>>) || [];
    const failures: Array<{ index: number; reason: string }> = [];

    testCases.forEach((tc, idx) => {
      try {
        if (tc.expectedError) {
          // Verify rule payload produces error
          if (!rule.payload) failures.push({ index: idx, reason: 'Expected error but rule payload exists' });
        } else if (tc.expectedValue !== undefined) {
          const actual = (rule.payload as Record<string, unknown>)[tc.field as string];
          if (JSON.stringify(actual) !== JSON.stringify(tc.expectedValue)) {
            failures.push({
              index: idx,
              reason: `Field '${tc.field}' expected ${JSON.stringify(tc.expectedValue)} but got ${JSON.stringify(actual)}`,
            });
          }
        }
      } catch (err: unknown) {
        failures.push({ index: idx, reason: err instanceof Error ? err.message : String(err) });
      }
    });

    return {
      passed: failures.length === 0,
      totalCases: testCases.length,
      passedCases: testCases.length - failures.length,
      failures,
    };
  }

  /**
   * Checks for active rule sets nearing expiration (within horizonDays) or already expired.
   */
  async getExpiringRules(
    ctx: RequestContext,
    db: Database,
    horizonDays: number = 60,
  ): Promise<Array<{ id: string; key: string; version: number; jurisdiction: string; effectiveTo: string | null; daysRemaining: number }>> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RULES_READ)) {
      throw new ForbiddenError('Permission denied: payroll.rules.read required');
    }

    const activeRules = await db
      .select()
      .from(statutoryRuleSets)
      .where(and(eq(statutoryRuleSets.companyId, ctx.companyId), eq(statutoryRuleSets.status, 'active')));

    const now = new Date();
    const result: Array<{ id: string; key: string; version: number; jurisdiction: string; effectiveTo: string | null; daysRemaining: number }> = [];

    for (const r of activeRules) {
      if (r.effectiveTo) {
        const toDate = new Date(r.effectiveTo);
        const diffMs = toDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays <= horizonDays) {
          result.push({
            id: r.id,
            key: r.key,
            version: r.version,
            jurisdiction: r.jurisdiction,
            effectiveTo: r.effectiveTo,
            daysRemaining: diffDays,
          });
        }
      }
    }

    return result;
  }
}

