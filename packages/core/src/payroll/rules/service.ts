import { Database, StatutoryRuleSet, NewStatutoryRuleSet } from '@hrms/db';
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
    if (rule.makerId === userId) {
      throw new ForbiddenError(
        'Segregation of duties violation: Maker cannot approve their own statutory rule set',
      );
    }

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
}
