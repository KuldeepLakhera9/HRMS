import { and, eq, desc } from 'drizzle-orm';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Database,
  payslips,
  payslipLines,
  employees,
  companies,
  legalEntities,
  payrollYtd,
  Payslip,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { getS3Client, ensureBucketExists } from '../../storage/client.js';
import { generatePayslipPdf, PayslipPdfData } from './generator.js';

const PAYSLIP_BUCKET = 'hrms-payslips';

export interface PayslipItemWithDetails extends Payslip {
  employeeName: string;
  empCode: string;
  department: string | null;
  designation: string | null;
}

export class PayslipPdfService {
  /**
   * Generates a branded payslip PDF, stores it into MinIO, and records the upload.
   */
  async generateAndStorePayslipPdf(
    ctx: RequestContext,
    db: Database,
    payslipId: string,
  ): Promise<{ fileKey: string; bufferSize: number }> {
    // 1. Fetch payslip
    const [ps] = await db
      .select()
      .from(payslips)
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.id, payslipId)));

    if (!ps) {
      throw new NotFoundError('Payslip not found');
    }

    // 2. Fetch lines
    const lines = await db
      .select()
      .from(payslipLines)
      .where(and(eq(payslipLines.companyId, ctx.companyId), eq(payslipLines.payslipId, payslipId)))
      .orderBy(payslipLines.sortOrder);

    // 3. Fetch employee
    const [emp] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.companyId, ctx.companyId), eq(employees.id, ps.employeeId)));

    if (!emp) {
      throw new NotFoundError('Employee record not found for payslip');
    }

    // 4. Fetch company & legal entity
    const [comp] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, ctx.companyId));

    const [legalEntity] = await db
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.companyId, ctx.companyId))
      .limit(1);

    // 5. Fetch YTD records
    const ytdRows = await db
      .select()
      .from(payrollYtd)
      .where(and(eq(payrollYtd.companyId, ctx.companyId), eq(payrollYtd.employeeId, ps.employeeId)));

    let grossYtd = ps.gross;
    let pfYtd = '0.00';
    let tdsYtd = '0.00';

    for (const y of ytdRows) {
      if (y.componentCode === 'GROSS' || y.componentCode === 'BASIC') grossYtd = y.amount;
      if (y.componentCode === 'PF' || y.componentCode === 'PF_EE') pfYtd = y.amount;
      if (y.componentCode === 'TDS') tdsYtd = y.amount;
    }

    const earnings = lines
      .filter(l => l.kind === 'earning' || l.kind === 'reimbursement')
      .map(l => ({ code: l.componentCode, name: l.componentCode, amount: l.amount }));

    const deductions = lines
      .filter(l => l.kind === 'deduction')
      .map(l => ({ code: l.componentCode, name: l.componentCode, amount: l.amount }));

    const snap = (ps.snapshot as Record<string, unknown>) || {};
    const att = (snap.attendance as {
      calendarDays?: number;
      paidDays?: number;
      lopDays?: number;
      weeklyOff?: number;
      holidays?: number;
    }) || {};

    const pdfData: PayslipPdfData = {
      company: {
        name: legalEntity?.name || comp?.name || 'AIC-ADT Innovation Centre',
        pan: legalEntity?.pan || null,
        tan: legalEntity?.tan || null,
      },
      employee: {
        empCode: emp.empCode,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        designation: emp.designationId ? 'Staff Specialist' : 'Employee',
        department: emp.departmentId ? 'Department' : 'General',
        joiningDate: emp.doj ? String(emp.doj) : null,
        pan: (snap?.employee as Record<string, unknown>)?.pan ? String((snap.employee as Record<string, unknown>).pan) : null,
        bankAccountNumber: (snap?.employee as Record<string, unknown>)?.bankAccountNumber
          ? String((snap.employee as Record<string, unknown>).bankAccountNumber)
          : null,
        bankName: 'Scheduled Bank',
      },
      period: ps.period,
      attendance: {
        calendarDays: att.calendarDays ?? 30,
        paidDays: att.paidDays ?? 30,
        lopDays: att.lopDays ?? 0,
        weeklyOff: att.weeklyOff ?? 4,
        holidays: att.holidays ?? 0,
      },
      earnings,
      deductions,
      summary: {
        gross: ps.gross,
        deductions: ps.deductions,
        net: ps.net,
        employerCost: ps.employerCost,
      },
      ytd: {
        grossYtd,
        pfYtd,
        tdsYtd,
      },
      integrityHash: ps.integrityHash,
      generatedAt: new Date(),
    };

    const pdfBuffer = await generatePayslipPdf(pdfData);

    // 6. Ensure bucket and upload to MinIO
    await ensureBucketExists(PAYSLIP_BUCKET);
    const fileKey = `${ctx.companyId}/${ps.period}/${ps.id}.pdf`;
    const s3 = getS3Client();

    await s3.send(
      new PutObjectCommand({
        Bucket: PAYSLIP_BUCKET,
        Key: fileKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        Metadata: {
          companyId: ctx.companyId,
          employeeId: ps.employeeId,
          period: ps.period,
          integrityHash: ps.integrityHash,
        },
      }),
    );

    return { fileKey, bufferSize: pdfBuffer.length };
  }

  /**
   * Generates short-lived signed download URL for employee or finance auditor.
   * Enforces strict IDOR protection.
   */
  async getDownloadUrl(
    ctx: RequestContext,
    db: Database,
    payslipId: string,
    expiresIn = 900, // 15 minutes
  ): Promise<{ downloadUrl: string; fileName: string; integrityHash: string }> {
    const [ps] = await db
      .select({
        id: payslips.id,
        employeeId: payslips.employeeId,
        period: payslips.period,
        integrityHash: payslips.integrityHash,
        paymentStatus: payslips.paymentStatus,
        publishedAt: payslips.publishedAt,
      })
      .from(payslips)
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.id, payslipId)));

    if (!ps) {
      throw new NotFoundError('Payslip not found');
    }

    // IDOR Check:
    // If caller is regular employee, they can ONLY view their own payslip.
    // If caller has PAYROLL_PAYSLIP_VIEW_COMPANY, they can view any payslip within their company.
    const hasCompanyPermission = ctx.permissions?.includes(PERMISSIONS.PAYROLL_PAYSLIP_VIEW_COMPANY);
    const isOwnPayslip = ctx.employeeId === ps.employeeId;

    if (!hasCompanyPermission && !isOwnPayslip) {
      throw new ForbiddenError('Access denied: You are only permitted to view your own payslips');
    }

    // Non-admins cannot view unpublished payslips
    if (!hasCompanyPermission && !ps.publishedAt) {
      throw new ForbiddenError('This payslip has not yet been published by the finance department');
    }

    const fileKey = `${ctx.companyId}/${ps.period}/${ps.id}.pdf`;
    const s3 = getS3Client();

    // Ensure PDF file exists; generate if missing
    try {
      const signedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: PAYSLIP_BUCKET,
          Key: fileKey,
          ResponseContentDisposition: `attachment; filename="Payslip_${ps.period}_${ps.id.slice(0, 8)}.pdf"`,
        }),
        { expiresIn },
      );

      return {
        downloadUrl: signedUrl,
        fileName: `Payslip_${ps.period}_${ps.id.slice(0, 8)}.pdf`,
        integrityHash: ps.integrityHash,
      };
    } catch {
      // Re-generate on the fly if not in bucket
      await this.generateAndStorePayslipPdf(ctx, db, payslipId);
      const signedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: PAYSLIP_BUCKET,
          Key: fileKey,
          ResponseContentDisposition: `attachment; filename="Payslip_${ps.period}_${ps.id.slice(0, 8)}.pdf"`,
        }),
        { expiresIn },
      );

      return {
        downloadUrl: signedUrl,
        fileName: `Payslip_${ps.period}_${ps.id.slice(0, 8)}.pdf`,
        integrityHash: ps.integrityHash,
      };
    }
  }

  /**
   * Reissues a payslip PDF asset (visual refresh / template change)
   * strictly without mutating any underlying financial data.
   */
  async reissuePayslipPdf(
    ctx: RequestContext,
    db: Database,
    payslipId: string,
    _reason?: string,
  ): Promise<{ success: boolean; integrityHash: string }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_PAYSLIP_REISSUE)) {
      throw new ForbiddenError('Permission denied: payroll.payslip.reissue required');
    }

    const [ps] = await db
      .select({ id: payslips.id, integrityHash: payslips.integrityHash })
      .from(payslips)
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.id, payslipId)));

    if (!ps) {
      throw new NotFoundError('Payslip not found');
    }

    await this.generateAndStorePayslipPdf(ctx, db, payslipId);

    return {
      success: true,
      integrityHash: ps.integrityHash,
    };
  }

  /**
   * Lists payslips with keyset pagination and filtering.
   */
  async listPayslips(
    ctx: RequestContext,
    db: Database,
    options: {
      employeeId?: string;
      period?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<PayslipItemWithDetails[]> {
    const hasCompanyView = ctx.permissions?.includes(PERMISSIONS.PAYROLL_PAYSLIP_VIEW_COMPANY);
    const targetEmployeeId = hasCompanyView
      ? options.employeeId || ctx.employeeId
      : ctx.employeeId;

    if (!targetEmployeeId) {
      return [];
    }

    const limit = Math.min(100, Math.max(1, options.limit ?? 20));

    const rows = await db
      .select({
        payslip: payslips,
        firstName: employees.firstName,
        lastName: employees.lastName,
        empCode: employees.empCode,
      })
      .from(payslips)
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(
        and(
          eq(payslips.companyId, ctx.companyId),
          eq(payslips.employeeId, targetEmployeeId),
          options.period ? eq(payslips.period, options.period) : undefined,
        ),
      )
      .orderBy(desc(payslips.period))
      .limit(limit);

    return rows.map(r => ({
      ...r.payslip,
      employeeName: `${r.firstName} ${r.lastName}`.trim(),
      empCode: r.empCode,
      department: null,
      designation: null,
    }));
  }
}
