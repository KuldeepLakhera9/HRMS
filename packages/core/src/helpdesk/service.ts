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
import { sanitizeMarkdown } from '../announcement/markdown.js';
import type {
  HelpdeskCategoryItem,
  HelpdeskTicketItem,
  HelpdeskCommentItem,
  CreateTicketInput,
  AddCommentInput,
  ListTicketsFilters,
  TicketStatus,
} from './types.js';

export const createTicketSchema = z.object({
  categoryId: z.string().uuid('Invalid category ID'),
  subject: z.string().min(1, 'Subject is required').max(200),
  description: z.string().min(1, 'Description is required').max(10000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

export const addCommentSchema = z.object({
  commentMd: z.string().min(1, 'Comment is required').max(10000),
  isInternal: z.boolean().default(false),
});

export class HelpdeskService {
  /**
   * Lists active helpdesk categories for the tenant.
   */
  async listCategories(ctx: RequestContext, pool?: pg.Pool): Promise<HelpdeskCategoryItem[]> {
    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<HelpdeskCategoryItem>(
        `SELECT 
          id, company_id AS "companyId", name, code,
          default_assignee_role AS "defaultAssigneeRole",
          sla_hours AS "slaHours"
        FROM helpdesk_categories
        WHERE company_id = $1 AND deleted_at IS NULL
        ORDER BY name ASC`,
        [ctx.companyId],
      );

      return res.rows;
    }, pool ?? getAppPool());
  }

  /**
   * Submits a new support ticket with SLA deadline calculated from category SLA hours.
   */
  async createTicket(
    ctx: RequestContext,
    input: CreateTicketInput,
    pool?: pg.Pool,
  ): Promise<HelpdeskTicketItem> {
    if (!can(ctx, PERMISSIONS.HELPDESK_TICKET_CREATE)) {
      throw new ForbiddenError('You do not have permission to submit support tickets');
    }

    const parsed = createTicketSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid ticket data');
    }

    const { categoryId, subject, description, priority } = parsed.data;

    return withTenant(ctx, async (_tx, client) => {
      // 1. Fetch category for SLA
      const catRes = await client.query<{ sla_hours: number; name: string }>(
        `SELECT sla_hours, name FROM helpdesk_categories 
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [ctx.companyId, categoryId],
      );

      if (catRes.rows.length === 0) {
        throw new NotFoundError('Helpdesk category not found');
      }

      const slaHours = catRes.rows[0]!.sla_hours || 48;
      const slaDueAt = new Date(Date.now() + slaHours * 3600 * 1000);

      // Generate ticket number HD-YYYYMMDD-XXXX
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomPart = Math.floor(1000 + Math.random() * 9000).toString();
      const ticketNumber = `HD-${datePart}-${randomPart}`;

      const id = generateUuidV7();
      const safeDescription = sanitizeMarkdown(description);

      const res = await client.query<HelpdeskTicketItem>(
        `INSERT INTO helpdesk_tickets (
          id, company_id, ticket_number, category_id, subject, description,
          priority, status, creator_user_id, sla_due_at, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $8, $8
        ) RETURNING 
          id, company_id AS "companyId", ticket_number AS "ticketNumber",
          category_id AS "categoryId", subject, description, priority, status,
          creator_user_id AS "creatorUserId", assignee_user_id AS "assigneeUserId",
          sla_due_at AS "slaDueAt", resolved_at AS "resolvedAt", created_at AS "createdAt"`,
        [
          id,
          ctx.companyId,
          ticketNumber,
          categoryId,
          subject,
          safeDescription,
          priority,
          ctx.userId,
          slaDueAt,
        ],
      );

      const item = res.rows[0]!;
      item.categoryName = catRes.rows[0]!.name;
      return item;
    }, pool ?? getAppPool());
  }

  /**
   * Lists tickets with RBAC scoping:
   * - Helpdesk managers/admins see all tickets in company.
   * - Standard employees only see tickets they created.
   */
  async listTickets(
    ctx: RequestContext,
    filters?: ListTicketsFilters,
    pool?: pg.Pool,
  ): Promise<HelpdeskTicketItem[]> {
    if (!can(ctx, PERMISSIONS.HELPDESK_TICKET_READ)) {
      throw new ForbiddenError('You do not have permission to view support tickets');
    }

    return withTenant(ctx, async (_tx, client) => {
      const isManager = can(ctx, PERMISSIONS.HELPDESK_TICKET_MANAGE);

      const conditions: string[] = ['t.company_id = $1', 't.deleted_at IS NULL'];
      const values: unknown[] = [ctx.companyId];
      let paramIndex = 2;

      if (!isManager) {
        conditions.push(`t.creator_user_id = $${paramIndex}`);
        values.push(ctx.userId);
        paramIndex++;
      }

      if (filters?.status) {
        conditions.push(`t.status = $${paramIndex}`);
        values.push(filters.status);
        paramIndex++;
      }

      if (filters?.priority) {
        conditions.push(`t.priority = $${paramIndex}`);
        values.push(filters.priority);
        paramIndex++;
      }

      if (filters?.categoryId) {
        conditions.push(`t.category_id = $${paramIndex}`);
        values.push(filters.categoryId);
        paramIndex++;
      }

      if (filters?.assigneeUserId) {
        conditions.push(`t.assignee_user_id = $${paramIndex}`);
        values.push(filters.assigneeUserId);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      const res = await client.query<HelpdeskTicketItem>(
        `SELECT 
          t.id,
          t.company_id AS "companyId",
          t.ticket_number AS "ticketNumber",
          t.category_id AS "categoryId",
          c.name AS "categoryName",
          t.subject,
          t.description,
          t.priority,
          t.status,
          t.creator_user_id AS "creatorUserId",
          u.email AS "creatorName",
          t.assignee_user_id AS "assigneeUserId",
          au.email AS "assigneeName",
          t.sla_due_at AS "slaDueAt",
          t.resolved_at AS "resolvedAt",
          t.created_at AS "createdAt",
          COUNT(cm.id)::int AS "commentsCount"
        FROM helpdesk_tickets t
        JOIN helpdesk_categories c ON c.company_id = t.company_id AND c.id = t.category_id
        JOIN users u ON u.company_id = t.company_id AND u.id = t.creator_user_id
        LEFT JOIN users au ON au.company_id = t.company_id AND au.id = t.assignee_user_id
        LEFT JOIN helpdesk_comments cm ON cm.company_id = t.company_id AND cm.ticket_id = t.id AND cm.deleted_at IS NULL
        WHERE ${whereClause}
        GROUP BY t.id, c.name, u.email, au.email
        ORDER BY t.created_at DESC
        LIMIT 100`,
        values,
      );

      return res.rows;
    }, pool ?? getAppPool());
  }

  /**
   * Retrieves a ticket by ID including thread comments.
   * Internal comments are filtered unless caller has HELPDESK_TICKET_MANAGE.
   */
  async getTicket(
    ctx: RequestContext,
    ticketId: string,
    pool?: pg.Pool,
  ): Promise<{ ticket: HelpdeskTicketItem; comments: HelpdeskCommentItem[] }> {
    if (!can(ctx, PERMISSIONS.HELPDESK_TICKET_READ)) {
      throw new ForbiddenError('You do not have permission to view support tickets');
    }

    return withTenant(ctx, async (_tx, client) => {
      const isManager = can(ctx, PERMISSIONS.HELPDESK_TICKET_MANAGE);

      const ticketRes = await client.query<HelpdeskTicketItem>(
        `SELECT 
          t.id,
          t.company_id AS "companyId",
          t.ticket_number AS "ticketNumber",
          t.category_id AS "categoryId",
          c.name AS "categoryName",
          t.subject,
          t.description,
          t.priority,
          t.status,
          t.creator_user_id AS "creatorUserId",
          u.email AS "creatorName",
          t.assignee_user_id AS "assigneeUserId",
          au.email AS "assigneeName",
          t.sla_due_at AS "slaDueAt",
          t.resolved_at AS "resolvedAt",
          t.created_at AS "createdAt"
        FROM helpdesk_tickets t
        JOIN helpdesk_categories c ON c.company_id = t.company_id AND c.id = t.category_id
        JOIN users u ON u.company_id = t.company_id AND u.id = t.creator_user_id
        LEFT JOIN users au ON au.company_id = t.company_id AND au.id = t.assignee_user_id
        WHERE t.company_id = $1 AND t.id = $2 AND t.deleted_at IS NULL
        LIMIT 1`,
        [ctx.companyId, ticketId],
      );

      if (ticketRes.rows.length === 0) {
        throw new NotFoundError('Ticket not found');
      }

      const ticket = ticketRes.rows[0]!;

      // Scope check: caller must be creator or manager
      if (!isManager && ticket.creatorUserId !== ctx.userId) {
        throw new ForbiddenError('You do not have permission to view this ticket');
      }

      // Fetch comments (omit internal comments for regular employees)
      const commentsSql = isManager
        ? `SELECT 
             cm.id, cm.company_id AS "companyId", cm.ticket_id AS "ticketId",
             cm.user_id AS "userId", u.email AS "userName",
             cm.comment_md AS "commentMd", cm.is_internal AS "isInternal",
             cm.created_at AS "createdAt"
           FROM helpdesk_comments cm
           JOIN users u ON u.company_id = cm.company_id AND u.id = cm.user_id
           WHERE cm.company_id = $1 AND cm.ticket_id = $2 AND cm.deleted_at IS NULL
           ORDER BY cm.created_at ASC`
        : `SELECT 
             cm.id, cm.company_id AS "companyId", cm.ticket_id AS "ticketId",
             cm.user_id AS "userId", u.email AS "userName",
             cm.comment_md AS "commentMd", cm.is_internal AS "isInternal",
             cm.created_at AS "createdAt"
           FROM helpdesk_comments cm
           JOIN users u ON u.company_id = cm.company_id AND u.id = cm.user_id
           WHERE cm.company_id = $1 AND cm.ticket_id = $2 AND cm.is_internal = false AND cm.deleted_at IS NULL
           ORDER BY cm.created_at ASC`;

      const commentsRes = await client.query<HelpdeskCommentItem>(commentsSql, [
        ctx.companyId,
        ticketId,
      ]);

      return {
        ticket,
        comments: commentsRes.rows,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Adds a comment to a ticket.
   */
  async addComment(
    ctx: RequestContext,
    ticketId: string,
    input: AddCommentInput,
    pool?: pg.Pool,
  ): Promise<HelpdeskCommentItem> {
    const parsed = addCommentSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid comment data');
    }

    const { commentMd, isInternal } = parsed.data;
    const isManager = can(ctx, PERMISSIONS.HELPDESK_TICKET_MANAGE);

    if (isInternal && !isManager) {
      throw new ForbiddenError('Only support agents/managers can post internal notes');
    }

    return withTenant(ctx, async (_tx, client) => {
      // Verify ticket access
      const ticketRes = await client.query<{ creator_user_id: string }>(
        `SELECT creator_user_id FROM helpdesk_tickets WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
        [ctx.companyId, ticketId],
      );

      if (ticketRes.rows.length === 0) {
        throw new NotFoundError('Ticket not found');
      }

      if (!isManager && ticketRes.rows[0]!.creator_user_id !== ctx.userId) {
        throw new ForbiddenError('You do not have permission to comment on this ticket');
      }

      const commentId = generateUuidV7();
      const safeComment = sanitizeMarkdown(commentMd);

      const res = await client.query<HelpdeskCommentItem>(
        `INSERT INTO helpdesk_comments (
          id, company_id, ticket_id, user_id, comment_md, is_internal, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $4, $4
        ) RETURNING 
          id, company_id AS "companyId", ticket_id AS "ticketId", user_id AS "userId",
          comment_md AS "commentMd", is_internal AS "isInternal", created_at AS "createdAt"`,
        [commentId, ctx.companyId, ticketId, ctx.userId, safeComment, isInternal],
      );

      return res.rows[0]!;
    }, pool ?? getAppPool());
  }

  /**
   * Updates ticket status (e.g. resolve, close, in_progress).
   * Requires HELPDESK_TICKET_MANAGE.
   */
  async updateTicketStatus(
    ctx: RequestContext,
    ticketId: string,
    status: TicketStatus,
    pool?: pg.Pool,
  ): Promise<HelpdeskTicketItem> {
    if (!can(ctx, PERMISSIONS.HELPDESK_TICKET_MANAGE)) {
      throw new ForbiddenError('You do not have permission to update ticket status');
    }

    return withTenant(ctx, async (_tx, client) => {
      const isResolvedOrClosed = status === 'resolved' || status === 'closed';

      const res = await client.query<HelpdeskTicketItem>(
        `UPDATE helpdesk_tickets
         SET status = $3,
             resolved_at = CASE WHEN $4::boolean AND resolved_at IS NULL THEN CURRENT_TIMESTAMP ELSE resolved_at END,
             updated_by = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING 
           id, company_id AS "companyId", ticket_number AS "ticketNumber",
           category_id AS "categoryId", subject, description, priority, status,
           creator_user_id AS "creatorUserId", assignee_user_id AS "assigneeUserId",
           sla_due_at AS "slaDueAt", resolved_at AS "resolvedAt", created_at AS "createdAt"`,
        [ctx.companyId, ticketId, status, isResolvedOrClosed, ctx.userId],
      );

      if (res.rows.length === 0) {
        throw new NotFoundError('Ticket not found');
      }

      return res.rows[0]!;
    }, pool ?? getAppPool());
  }
}
