import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import {
  generateUuidV7,
  getAppPool,
  withTenant,
  type HolidayList,
  type Holiday,
} from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';

export interface CreateHolidayListInput {
  name: string;
  year: number;
  locationId?: string | null | undefined;
  isDefault?: boolean | undefined;
}

export interface AddHolidayInput {
  date: string; // 'YYYY-MM-DD'
  name: string;
  type?: 'public' | 'optional' | 'restricted' | undefined;
}

export class HolidayService {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Creates a new holiday list for a specific year and optional location.
   */
  async createList(
    ctx: RequestContext,
    input: CreateHolidayListInput,
    poolOverride?: pg.Pool,
  ): Promise<HolidayList> {
    if (!can(ctx, PERMISSIONS.HOLIDAY_MANAGE)) {
      throw new ForbiddenError('Permission denied: leave.holiday.manage required.');
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Holiday list name is required.');
    }
    if (!input.year || input.year < 2000 || input.year > 2100) {
      throw new ValidationError('A valid 4-digit year is required.');
    }

    const pool = poolOverride ?? getAppPool();
    const id = generateUuidV7();

    const created = await withTenant(ctx, async (_tx, client) => {
      // If setting isDefault to true, unset other defaults for the same year
      if (input.isDefault) {
        await client.query(
          `UPDATE holiday_lists SET is_default = false WHERE company_id = $1 AND year = $2`,
          [ctx.companyId, input.year],
        );
      }

      const res = await client.query<HolidayList>(
        `INSERT INTO holiday_lists (
          id, company_id, name, year, location_id, is_default, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, now(), now()
        ) RETURNING *`,
        [
          id,
          ctx.companyId,
          input.name.trim(),
          input.year,
          input.locationId ?? null,
          input.isDefault ?? false,
        ],
      );

      return res.rows[0]!;
    }, pool);

    await this.auditService.recordEvent(ctx, {
      action: 'holiday.list.create',
      entity: 'holiday_lists',
      entityId: created.id,
      after: { name: created.name, year: created.year },
    });

    return created;
  }

  /**
   * Adds an individual holiday to a list.
   */
  async addHoliday(
    ctx: RequestContext,
    listId: string,
    input: AddHolidayInput,
    poolOverride?: pg.Pool,
  ): Promise<Holiday> {
    if (!can(ctx, PERMISSIONS.HOLIDAY_MANAGE)) {
      throw new ForbiddenError('Permission denied: leave.holiday.manage required.');
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Holiday name is required.');
    }
    if (!input.date) {
      throw new ValidationError('Holiday date is required.');
    }

    const pool = poolOverride ?? getAppPool();
    const id = generateUuidV7();

    const created = await withTenant(ctx, async (_tx, client) => {
      // Check list exists
      const listRes = await client.query<HolidayList>(
        `SELECT * FROM holiday_lists WHERE company_id = $1 AND id = $2 LIMIT 1`,
        [ctx.companyId, listId],
      );
      if (!listRes.rows[0]) {
        throw new NotFoundError(`Holiday list ${listId} not found.`);
      }

      const res = await client.query<Holiday>(
        `INSERT INTO holidays (
          id, company_id, list_id, date, name, type, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, now(), now()
        )
        ON CONFLICT (company_id, list_id, date)
        DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, updated_at = now()
        RETURNING *`,
        [
          id,
          ctx.companyId,
          listId,
          input.date,
          input.name.trim(),
          input.type ?? 'public',
        ],
      );

      return res.rows[0]!;
    }, pool);

    await this.auditService.recordEvent(ctx, {
      action: 'holiday.create',
      entity: 'holidays',
      entityId: created.id,
      after: { listId, date: created.date, name: created.name },
    });

    return created;
  }

  /**
   * Lists holidays belonging to a list.
   */
  async listHolidays(
    ctx: RequestContext,
    listId: string,
    poolOverride?: pg.Pool,
  ): Promise<Holiday[]> {
    if (!can(ctx, PERMISSIONS.HOLIDAY_READ)) {
      throw new ForbiddenError('Permission denied: leave.holiday.read required.');
    }

    const pool = poolOverride ?? getAppPool();
    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query<Holiday>(
        `SELECT * FROM holidays
         WHERE company_id = $1 AND list_id = $2
         ORDER BY date ASC`,
        [ctx.companyId, listId],
      );
      return res.rows;
    }, pool);
  }

  /**
   * Resolves all applicable holidays for an employee across a date range.
   * Checks location-specific holiday list first, falls back to default list.
   */
  async resolveHolidaysForEmployee(
    companyId: string,
    locationId: string | null | undefined,
    startDate: string, // 'YYYY-MM-DD'
    endDate: string,   // 'YYYY-MM-DD'
    client: pg.PoolClient | pg.Pool,
  ): Promise<Holiday[]> {
    const res = await client.query<Holiday>(
      `SELECT h.*
       FROM holidays h
       JOIN holiday_lists hl ON hl.company_id = h.company_id AND hl.id = h.list_id
       WHERE h.company_id = $1
         AND (
           ($2::uuid IS NOT NULL AND hl.location_id = $2::uuid)
           OR ($2::uuid IS NULL AND hl.is_default = true)
           OR (hl.is_default = true AND NOT EXISTS (
             SELECT 1 FROM holiday_lists loc_hl
             WHERE loc_hl.company_id = $1 AND loc_hl.location_id = $2::uuid
           ))
         )
         AND h.date >= $3
         AND h.date <= $4
       ORDER BY h.date ASC`,
      [companyId, locationId ?? null, startDate, endDate],
    );

    return res.rows;
  }

  /**
   * Lists holidays for a tenant by year and optional location.
   */
  async listAllHolidays(
    ctx: RequestContext,
    options?: { year?: number; locationId?: string },
    poolOverride?: pg.Pool,
  ): Promise<Holiday[]> {
    if (!ctx.isAuthenticated) {
      throw new ForbiddenError('Authentication required.');
    }
    const pool = poolOverride ?? getAppPool();
    const year = options?.year ?? new Date().getFullYear();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    return withTenant(ctx, async (_tx, client) => {
      return this.resolveHolidaysForEmployee(
        ctx.companyId,
        options?.locationId,
        startDate,
        endDate,
        client,
      );
    }, pool);
  }
}

