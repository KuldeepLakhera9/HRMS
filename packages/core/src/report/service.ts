import { createHash } from 'node:crypto';
import type pg from 'pg';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '@hrms/config';
import { getAppPool, withTenant, generateUuidV7 } from '@hrms/db';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { createChildLogger } from '../logger/index.js';
import { AuditService } from '../audit/service.js';
import { getS3Client, ensureBucketExists } from '../storage/client.js';
import { ReportRegistry } from './registry.js';
import type {
  ReportDefinition,
  ReportPreviewResult,
  ReportExportResult,
} from './types.js';

const logger = createChildLogger({ module: 'report:service' });

export class ReportService {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Lists all reports available to the calling context based on permissions.
   */
  async listReports(ctx: RequestContext): Promise<Array<{
    key: string;
    title: string;
    description: string;
    category: string;
    scopes: string[];
    exports: string[];
  }>> {
    const all = ReportRegistry.getAll();
    return all
      .filter(r => can(ctx, r.permission))
      .map(r => ({
        key: r.key,
        title: r.title,
        description: r.description,
        category: r.category,
        scopes: r.scopes,
        exports: r.exports,
      }));
  }

  /**
   * Fetches report definition.
   */
  getReportDefinition(reportKey: string): ReportDefinition {
    const def = ReportRegistry.get(reportKey);
    if (!def) {
      throw new NotFoundError(`Report '${reportKey}' not found in registry`);
    }
    return def;
  }

  /**
   * Generates synchronous preview (paged JSON, up to 5000 rows).
   */
  async preview(
    ctx: RequestContext,
    reportKey: string,
    filters: Record<string, unknown>,
    pagination?: { page?: number; pageSize?: number },
    pool?: pg.Pool
  ): Promise<ReportPreviewResult> {
    const def = this.getReportDefinition(reportKey);

    if (!can(ctx, def.permission)) {
      throw new ForbiddenError(`Permission denied to run report '${reportKey}'`);
    }

    // Validate filters against the report's Zod schema
    const parseResult = def.filtersSchema.safeParse(filters);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0]?.message || 'Invalid report filters';
      throw new ValidationError(issue);
    }
    const validatedFilters = parseResult.data;

    const page = pagination?.page ?? 1;
    const pageSize = Math.min(pagination?.pageSize ?? 50, 5000);
    const offset = (page - 1) * pageSize;

    return withTenant(ctx, async (_tx, client) => {
      const { rows, totalCount } = await def.builder(ctx, validatedFilters, client, {
        limit: pageSize,
        offset,
      });

      return {
        key: def.key,
        title: def.title,
        description: def.description,
        columns: def.columns,
        rows,
        totalCount,
        page,
        pageSize,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Asynchronous or streamed export of full dataset to MinIO with a signed URL.
   */
  async export(
    ctx: RequestContext,
    reportKey: string,
    filters: Record<string, unknown>,
    format: 'csv' | 'xlsx' = 'csv',
    pool?: pg.Pool
  ): Promise<ReportExportResult> {
    const def = this.getReportDefinition(reportKey);

    if (!can(ctx, PERMISSIONS.REPORT_EXPORT) || !can(ctx, def.permission)) {
      throw new ForbiddenError(`Permission denied to export report '${reportKey}'`);
    }

    const parseResult = def.filtersSchema.safeParse(filters);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0]?.message || 'Invalid report filters';
      throw new ValidationError(issue);
    }
    const validatedFilters = parseResult.data;

    const startTime = Date.now();
    const runId = generateUuidV7();
    const env = getEnv();
    const bucket = env.MINIO_BUCKET_EXPORTS;

    return withTenant(ctx, async (_tx, client) => {
      // 1. Fetch rows in chunks and stream formatted CSV
      const chunkSize = 5000;
      let offset = 0;
      let totalRows = 0;
      const chunks: Buffer[] = [];

      const headers = def.columns.map(c => `"${c.header.replace(/"/g, '""')}"`).join(',') + '\r\n';
      chunks.push(Buffer.from(headers, 'utf-8'));

      while (true) {
        const { rows, totalCount } = await def.builder(ctx, validatedFilters, client, {
          limit: chunkSize,
          offset,
        });

        if (!rows || rows.length === 0) break;
        totalRows += rows.length;

        const chunkCsv = this.formatCsvRows(def.columns, rows);
        chunks.push(Buffer.from(chunkCsv + '\r\n', 'utf-8'));

        offset += rows.length;
        if (totalCount !== undefined && offset >= totalCount) break;
        if (rows.length < chunkSize) break;
      }

      const fileBuffer = Buffer.concat(chunks);
      const objectKey = `reports/${ctx.companyId}/${def.key}-${Date.now()}.${format}`;
      const fileName = `${def.key}-${new Date().toISOString().slice(0, 10)}.${format}`;

      // 2. Upload to MinIO
      const s3 = getS3Client();
      await ensureBucketExists(bucket);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: fileBuffer,
          ContentType: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          Metadata: {
            companyId: ctx.companyId,
            reportKey: def.key,
            requestedBy: ctx.userId || '',
          },
        })
      );

      // 3. Generate 15-minute presigned download URL
      const downloadUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          ResponseContentDisposition: `attachment; filename="${fileName}"`,
        }),
        { expiresIn: 900 }
      );

      const durationMs = Date.now() - startTime;
      const paramsHash = createHash('sha256').update(JSON.stringify(validatedFilters)).digest('hex');

      // 4. Insert record into report_runs
      await client.query(
        `INSERT INTO report_runs (
          id, company_id, report_key, params, params_hash, requested_by,
          status, rows, duration_ms, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          runId,
          ctx.companyId,
          def.key,
          JSON.stringify(validatedFilters),
          paramsHash,
          ctx.userId,
          'done',
          totalRows,
          durationMs,
          ctx.userId,
          ctx.userId,
        ]
      );

      // 5. Audit log entry
      await this.auditService.recordEvent(
        ctx,
        {
          action: 'report.export',
          entity: 'report',
          entityId: runId,
          before: null,
          after: {
            reportKey: def.key,
            rows: totalRows,
            format,
            durationMs,
          },
          clientOverride: client as pg.PoolClient,
        }
      );

      logger.info(
        { reportKey: def.key, runId, rows: totalRows, durationMs },
        'Report successfully exported and stored in MinIO'
      );

      return {
        runId,
        reportKey: def.key,
        status: 'done',
        rows: totalRows,
        downloadUrl,
        expiresIn: 900,
        fileName,
        durationMs,
      };
    }, pool ?? getAppPool());
  }

  /**
   * Lists historical report runs for the company.
   */
  async listRuns(ctx: RequestContext, pool?: pg.Pool): Promise<Array<Record<string, unknown>>> {
    if (!can(ctx, PERMISSIONS.REPORT_RUN)) {
      throw new ForbiddenError('Permission denied to view report runs');
    }

    return withTenant(ctx, async (_tx, client) => {
      const res = await client.query(
        `SELECT 
          r.id,
          r.report_key AS "reportKey",
          r.params,
          r.status,
          r.rows,
          r.duration_ms AS "durationMs",
          r.error,
          r.created_at AS "createdAt",
          u.email AS "requestedByEmail"
        FROM report_runs r
        JOIN users u ON u.company_id = r.company_id AND u.id = r.requested_by
        WHERE r.company_id = $1
        ORDER BY r.created_at DESC
        LIMIT 50`,
        [ctx.companyId]
      );
      return res.rows;
    }, pool ?? getAppPool());
  }

  /**
   * Helper to format rows into CSV chunk lines without header.
   */
  private formatCsvRows(columns: Array<{ key: string; header: string }>, rows: Record<string, unknown>[]): string {
    return rows.map(row => {
      return columns
        .map(c => {
          const val = row[c.key];
          if (val === null || val === undefined) {
            return '""';
          }
          const str = String(val);
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(',');
    }).join('\r\n');
  }
}
