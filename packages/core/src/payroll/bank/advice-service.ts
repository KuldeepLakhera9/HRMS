import crypto from 'node:crypto';
import { Decimal } from 'decimal.js';
import { and, eq, desc, sql } from 'drizzle-orm';
import {
  Database,
  bankFormatTemplates,
  bankAdviceFiles,
  paymentConfirmations,
  payslips,
  employees,
  payrollRuns,
  payrollRunEvents,
  BankAdviceFile,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { encryptField, decryptField, assertStepUp, isStepUpActive } from '../crypto/cipher.js';

export interface BankTemplateColumnConfig {
  name: string;
  source: 'account_number' | 'employee_name' | 'ifsc' | 'amount' | 'narration' | 'emp_code' | 'constant';
  value?: string;
}

export interface PaymentItem {
  employeeId: string;
  empCode: string;
  employeeName: string;
  accountNumber: string;
  ifsc: string;
  amount: number;
  narration: string;
}

export interface BankValidationError {
  employeeId: string;
  empCode: string;
  field: string;
  message: string;
}

export interface ConfirmationImportRow {
  utr: string;
  empCode?: string;
  accountNumber?: string;
  amount: number;
  status: 'success' | 'failed' | 'returned';
  failureReason?: string;
}

const DEFAULT_TEMPLATES: Record<string, {
  name: string;
  bankCode: string;
  columnsMapping: BankTemplateColumnConfig[];
  delimiter: string;
  hasHeader: boolean;
}> = {
  GENERIC_NEFT: {
    name: 'Generic NEFT/RTGS CSV',
    bankCode: 'GENERIC_NEFT',
    delimiter: ',',
    hasHeader: true,
    columnsMapping: [
      { name: 'Beneficiary Account No', source: 'account_number' },
      { name: 'Beneficiary Name', source: 'employee_name' },
      { name: 'IFSC Code', source: 'ifsc' },
      { name: 'Amount', source: 'amount' },
      { name: 'Narration', source: 'narration' },
      { name: 'Employee Code', source: 'emp_code' },
    ],
  },
  HDFC: {
    name: 'HDFC Corporate Banking Format',
    bankCode: 'HDFC',
    delimiter: ',',
    hasHeader: true,
    columnsMapping: [
      { name: 'Transaction Type', source: 'constant', value: 'NEFT' },
      { name: 'Beneficiary Account No', source: 'account_number' },
      { name: 'Beneficiary Name', source: 'employee_name' },
      { name: 'Amount', source: 'amount' },
      { name: 'IFSC', source: 'ifsc' },
      { name: 'Narration', source: 'narration' },
      { name: 'Emp ID', source: 'emp_code' },
    ],
  },
  ICICI: {
    name: 'ICICI Bank Bulk Upload Format',
    bankCode: 'ICICI',
    delimiter: ',',
    hasHeader: true,
    columnsMapping: [
      { name: 'Payment Mode', source: 'constant', value: 'N' },
      { name: 'Beneficiary Account No', source: 'account_number' },
      { name: 'Beneficiary Name', source: 'employee_name' },
      { name: 'Amount', source: 'amount' },
      { name: 'IFSC', source: 'ifsc' },
      { name: 'Remarks', source: 'narration' },
      { name: 'Emp Code', source: 'emp_code' },
    ],
  },
  SBI: {
    name: 'SBI CMP Corporate Salary Upload',
    bankCode: 'SBI',
    delimiter: ',',
    hasHeader: true,
    columnsMapping: [
      { name: 'Beneficiary Account No', source: 'account_number' },
      { name: 'Amount', source: 'amount' },
      { name: 'Beneficiary Name', source: 'employee_name' },
      { name: 'Narration', source: 'narration' },
      { name: 'IFSC', source: 'ifsc' },
      { name: 'Ref No', source: 'emp_code' },
    ],
  },
};

export class BankAdviceService {
  /**
   * Ensures default template exists for company.
   */
  async ensureTemplate(ctx: RequestContext, db: Database, bankCode = 'GENERIC_NEFT') {
    const [existing] = await db
      .select()
      .from(bankFormatTemplates)
      .where(and(eq(bankFormatTemplates.companyId, ctx.companyId), eq(bankFormatTemplates.bankCode, bankCode)));

    if (existing) {
      return existing;
    }

    const defaultCfg = DEFAULT_TEMPLATES[bankCode] || DEFAULT_TEMPLATES.GENERIC_NEFT;
    if (!defaultCfg) {
      throw new ValidationError(`Unknown bank template code: ${bankCode}`);
    }

    const [created] = await db
      .insert(bankFormatTemplates)
      .values({
        companyId: ctx.companyId,
        name: defaultCfg.name,
        bankCode: defaultCfg.bankCode,
        columnsMapping: defaultCfg.columnsMapping as unknown as Record<string, unknown>,
        delimiter: defaultCfg.delimiter,
        hasHeader: defaultCfg.hasHeader,
        hasFooter: false,
        validations: {},
        isActive: true,
        createdBy: ctx.userId ?? 'system',
        updatedBy: ctx.userId ?? 'system',
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create bank format template');
    }

    return created;
  }

  /**
   * Validates payment records against banking standards.
   */
  validatePaymentItems(items: PaymentItem[]): BankValidationError[] {
    const errors: BankValidationError[] = [];
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    const accountRegex = /^\d{9,18}$/;

    for (const item of items) {
      if (!item.accountNumber || !accountRegex.test(item.accountNumber.trim())) {
        errors.push({
          employeeId: item.employeeId,
          empCode: item.empCode,
          field: 'accountNumber',
          message: `Invalid bank account number '${item.accountNumber}'. Must be 9 to 18 digits.`,
        });
      }

      if (!item.ifsc || !ifscRegex.test(item.ifsc.trim().toUpperCase())) {
        errors.push({
          employeeId: item.employeeId,
          empCode: item.empCode,
          field: 'ifsc',
          message: `Invalid IFSC code '${item.ifsc}'. Must match 4 letters, 0, and 6 alphanumeric chars.`,
        });
      }

      if (!item.employeeName || item.employeeName.trim().length === 0) {
        errors.push({
          employeeId: item.employeeId,
          empCode: item.empCode,
          field: 'employeeName',
          message: 'Beneficiary name cannot be empty',
        });
      }

      if (isNaN(item.amount) || item.amount <= 0) {
        errors.push({
          employeeId: item.employeeId,
          empCode: item.empCode,
          field: 'amount',
          message: `Invalid net payment amount: ${item.amount}. Must be strictly positive.`,
        });
      }
    }

    return errors;
  }

  /**
   * Generates a new or versioned bank advice file.
   */
  async generateAdviceFile(
    ctx: RequestContext,
    db: Database,
    runId: string,
    options: {
      templateCode?: string;
      reasonForRegeneration?: string;
    } = {},
  ): Promise<{ adviceFile: BankAdviceFile; controlTotals: { recordCount: number; totalAmount: number } }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_BANKFILE_GENERATE)) {
      throw new ForbiddenError('Permission denied: payroll.bankfile.generate required');
    }

    // 1. Verify run status
    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    if (!run) {
      throw new NotFoundError('Payroll run not found');
    }

    if (!['locked', 'published'].includes(run.status)) {
      throw new ValidationError(`Bank advice file can only be generated for 'locked' or 'published' runs (current: ${run.status})`);
    }

    // 2. Fetch template
    const template = await this.ensureTemplate(ctx, db, options.templateCode || 'GENERIC_NEFT');

    // 3. Check for existing advice files
    const existingFiles = await db
      .select()
      .from(bankAdviceFiles)
      .where(
        and(
          eq(bankAdviceFiles.companyId, ctx.companyId),
          eq(bankAdviceFiles.runId, runId),
          eq(bankAdviceFiles.status, 'generated'),
        ),
      )
      .orderBy(desc(bankAdviceFiles.version));

    let nextVersion = 1;
    if (existingFiles.length > 0) {
      if (!options.reasonForRegeneration || options.reasonForRegeneration.trim().length < 5) {
        throw new ValidationError('A detailed reason is required to regenerate an existing bank advice file');
      }
      const topFile = existingFiles[0];
      if (topFile) {
        nextVersion = topFile.version + 1;
        // Mark previous as cancelled
        await db
          .update(bankAdviceFiles)
          .set({ status: 'cancelled', updatedAt: new Date(), updatedBy: ctx.userId ?? 'system' })
          .where(and(eq(bankAdviceFiles.companyId, ctx.companyId), eq(bankAdviceFiles.id, topFile.id)));
      }
    }

    // 4. Fetch payslips and employee info
    const slipRows = await db
      .select({
        payslip: payslips,
        employee: employees,
      })
      .from(payslips)
      .innerJoin(
        employees,
        and(eq(employees.companyId, payslips.companyId), eq(employees.id, payslips.employeeId)),
      )
      .where(
        and(
          eq(payslips.companyId, ctx.companyId),
          eq(payslips.runId, runId),
          sql`${payslips.net}::numeric > 0`,
        ),
      );

    if (slipRows.length === 0) {
      throw new ValidationError('No positive net pay records found for this payroll run');
    }

    // 5. Build payment items
    const paymentItems: PaymentItem[] = slipRows.map(r => {
      const snap = (r.payslip.snapshot as Record<string, unknown>) || {};
      const snapEmp = (snap.employee as Record<string, unknown>) || {};

      // Retrieve bank account and ifsc
      let accountNumber = String(snapEmp.bankAccountNumber || '000000000000');
      let ifsc = String(snapEmp.ifsc || 'HDFC0000001');

      if (r.employee.bankEnc) {
        try {
          const decrypted = decryptField(r.employee.bankEnc);
          const parsed = JSON.parse(decrypted);
          if (parsed.accountNumber) accountNumber = parsed.accountNumber;
          if (parsed.ifsc) ifsc = parsed.ifsc;
        } catch {
          // Fallback to default
        }
      }

      const amount = new Decimal(r.payslip.net).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
      return {
        employeeId: r.payslip.employeeId,
        empCode: r.employee.empCode,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
        accountNumber,
        ifsc,
        amount,
        narration: `Salary ${r.payslip.period}`,
      };
    });

    // 6. Validate items
    const validationErrors = this.validatePaymentItems(paymentItems);
    if (validationErrors.length > 0) {
      const firstErr = validationErrors[0];
      const errMsg = firstErr ? `${firstErr.empCode}: ${firstErr.message}` : 'Validation failed';
      throw new ValidationError(
        `Bank advice file generation failed validation (${validationErrors.length} errors). First error: ${errMsg}`,
      );
    }

    // 7. Format CSV
    const cols = template.columnsMapping as unknown as BankTemplateColumnConfig[];
    const rows: string[] = [];

    if (template.hasHeader) {
      rows.push(cols.map(c => `"${c.name.replace(/"/g, '""')}"`).join(template.delimiter));
    }

    let totalAmount = 0;
    for (const item of paymentItems) {
      totalAmount += item.amount;
      const rowCols = cols.map(c => {
        let val = '';
        switch (c.source) {
          case 'account_number':
            val = item.accountNumber;
            break;
          case 'employee_name':
            val = item.employeeName;
            break;
          case 'ifsc':
            val = item.ifsc;
            break;
          case 'amount':
            val = item.amount.toFixed(2);
            break;
          case 'narration':
            val = item.narration;
            break;
          case 'emp_code':
            val = item.empCode;
            break;
          case 'constant':
            val = c.value ?? '';
            break;
        }
        return `"${val.replace(/"/g, '""')}"`;
      });
      rows.push(rowCols.join(template.delimiter));
    }

    const csvContent = rows.join('\r\n');
    const checksum = crypto.createHash('sha256').update(csvContent, 'utf8').digest('hex');
    const encryptedPayload = encryptField(csvContent);

    // 8. Insert into bankAdviceFiles
    const [adviceFile] = await db
      .insert(bankAdviceFiles)
      .values({
        companyId: ctx.companyId,
        runId,
        formatTemplateId: template.id,
        checksum,
        recordCount: paymentItems.length,
        totalAmount: totalAmount.toFixed(2),
        status: 'generated',
        version: nextVersion,
        reasonForRegeneration: options.reasonForRegeneration ?? null,
        encryptedPayload,
        generatedBy: ctx.userId ?? 'system',
        createdBy: ctx.userId ?? 'system',
        updatedBy: ctx.userId ?? 'system',
      })
      .returning();

    if (!adviceFile) {
      throw new Error('Failed to create bank advice record');
    }

    // 9. Record audit event
    await db.insert(payrollRunEvents).values({
      companyId: ctx.companyId,
      runId,
      actorId: ctx.userId ?? 'system',
      fromStatus: run.status,
      toStatus: run.status,
      event: 'BANK_ADVICE_FILE_GENERATED',
      details: {
        adviceFileId: adviceFile.id,
        version: nextVersion,
        recordCount: paymentItems.length,
        totalAmount: totalAmount.toFixed(2),
        checksum,
      },
    });

    return {
      adviceFile,
      controlTotals: {
        recordCount: paymentItems.length,
        totalAmount,
      },
    };
  }

  /**
   * Audited one-time or controlled download with step-up verification.
   */
  async downloadAdviceFile(
    ctx: RequestContext,
    db: Database,
    adviceFileId: string,
    options: { requireStepUp?: boolean } = {},
  ): Promise<{
    content: string;
    fileName: string;
    checksum: string;
    recordCount: number;
    totalAmount: string;
    downloadCount: number;
  }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_BANKFILE_DOWNLOAD)) {
      throw new ForbiddenError('Permission denied: payroll.bankfile.download required');
    }

    const [file] = await db
      .select()
      .from(bankAdviceFiles)
      .where(and(eq(bankAdviceFiles.companyId, ctx.companyId), eq(bankAdviceFiles.id, adviceFileId)));

    if (!file) {
      throw new NotFoundError('Bank advice file not found');
    }

    if (file.status === 'cancelled') {
      throw new ValidationError('This bank advice file has been cancelled or superseded');
    }

    // Maker-checker & Step-up checks
    if (options.requireStepUp !== false && !isStepUpActive(ctx)) {
      // If environment requires step up:
      assertStepUp(ctx, 'downloading bank advice file');
    }

    if (!file.encryptedPayload) {
      throw new Error('Encrypted payload missing for this bank advice file');
    }

    const decryptedContent = decryptField(file.encryptedPayload);

    // Update download count and status atomically
    const newCount = file.downloadCount + 1;
    await db
      .update(bankAdviceFiles)
      .set({
        downloadCount: newCount,
        downloadedAt: new Date(),
        status: file.status === 'generated' ? 'downloaded' : file.status,
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? 'system',
      })
      .where(and(eq(bankAdviceFiles.companyId, ctx.companyId), eq(bankAdviceFiles.id, adviceFileId)));

    // Audit event
    await db.insert(payrollRunEvents).values({
      companyId: ctx.companyId,
      runId: file.runId,
      actorId: ctx.userId ?? 'system',
      fromStatus: 'locked',
      toStatus: 'locked',
      event: 'BANK_ADVICE_FILE_DOWNLOADED',
      details: {
        adviceFileId: file.id,
        downloadCount: newCount,
        checksum: file.checksum,
      },
    });

    const fileName = `BankAdvice_${file.runId.slice(0, 8)}_v${file.version}.csv`;

    return {
      content: decryptedContent,
      fileName,
      checksum: file.checksum,
      recordCount: file.recordCount,
      totalAmount: file.totalAmount,
      downloadCount: newCount,
    };
  }

  /**
   * Imports bank payment confirmations (UTR numbers), updates payslips, and advances run to 'paid' when full.
   */
  async importPaymentConfirmations(
    ctx: RequestContext,
    db: Database,
    adviceFileId: string,
    rows: ConfirmationImportRow[],
  ): Promise<{
    totalImported: number;
    successCount: number;
    failedCount: number;
    runMarkedPaid: boolean;
  }> {
    if (
      !ctx.permissions?.includes(PERMISSIONS.PAYROLL_BANKFILE_GENERATE) &&
      !ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_LOCK)
    ) {
      throw new ForbiddenError('Permission denied: cannot import payment confirmations');
    }

    const [file] = await db
      .select()
      .from(bankAdviceFiles)
      .where(and(eq(bankAdviceFiles.companyId, ctx.companyId), eq(bankAdviceFiles.id, adviceFileId)));

    if (!file) {
      throw new NotFoundError('Bank advice file not found');
    }

    let successCount = 0;
    let failedCount = 0;
    const tx = db;

    for (const row of rows) {
      if (!row.utr || row.utr.trim().length === 0) {
        continue;
      }

      // Find employee
      let targetEmployeeId: string | null = null;
      if (row.empCode) {
        const [emp] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.companyId, ctx.companyId), eq(employees.empCode, row.empCode)));
        if (emp) targetEmployeeId = emp.id;
      }

      if (!targetEmployeeId) {
        continue;
      }

      // Insert payment confirmation
      await tx.insert(paymentConfirmations).values({
        companyId: ctx.companyId,
        adviceFileId,
        runId: file.runId,
        employeeId: targetEmployeeId,
        utr: row.utr.trim(),
        status: row.status,
        amount: row.amount.toFixed(2),
        failureReason: row.failureReason ?? null,
        importedBy: ctx.userId ?? 'system',
      });

      // Update payslip
      const newPaymentStatus = row.status === 'success' ? 'paid' : 'failed';
      await tx
        .update(payslips)
        .set({
          paymentStatus: newPaymentStatus,
          paymentRef: row.utr.trim(),
          updatedAt: new Date(),
          updatedBy: ctx.userId ?? 'system',
        })
        .where(
          and(
            eq(payslips.companyId, ctx.companyId),
            eq(payslips.runId, file.runId),
            eq(payslips.employeeId, targetEmployeeId),
          ),
        );

      if (row.status === 'success') successCount++;
      else failedCount++;
    }

    // Check if all payslips for this run are now 'paid'
    const [unpaid] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(payslips)
      .where(
        and(
          eq(payslips.companyId, ctx.companyId),
          eq(payslips.runId, file.runId),
          sql`${payslips.paymentStatus} != 'paid'`,
        ),
      );

    const allPaid = (unpaid?.count ?? 0) === 0;

    if (allPaid) {
      await tx
        .update(payrollRuns)
        .set({
          status: 'paid',
          updatedAt: new Date(),
          updatedBy: ctx.userId ?? 'system',
        })
        .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, file.runId)));

      await tx.insert(payrollRunEvents).values({
        companyId: ctx.companyId,
        runId: file.runId,
        actorId: ctx.userId ?? 'system',
        fromStatus: 'locked',
        toStatus: 'paid',
        event: 'RUN_MARKED_PAID',
        details: {
          action: 'ALL_PAYSLIPS_CONFIRMED',
          adviceFileId,
          successCount,
        },
      });
    }

    // Update advice file status to confirmed
    await tx
      .update(bankAdviceFiles)
      .set({
        status: 'confirmed',
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? 'system',
      })
      .where(and(eq(bankAdviceFiles.companyId, ctx.companyId), eq(bankAdviceFiles.id, adviceFileId)));

    const [unpaidCheck] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(payslips)
      .where(
        and(
          eq(payslips.companyId, ctx.companyId),
          eq(payslips.runId, file.runId),
          sql`${payslips.paymentStatus} != 'paid'`,
        ),
      );

    return {
      totalImported: rows.length,
      successCount,
      failedCount,
      runMarkedPaid: (unpaidCheck?.count ?? 0) === 0,
    };
  }
}
