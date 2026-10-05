import { z } from 'zod';
import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import { generateUuidV7, withTenant, getAppPool } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { sanitizeMarkdown } from './markdown.js';
import type {
  AnnouncementItem,
  CreateAnnouncementInput,
  ListAnnouncementsFilters,
} from './types.js';

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  contentMd: z.string().min(1, 'Content is required').max(50000),
  audienceType: z.enum(['all', 'department', 'location']).default('all'),
  targetDeptId: z.string().uuid().optional().nullable(),
  targetLocId: z.string().uuid().optional().nullable(),
  isPinned: z.boolean().default(false),
  publishedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional().nullable(),
});

export class AnnouncementService {
  /**
   * Creates an announcement after sanitizing its markdown content.
   * Requires ANNOUNCEMENT_MANAGE permission.
   */
  async createAnnouncement(
    ctx: RequestContext,
    input: CreateAnnouncementInput,
    pool?: pg.Pool,
  ): Promise<AnnouncementItem> {
    if (!can(ctx, PERMISSIONS.ANNOUNCEMENT_MANAGE)) {
      throw new ForbiddenError('You do not have permission to create announcements');
    }

    const parsed = createAnnouncementSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid announcement data');
    }

    const {
      title,
      contentMd,
      audienceType,
      targetDeptId,
      targetLocId,
      isPinned,
      publishedAt,
      expiresAt,
    } = parsed.data;

    const safeContent = sanitizeMarkdown(contentMd);
    const id = generateUuidV7();
    const effectivePublishedAt = publishedAt ?? new Date();

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<AnnouncementItem>(
        `INSERT INTO announcements (
          id, company_id, title, content_md, audience_type, target_dept_id,
          target_loc_id, is_pinned, published_at, expires_at, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11
        ) RETURNING 
          id, company_id AS "companyId", title, content_md AS "contentMd",
          audience_type AS "audienceType", target_dept_id AS "targetDeptId",
          target_loc_id AS "targetLocId", is_pinned AS "isPinned",
          published_at AS "publishedAt", expires_at AS "expiresAt",
          created_at AS "createdAt", created_by AS "createdBy"`,
        [
          id,
          ctx.companyId,
          title,
          safeContent,
          audienceType,
          targetDeptId ?? null,
          targetLocId ?? null,
          isPinned,
          effectivePublishedAt,
          expiresAt ?? null,
          ctx.userId,
        ],
      );

      return res.rows[0]!;
    }, pool ?? getAppPool());
  }

  /**
   * Lists announcements targeted to the caller's audience.
   * Includes read receipt indicator for caller's userId.
   */
  async listAnnouncements(
    ctx: RequestContext,
    filters?: ListAnnouncementsFilters,
    pool?: pg.Pool,
  ): Promise<AnnouncementItem[]> {
    if (!can(ctx, PERMISSIONS.ANNOUNCEMENT_READ)) {
      throw new ForbiddenError('You do not have permission to read announcements');
    }

    return withTenant(ctx, async (_tx, client) => {
      const isManager = can(ctx, PERMISSIONS.ANNOUNCEMENT_MANAGE);

      const conditions: string[] = ['a.company_id = $1', 'a.deleted_at IS NULL'];
      const values: unknown[] = [ctx.companyId, ctx.userId];
      let paramIndex = 3;

      if (!filters?.includeExpired) {
        conditions.push('(a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)');
        if (!isManager) {
          conditions.push('a.published_at <= CURRENT_TIMESTAMP');
        }
      }

      // Audience filtering for regular users
      if (!isManager) {
        let deptCondition = "a.audience_type = 'all'";
        if (filters?.departmentId) {
          deptCondition += ` OR (a.audience_type = 'department' AND a.target_dept_id = $${paramIndex})`;
          values.push(filters.departmentId);
          paramIndex++;
        }
        if (filters?.locationId) {
          deptCondition += ` OR (a.audience_type = 'location' AND a.target_loc_id = $${paramIndex})`;
          values.push(filters.locationId);
          paramIndex++;
        }
        conditions.push(`(${deptCondition})`);
      }

      const whereClause = conditions.join(' AND ');

      const res = await client.query<AnnouncementItem>(
        `SELECT 
          a.id,
          a.company_id AS "companyId",
          a.title,
          a.content_md AS "contentMd",
          a.audience_type AS "audienceType",
          a.target_dept_id AS "targetDeptId",
          a.target_loc_id AS "targetLocId",
          a.is_pinned AS "isPinned",
          a.published_at AS "publishedAt",
          a.expires_at AS "expiresAt",
          a.created_at AS "createdAt",
          a.created_by AS "createdBy",
          (ar.id IS NOT NULL) AS "isRead",
          ar.read_at AS "readAt"
        FROM announcements a
        LEFT JOIN announcement_reads ar 
          ON ar.company_id = a.company_id 
          AND ar.announcement_id = a.id 
          AND ar.user_id = $2
        WHERE ${whereClause}
        ORDER BY a.is_pinned DESC, a.published_at DESC
        LIMIT 100`,
        values,
      );

      return res.rows;
    }, pool ?? getAppPool());
  }

  /**
   * Marks an announcement as read by the current user.
   */
  async markAsRead(
    ctx: RequestContext,
    announcementId: string,
    pool?: pg.Pool,
  ): Promise<{ success: boolean; readAt: Date }> {
    if (!can(ctx, PERMISSIONS.ANNOUNCEMENT_READ)) {
      throw new ForbiddenError('You do not have permission to read announcements');
    }

    return withTenant(ctx, async (_tx, client) => {
      // Verify announcement exists in tenant
      const check = await client.query(
        `SELECT id FROM announcements WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [ctx.companyId, announcementId],
      );
      if (check.rows.length === 0) {
        throw new NotFoundError('Announcement not found');
      }

      const readId = generateUuidV7();
      const res = await client.query<{ read_at: Date }>(
        `INSERT INTO announcement_reads (id, company_id, announcement_id, user_id, read_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $4, $4)
         ON CONFLICT (company_id, announcement_id, user_id) DO UPDATE
           SET read_at = CURRENT_TIMESTAMP
         RETURNING read_at`,
        [readId, ctx.companyId, announcementId, ctx.userId],
      );

      return {
        success: true,
        readAt: res.rows[0]!.read_at,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Retrieves an announcement by ID.
   */
  async getAnnouncement(
    ctx: RequestContext,
    id: string,
    pool?: pg.Pool,
  ): Promise<AnnouncementItem> {
    if (!can(ctx, PERMISSIONS.ANNOUNCEMENT_READ)) {
      throw new ForbiddenError('You do not have permission to read announcements');
    }

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<AnnouncementItem>(
        `SELECT 
          a.id,
          a.company_id AS "companyId",
          a.title,
          a.content_md AS "contentMd",
          a.audience_type AS "audienceType",
          a.target_dept_id AS "targetDeptId",
          a.target_loc_id AS "targetLocId",
          a.is_pinned AS "isPinned",
          a.published_at AS "publishedAt",
          a.expires_at AS "expiresAt",
          a.created_at AS "createdAt",
          a.created_by AS "createdBy",
          (ar.id IS NOT NULL) AS "isRead",
          ar.read_at AS "readAt"
        FROM announcements a
        LEFT JOIN announcement_reads ar 
          ON ar.company_id = a.company_id 
          AND ar.announcement_id = a.id 
          AND ar.user_id = $2
        WHERE a.company_id = $1 AND a.id = $3 AND a.deleted_at IS NULL
        LIMIT 1`,
        [ctx.companyId, ctx.userId, id],
      );

      if (res.rows.length === 0) {
        throw new NotFoundError('Announcement not found');
      }

      return res.rows[0]!;
    }, pool ?? getAppPool());
  }
}
