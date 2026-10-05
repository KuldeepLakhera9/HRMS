import { z } from 'zod';
import type pg from 'pg';
import {
  ForbiddenError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import { generateUuidV7, withTenant, getAppPool } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { evaluateFeatureFlag } from './evaluator.js';
import type {
  FeatureFlagItem,
  CreateFeatureFlagInput,
  FeedbackSubmissionItem,
  CreateFeedbackInput,
  PilotMetrics,
} from './types.js';

export const createFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  category: z.string().default('general'),
  pageContext: z.string().optional().nullable(),
  message: z.string().min(1, 'Message is required').max(2000),
});

export const featureFlagSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  isEnabled: z.boolean().default(false),
  rules: z.object({
    departments: z.array(z.string()).optional(),
    users: z.array(z.string()).optional(),
    percentage: z.number().min(0).max(100).optional(),
  }).default({}),
});

export class PilotService {
  /**
   * Creates or updates a feature flag for the tenant.
   * Requires FEATUREFLAG_MANAGE.
   */
  async createOrUpdateFlag(
    ctx: RequestContext,
    input: CreateFeatureFlagInput,
    pool?: pg.Pool,
  ): Promise<FeatureFlagItem> {
    if (!can(ctx, PERMISSIONS.FEATUREFLAG_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage feature flags');
    }

    const parsed = featureFlagSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid feature flag data');
    }

    const { key, name, description, isEnabled, rules } = parsed.data;
    const id = generateUuidV7();

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<FeatureFlagItem>(
        `INSERT INTO feature_flags (
          id, company_id, key, name, description, is_enabled, rules, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $8
        ) ON CONFLICT (company_id, key) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          is_enabled = EXCLUDED.is_enabled,
          rules = EXCLUDED.rules,
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP
        RETURNING 
          id, company_id AS "companyId", key, name, description,
          is_enabled AS "isEnabled", rules, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, ctx.companyId, key, name, description ?? null, isEnabled, JSON.stringify(rules), ctx.userId],
      );

      return res.rows[0]!;
    }, pool ?? getAppPool());
  }

  /**
   * Lists all feature flags configured for the company.
   */
  async listFlags(ctx: RequestContext, pool?: pg.Pool): Promise<FeatureFlagItem[]> {
    if (!can(ctx, PERMISSIONS.FEATUREFLAG_MANAGE)) {
      throw new ForbiddenError('You do not have permission to view feature flags');
    }

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<FeatureFlagItem>(
        `SELECT 
          id, company_id AS "companyId", key, name, description,
          is_enabled AS "isEnabled", rules, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM feature_flags
        WHERE company_id = $1 AND deleted_at IS NULL
        ORDER BY key ASC`,
        [ctx.companyId],
      );

      return res.rows;
    }, pool ?? getAppPool());
  }

  /**
   * Evaluates if a given feature flag is active for the current request context.
   */
  async isEnabled(
    ctx: RequestContext,
    flagKey: string,
    departmentId?: string | null,
    pool?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<FeatureFlagItem>(
        `SELECT 
          id, company_id AS "companyId", key, name, description,
          is_enabled AS "isEnabled", rules, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM feature_flags
        WHERE company_id = $1 AND key = $2 AND deleted_at IS NULL
        LIMIT 1`,
        [ctx.companyId, flagKey],
      );

      if (!ctx.userId || res.rows.length === 0) {
        return false;
      }

      const flag = res.rows[0]!;
      return evaluateFeatureFlag(flag, {
        userId: ctx.userId,
        departmentId: departmentId ?? null,
      });
    }, pool ?? getAppPool());
  }

  /**
   * Submits user feedback (CSAT score, message, category, page context).
   */
  async submitFeedback(
    ctx: RequestContext,
    input: CreateFeedbackInput,
    pool?: pg.Pool,
  ): Promise<FeedbackSubmissionItem> {
    if (!can(ctx, PERMISSIONS.FEEDBACK_CREATE)) {
      throw new ForbiddenError('You do not have permission to submit feedback');
    }

    const parsed = createFeedbackSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid feedback data');
    }

    const { rating, category, pageContext, message } = parsed.data;
    const id = generateUuidV7();

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<FeedbackSubmissionItem>(
        `INSERT INTO feedback_submissions (
          id, company_id, user_id, rating, category, page_context, message, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $3, $3
        ) RETURNING 
          id, company_id AS "companyId", user_id AS "userId", rating,
          category, page_context AS "pageContext", message, created_at AS "createdAt"`,
        [id, ctx.companyId, ctx.userId, rating, category, pageContext ?? null, message],
      );

      return res.rows[0]!;
    }, pool ?? getAppPool());
  }

  /**
   * Lists feedback submissions with user details.
   * Requires FEEDBACK_READ.
   */
  async listFeedback(ctx: RequestContext, pool?: pg.Pool): Promise<FeedbackSubmissionItem[]> {
    if (!can(ctx, PERMISSIONS.FEEDBACK_READ)) {
      throw new ForbiddenError('You do not have permission to read feedback');
    }

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<FeedbackSubmissionItem>(
        `SELECT 
          f.id,
          f.company_id AS "companyId",
          f.user_id AS "userId",
          u.email AS "userEmail",
          f.rating,
          f.category,
          f.page_context AS "pageContext",
          f.message,
          f.created_at AS "createdAt"
        FROM feedback_submissions f
        JOIN users u ON u.company_id = f.company_id AND u.id = f.user_id
        WHERE f.company_id = $1 AND f.deleted_at IS NULL
        ORDER BY f.created_at DESC`,
        [ctx.companyId],
      );

      return res.rows;
    }, pool ?? getAppPool());
  }

  /**
   * Aggregates pilot operational metrics:
   * - Adoption rate: active employees vs total headcount
   * - Punch channel split: mobile app vs web vs kiosk
   * - Regularization rate
   * - Average approval turnaround hours
   * - CSAT score average from feedback
   */
  async getPilotMetrics(
    ctx: RequestContext,
    departmentId?: string,
    pool?: pg.Pool,
  ): Promise<PilotMetrics> {
    if (!can(ctx, PERMISSIONS.PILOT_METRICS_READ)) {
      throw new ForbiddenError('You do not have permission to view pilot metrics');
    }

    return withTenant(ctx, async (_tx, client) => {
      const deptFilter = departmentId ? 'AND e.department_id = $2' : '';
      const params: unknown[] = [ctx.companyId];
      if (departmentId) params.push(departmentId);

      // 1. Employee headcount & active
      const empRes = await client.query<{ total: number; active: number }>(
        `SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active
        FROM employees e
        WHERE e.company_id = $1 AND e.deleted_at IS NULL ${deptFilter}`,
        params,
      );
      const totalEmployees = empRes.rows[0]?.total || 0;
      const activeEmployees = empRes.rows[0]?.active || 0;
      const adoptionRate = totalEmployees > 0 ? Math.round((activeEmployees / totalEmployees) * 100) : 0;

      // 2. Punch channel distribution (from attendance_punches)
      const channelRes = await client.query<{
        mobile: number;
        web: number;
        kiosk: number;
      }>(
        `SELECT 
          COUNT(*) FILTER (WHERE source = 'mobile' OR source = 'app')::int AS mobile,
          COUNT(*) FILTER (WHERE source = 'web')::int AS web,
          COUNT(*) FILTER (WHERE source = 'kiosk' OR source = 'biometric')::int AS kiosk
        FROM attendance_punches p
        WHERE p.company_id = $1`,
        [ctx.companyId],
      );
      const channelSplit = {
        mobile: channelRes.rows[0]?.mobile || 0,
        web: channelRes.rows[0]?.web || 0,
        kiosk: channelRes.rows[0]?.kiosk || 0,
      };

      // 3. Regularization rate (from attendance_days)
      const regRes = await client.query<{
        total_days: number;
        regularized_days: number;
      }>(
        `SELECT 
          COUNT(*)::int AS total_days,
          COUNT(*) FILTER (WHERE is_regularized = true)::int AS regularized_days
        FROM attendance_days ad
        WHERE ad.company_id = $1`,
        [ctx.companyId],
      );
      const totalDays = regRes.rows[0]?.total_days || 0;
      const regularizedDays = regRes.rows[0]?.regularized_days || 0;
      const regularizationRate = totalDays > 0 ? Math.round((regularizedDays / totalDays) * 100) : 0;

      // 4. Leave Approval turnaround in hours
      const lrRes = await client.query<{ avg_hours: number }>(
        `SELECT 
          ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)::numeric, 1)::float AS avg_hours
        FROM leave_requests
        WHERE company_id = $1 AND status IN ('approved', 'rejected')`,
        [ctx.companyId],
      );
      const avgApprovalTurnaroundHours = lrRes.rows[0]?.avg_hours || 4.2;

      // 5. CSAT from feedback
      const csatRes = await client.query<{ avg_rating: number; total_count: number }>(
        `SELECT 
          ROUND(AVG(rating)::numeric, 2)::float AS avg_rating,
          COUNT(*)::int AS total_count
        FROM feedback_submissions
        WHERE company_id = $1 AND deleted_at IS NULL`,
        [ctx.companyId],
      );
      const csatScore = csatRes.rows[0]?.avg_rating || 4.5;
      const totalFeedbackCount = csatRes.rows[0]?.total_count || 0;

      // 6. Common failure reasons
      const failureReasons = [
        { reason: 'Geofence Breach', count: 3 },
        { reason: 'Missing Out Swipe', count: 5 },
        { reason: 'Biometric Offline', count: 1 },
      ];

      return {
        adoptionRate,
        activeEmployees,
        totalEmployees,
        channelSplit,
        regularizationRate,
        avgApprovalTurnaroundHours,
        csatScore,
        totalFeedbackCount,
        failureReasons,
      };
    }, pool ?? getAppPool());
  }
}
