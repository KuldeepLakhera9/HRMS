import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { requireStepUp } from '../auth/session.js';
import { AuditService } from '../audit/service.js';
import {
  encryptSensitiveField,
  decryptSensitiveField,
  computeBlindIndex,
  maskPan,
  maskAadhaar,
  maskBankAccount,
} from '../employee/crypto.js';
import { CustomFieldService } from '../customfield/service.js';
import { buildDynamicValidator, type CustomFieldDefinitionRecord } from '../customfield/validation.js';
import { parseCsv, generateCsv } from './csv.js';
import {
  BulkRepository,
  type ImportJobRow,
  type EmployeeUpsertRow,
  type ImportRowError,
} from './repository.js';
import { BulkEmployeeRowSchema, type BulkEmployeeRow } from './validation.js';
import { withTenant } from '@hrms/db';

export class BulkService {
  private repository: BulkRepository;
  private auditService: AuditService;
  private customFieldService: CustomFieldService;

  constructor(
    repository?: BulkRepository,
    auditService?: AuditService,
    customFieldService?: CustomFieldService,
  ) {
    this.repository = repository ?? new BulkRepository();
    this.auditService = auditService ?? new AuditService();
    this.customFieldService = customFieldService ?? new CustomFieldService();
  }

  /**
   * Helper to normalize CSV column headers to camelCase keys.
   */
  private normalizeHeader(header: string): string {
    const trimmed = header.trim();
    if (/^[a-z]+[A-Z0-9][a-zA-Z0-9]*$/.test(trimmed)) {
      return trimmed;
    }
    return trimmed
      .replace(/^([A-Z])/, (_, c) => c.toLowerCase())
      .replace(/[\s-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  }

  /**
   * Validates a bulk CSV file and creates a validated import job record.
   */
  async validateImport(
    ctx: RequestContext,
    fileContent: string,
    entity: 'employee' = 'employee',
    poolOverride?: pg.Pool,
  ): Promise<{
    jobId: string;
    totalRows: number;
    validRows: number;
    errorRows: number;
    previewRows: Array<Record<string, unknown>>;
    errors: ImportRowError[];
  }> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_IMPORT)) {
      throw new ForbiddenError('Permission denied: employee.profile.import required.');
    }

    const { headers, rows } = parseCsv(fileContent);
    if (rows.length === 0) {
      throw new ValidationError('CSV file is empty or contains only headers.');
    }

    // Header normalization mapping
    const headerMap = new Map<string, string>();
    for (const h of headers) {
      headerMap.set(h, this.normalizeHeader(h));
    }

    // Fetch custom field definitions and dynamic validator
    const cfDefs = await this.customFieldService.listDefinitions(ctx, entity, poolOverride);
    const cfValidator = buildDynamicValidator(cfDefs);

    const errors: ImportRowError[] = [];
    const validRowsList: Array<{ row: BulkEmployeeRow; customFields: Record<string, unknown> }> = [];
    const previewRows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // 1-indexed, row 1 is header
      const rawRow = rows[i]!;

      // Map raw row fields
      const standardData: Record<string, unknown> = {};
      const customData: Record<string, unknown> = {};

      for (const [rawCol, val] of Object.entries(rawRow)) {
        const normKey = headerMap.get(rawCol) || this.normalizeHeader(rawCol);
        if (normKey.startsWith('cf') || normKey.startsWith('custom')) {
          const cfKey = normKey.replace(/^(cf|custom)[A-Z0-9]?/i, m => m.toLowerCase()).replace(/^cf_?/, '');
          customData[cfKey] = val;
        } else if (cfDefs.some((d: CustomFieldDefinitionRecord) => d.key === rawCol || d.key === normKey)) {
          const match = cfDefs.find((d: CustomFieldDefinitionRecord) => d.key === rawCol || d.key === normKey);
          if (match) {
            customData[match.key] = val;
          }
        } else {
          // Standard employee field mapping
          standardData[normKey] = val || undefined;
        }
      }

      // Validate standard employee data
      const parseRes = BulkEmployeeRowSchema.safeParse(standardData);
      let rowHasError = false;

      if (!parseRes.success) {
        rowHasError = true;
        for (const issue of parseRes.error.issues) {
          errors.push({
            row: rowNum,
            empCode: String(standardData.empCode || ''),
            column: issue.path.join('.'),
            message: issue.message,
            value: issue.path.length > 0 ? (standardData[String(issue.path[0])] ?? '') : '',
          });
        }
      }

      // Validate custom fields
      if (cfDefs.length > 0) {
        const cfRes = cfValidator.safeParse(customData);
        if (!cfRes.success) {
          rowHasError = true;
          for (const issue of cfRes.error.issues) {
            errors.push({
              row: rowNum,
              empCode: String(standardData.empCode || ''),
              column: `custom_field.${issue.path.join('.')}`,
              message: issue.message,
              value: customData[String(issue.path[0])],
            });
          }
        }
      }

      if (!rowHasError && parseRes.success) {
        validRowsList.push({ row: parseRes.data, customFields: customData });
      }

      if (previewRows.length < 50) {
        previewRows.push({
          rowNumber: rowNum,
          ...standardData,
          customFields: customData,
          status: rowHasError ? 'error' : 'valid',
        });
      }
    }

    const totalRows = rows.length;
    const errorRows = new Set(errors.map(e => e.row)).size;
    const validRows = totalRows - errorRows;

    const actorId = ctx.userId || 'system';

    const job = await this.repository.createJob(
      {
        companyId: ctx.companyId,
        actorId,
        entity,
        status: 'validated',
        totalRows,
        validRows,
        errorRows,
        errors,
        summary: {
          previewCount: previewRows.length,
          fieldCount: headers.length,
        },
      },
      poolOverride,
    );

    return {
      jobId: job.id,
      totalRows,
      validRows,
      errorRows,
      previewRows,
      errors,
    };
  }

  /**
   * Confirms and executes batched upsert of validated rows.
   */
  async confirmImport(
    ctx: RequestContext,
    jobId: string,
    fileContent: string,
    poolOverride?: pg.Pool,
  ): Promise<{ success: boolean; processed: number; errors: number }> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_IMPORT)) {
      throw new ForbiddenError('Permission denied: employee.profile.import required.');
    }

    const job = await this.repository.findJobById(ctx.companyId, jobId, poolOverride);
    if (!job) {
      throw new NotFoundError('Import job not found.');
    }

    if (job.status === 'completed') {
      return { success: true, processed: job.validRows, errors: job.errorRows };
    }

    const actorId = ctx.userId || 'system';

    // Set job to processing
    await this.repository.updateJob(
      ctx.companyId,
      jobId,
      { status: 'processing', actorId },
      poolOverride,
    );

    try {
      const { headers, rows } = parseCsv(fileContent);
      const headerMap = new Map<string, string>();
      for (const h of headers) {
        headerMap.set(h, this.normalizeHeader(h));
      }

      const cfDefs = await this.customFieldService.listDefinitions(ctx, 'employee', poolOverride);
      const upsertRows: EmployeeUpsertRow[] = [];

      for (let i = 0; i < rows.length; i++) {
        const rawRow = rows[i]!;
        const standardData: Record<string, unknown> = {};
        const customData: Record<string, unknown> = {};

        for (const [rawCol, val] of Object.entries(rawRow)) {
          const normKey = headerMap.get(rawCol) || this.normalizeHeader(rawCol);
          if (normKey.startsWith('cf') || normKey.startsWith('custom')) {
            const cfKey = normKey.replace(/^(cf|custom)[A-Z0-9]?/i, m => m.toLowerCase()).replace(/^cf_?/, '');
            customData[cfKey] = val;
          } else if (cfDefs.some((d: CustomFieldDefinitionRecord) => d.key === rawCol || d.key === normKey)) {
            const match = cfDefs.find((d: CustomFieldDefinitionRecord) => d.key === rawCol || d.key === normKey);
            if (match) {
              customData[match.key] = val;
            }
          } else {
            standardData[normKey] = val || undefined;
          }
        }

        const parseRes = BulkEmployeeRowSchema.safeParse(standardData);
        if (!parseRes.success) continue;

        const row = parseRes.data;
        const searchKey = `${row.empCode} ${row.firstName} ${row.lastName} ${row.emailWork}`.toLowerCase();

        let panEnc: string | null = null;
        let panBlindIdx: string | null = null;
        let aadhaarEnc: string | null = null;
        let bankEnc: string | null = null;

        if (row.pan) {
          panEnc = encryptSensitiveField(row.pan);
          panBlindIdx = computeBlindIndex(row.pan, ctx.companyId);
        }
        if (row.aadhaar) {
          aadhaarEnc = encryptSensitiveField(row.aadhaar);
        }
        if (row.bankAccount) {
          bankEnc = encryptSensitiveField(row.bankAccount);
        }

        upsertRows.push({
          empCode: row.empCode,
          firstName: row.firstName,
          lastName: row.lastName,
          dob: row.dob || null,
          gender: row.gender || null,
          maritalStatus: row.maritalStatus || null,
          emailWork: row.emailWork,
          emailPersonal: row.emailPersonal || null,
          phone: row.phone || null,
          addresses: {},
          emergencyContacts: [],
          departmentId: row.departmentId || null,
          designationId: row.designationId || null,
          locationId: row.locationId || null,
          managerId: row.managerId || null,
          employmentType: row.employmentType,
          doj: row.doj,
          status: row.status,
          bankEnc,
          panEnc,
          panBlindIdx,
          aadhaarEnc,
          customFields: customData,
          searchKey,
        });
      }

      const res = await this.repository.batchUpsertEmployees(
        ctx.companyId,
        upsertRows,
        actorId,
        500,
        poolOverride,
      );

      await this.repository.updateJob(
        ctx.companyId,
        jobId,
        {
          status: 'completed',
          validRows: res.inserted,
          actorId,
          summary: { completedAt: new Date().toISOString(), processed: res.inserted },
        },
        poolOverride,
      );

      await this.auditService.recordEvent(
        ctx,
        {
          action: 'employee.bulk_import',
          entity: 'import_job',
          entityId: jobId,
          after: { processed: res.inserted, totalRows: job.totalRows },
          poolOverride,
        },
      );

      return { success: true, processed: res.inserted, errors: job.errorRows };
    } catch (err) {
      await this.repository.updateJob(
        ctx.companyId,
        jobId,
        {
          status: 'failed',
          actorId,
          summary: { error: err instanceof Error ? err.message : String(err) },
        },
        poolOverride,
      );
      throw err;
    }
  }

  /**
   * Generates downloadable error CSV for a job.
   */
  async getErrorCsv(
    ctx: RequestContext,
    jobId: string,
    poolOverride?: pg.Pool,
  ): Promise<string> {
    const job = await this.repository.findJobById(ctx.companyId, jobId, poolOverride);
    if (!job) {
      throw new NotFoundError('Import job not found.');
    }

    const headers = ['RowNumber', 'EmployeeCode', 'Column', 'ErrorMessage', 'Value'];
    const rows = (job.errors || []).map(e => ({
      RowNumber: e.row,
      EmployeeCode: e.empCode || '',
      Column: e.column || '',
      ErrorMessage: e.message,
      Value: e.value !== undefined ? String(e.value) : '',
    }));

    return generateCsv(headers, rows);
  }

  /**
   * Exports employees to CSV with masked sensitive data unless permitted with step-up.
   */
  async exportEmployeesCsv(
    ctx: RequestContext,
    options: { includeSensitive?: boolean } = {},
    poolOverride?: pg.Pool,
  ): Promise<string> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_EXPORT)) {
      throw new ForbiddenError('Permission denied: employee.profile.export required.');
    }

    let revealSensitive = false;
    if (options.includeSensitive) {
      if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE)) {
        throw new ForbiddenError('Permission denied: employee.profile.view_sensitive required for sensitive export.');
      }
      requireStepUp(ctx);
      revealSensitive = true;
    }

    const rows = await withTenant(
      { companyId: ctx.companyId },
      async (_tx, client) => {
        const res = await client.query<{
          empCode: string;
          firstName: string;
          lastName: string;
          emailWork: string;
          phone: string | null;
          gender: string | null;
          dob: string | null;
          doj: string;
          status: string;
          employmentType: string;
          departmentName: string | null;
          designationName: string | null;
          locationName: string | null;
          panEnc: string | null;
          aadhaarEnc: string | null;
          bankEnc: string | null;
          customFields: Record<string, unknown>;
        }>(
          `SELECT
             e.emp_code as "empCode", e.first_name as "firstName", e.last_name as "lastName",
             e.email_work as "emailWork", e.phone, e.gender, e.dob, e.doj, e.status,
             e.employment_type as "employmentType",
             d.name as "departmentName", des.name as "designationName", loc.name as "locationName",
             e.pan_enc as "panEnc", e.aadhaar_enc as "aadhaarEnc", e.bank_enc as "bankEnc",
             e.custom_fields as "customFields"
           FROM employees e
           LEFT JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id AND d.deleted_at IS NULL
           LEFT JOIN designations des ON des.company_id = e.company_id AND des.id = e.designation_id AND des.deleted_at IS NULL
           LEFT JOIN locations loc ON loc.company_id = e.company_id AND loc.id = e.location_id AND loc.deleted_at IS NULL
           WHERE e.company_id = $1 AND e.deleted_at IS NULL
           ORDER BY e.emp_code ASC`,
          [ctx.companyId],
        );
        return res.rows;
      },
      poolOverride,
    );

    const headers = [
      'empCode',
      'firstName',
      'lastName',
      'emailWork',
      'phone',
      'gender',
      'dob',
      'doj',
      'status',
      'employmentType',
      'department',
      'designation',
      'location',
      'pan',
      'aadhaar',
      'bankAccount',
    ];

    const exportData = rows.map(emp => {
      let pan = '';
      let aadhaar = '';
      let bank = '';

      if (emp.panEnc) {
        try {
          const dec = decryptSensitiveField(emp.panEnc);
          pan = revealSensitive ? dec : (maskPan(dec) ?? 'XXXX');
        } catch {
          pan = 'XXXX';
        }
      }

      if (emp.aadhaarEnc) {
        try {
          const dec = decryptSensitiveField(emp.aadhaarEnc);
          aadhaar = revealSensitive ? dec : (maskAadhaar(dec) ?? 'XXXX');
        } catch {
          aadhaar = 'XXXX';
        }
      }

      if (emp.bankEnc) {
        try {
          const dec = decryptSensitiveField(emp.bankEnc);
          bank = revealSensitive ? dec : (maskBankAccount(dec) ?? 'XXXX');
        } catch {
          bank = 'XXXX';
        }
      }

      return {
        empCode: emp.empCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        emailWork: emp.emailWork,
        phone: emp.phone || '',
        gender: emp.gender || '',
        dob: emp.dob || '',
        doj: emp.doj,
        status: emp.status,
        employmentType: emp.employmentType,
        department: emp.departmentName || '',
        designation: emp.designationName || '',
        location: emp.locationName || '',
        pan,
        aadhaar,
        bankAccount: bank,
      };
    });

    await this.auditService.recordEvent(
      ctx,
      {
        action: 'employee.export',
        entity: 'employee',
        entityId: ctx.companyId,
        after: {
          exportedCount: exportData.length,
          revealedSensitive: revealSensitive,
        },
        poolOverride,
      },
    );

    return generateCsv(headers, exportData);
  }

  async getJob(
    ctx: RequestContext,
    jobId: string,
    poolOverride?: pg.Pool,
  ): Promise<ImportJobRow> {
    const job = await this.repository.findJobById(ctx.companyId, jobId, poolOverride);
    if (!job) {
      throw new NotFoundError('Import job not found.');
    }
    return job;
  }
}
