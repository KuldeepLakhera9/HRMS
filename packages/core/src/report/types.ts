import type pg from 'pg';
import type { ZodSchema } from 'zod';
import type { RequestContext } from '../routing/context.js';

export interface ReportColumnDef {
  key: string;
  header: string;
  type: 'string' | 'number' | 'date' | 'badge' | 'minutes';
  align?: 'left' | 'center' | 'right';
  format?: string;
}

export type ReportScope = 'self' | 'team' | 'department' | 'company';

export interface ReportDefinition<TFilters = Record<string, unknown>> {
  key: string;
  title: string;
  description: string;
  category: 'attendance' | 'leave' | 'headcount' | 'organization';
  permission: string;
  filtersSchema: ZodSchema<TFilters>;
  columns: ReportColumnDef[];
  scopes: ReportScope[];
  maxDateRangeDays?: number;
  builder: (
    ctx: RequestContext,
    filters: TFilters,
    client: pg.PoolClient | pg.Pool,
    pagination?: { limit?: number; offset?: number }
  ) => Promise<{ rows: Record<string, unknown>[]; totalCount: number }>;
  exports: ('csv' | 'xlsx')[];
}

export interface ReportPreviewResult {
  key: string;
  title: string;
  description: string;
  columns: ReportColumnDef[];
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface ReportExportResult {
  runId: string;
  reportKey: string;
  status: 'done' | 'queued' | 'failed';
  rows: number;
  downloadUrl?: string;
  expiresIn?: number;
  fileName: string;
  durationMs: number;
}
