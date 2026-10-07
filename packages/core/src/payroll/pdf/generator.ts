import PDFDocument from 'pdfkit';
import { formatIndianGrouping, numberToIndianWords } from '@hrms/shared';

export interface PayslipPdfData {
  company: {
    name: string;
    pan?: string | null;
    tan?: string | null;
    address?: string | null;
  };
  employee: {
    empCode: string;
    name: string;
    designation?: string | null;
    department?: string | null;
    location?: string | null;
    joiningDate?: string | null;
    pan?: string | null;
    uan?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    ifsc?: string | null;
  };
  period: string; // 'YYYY-MM'
  attendance: {
    calendarDays: number;
    paidDays: number;
    lopDays: number;
    weeklyOff?: number;
    holidays?: number;
  };
  earnings: Array<{ code: string; name: string; amount: string }>;
  deductions: Array<{ code: string; name: string; amount: string }>;
  summary: {
    gross: string;
    deductions: string;
    net: string;
    employerCost?: string;
  };
  ytd?: {
    grossYtd?: string;
    pfYtd?: string;
    tdsYtd?: string;
  };
  integrityHash: string;
  generatedAt?: Date;
}

/**
 * Mask bank account number to show only last 4 digits.
 */
function maskAccountNumber(acc?: string | null): string {
  if (!acc) return 'N/A';
  const clean = acc.trim();
  if (clean.length <= 4) return clean;
  return `**** **** ${clean.slice(-4)}`;
}

/**
 * Pure-JS streaming payslip PDF generator complying with AIC-ADT design system branding.
 * Benchmark target: >= 20 payslips/sec throughput.
 */
export async function generatePayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 30,
        info: {
          Title: `Payslip - ${data.employee.empCode} - ${data.period}`,
          Author: data.company.name || 'HRMS Platform',
          Subject: 'Monthly Compensation & Tax Statement',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const pageWidth = 535; // 595 - 60 margins
      let y = 30;

      // 1. BRAND HEADER STRIP (AIC-ADT Deep Forest Green #004B2A)
      doc.rect(30, y, pageWidth, 55).fill('#004B2A');

      doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica-Bold');
      doc.text(data.company.name.toUpperCase(), 45, y + 12);

      doc.fontSize(8).font('Helvetica');
      doc.text(
        `PRIVATE & CONFIDENTIAL PAYSLIP  |  PERIOD: ${data.period}`,
        45,
        y + 32,
      );
      if (data.company.pan) {
        doc.text(`PAN: ${data.company.pan}  ${data.company.tan ? `| TAN: ${data.company.tan}` : ''}`, 45, y + 42);
      }

      y += 65;

      // 2. EMPLOYEE DETAILS GRID
      doc.rect(30, y, pageWidth, 75).strokeColor('#DDE5DC').lineWidth(1).stroke();
      doc.rect(30, y, pageWidth, 18).fill('#F3F7EC');

      doc.fillColor('#004B2A').fontSize(9).font('Helvetica-Bold');
      doc.text('EMPLOYEE SUMMARY', 40, y + 5);

      const col1X = 40;
      const col2X = 210;
      const col3X = 380;
      const rowY1 = y + 24;
      const rowY2 = y + 38;
      const rowY3 = y + 52;

      doc.fillColor('#647067').fontSize(7.5).font('Helvetica');
      doc.text('Employee Code:', col1X, rowY1);
      doc.text('Employee Name:', col1X, rowY2);
      doc.text('Department:', col1X, rowY3);

      doc.fillColor('#17231D').font('Helvetica-Bold');
      doc.text(data.employee.empCode, col1X + 68, rowY1);
      doc.text(data.employee.name, col1X + 68, rowY2);
      doc.text(data.employee.department || 'General', col1X + 68, rowY3);

      doc.fillColor('#647067').font('Helvetica');
      doc.text('Designation:', col2X, rowY1);
      doc.text('Date of Joining:', col2X, rowY2);
      doc.text('PAN / UAN:', col2X, rowY3);

      doc.fillColor('#17231D').font('Helvetica-Bold');
      doc.text(data.employee.designation || 'Specialist', col2X + 60, rowY1);
      doc.text(data.employee.joiningDate || 'N/A', col2X + 60, rowY2);
      doc.text(`${data.employee.pan || 'N/A'} / ${data.employee.uan || 'N/A'}`, col2X + 60, rowY3);

      doc.fillColor('#647067').font('Helvetica');
      doc.text('Bank Name:', col3X, rowY1);
      doc.text('Account No:', col3X, rowY2);
      doc.text('IFSC Code:', col3X, rowY3);

      doc.fillColor('#17231D').font('Helvetica-Bold');
      doc.text(data.employee.bankName || 'HDFC Bank', col3X + 55, rowY1);
      doc.text(maskAccountNumber(data.employee.bankAccountNumber), col3X + 55, rowY2);
      doc.text(data.employee.ifsc || 'HDFC0000123', col3X + 55, rowY3);

      y += 85;

      // 3. ATTENDANCE SUMMARY STRIP
      doc.rect(30, y, pageWidth, 28).strokeColor('#DDE5DC').stroke();
      doc.rect(30, y, pageWidth, 14).fill('#F8FAF7');

      doc.fillColor('#647067').fontSize(7.5).font('Helvetica-Bold');
      doc.text('ATTENDANCE METRICS', 40, y + 3);

      const attCols = [
        { label: 'Calendar Days', val: data.attendance.calendarDays },
        { label: 'Payable Paid Days', val: data.attendance.paidDays },
        { label: 'LOP / Absent Days', val: data.attendance.lopDays },
        { label: 'Weekly Offs', val: data.attendance.weeklyOff ?? 0 },
        { label: 'Paid Holidays', val: data.attendance.holidays ?? 0 },
      ];

      const attColWidth = pageWidth / attCols.length;
      attCols.forEach((col, idx) => {
        const cx = 30 + idx * attColWidth;
        doc.fillColor('#647067').fontSize(7).font('Helvetica').text(col.label, cx + 8, y + 16);
        doc.fillColor('#17231D').fontSize(8).font('Helvetica-Bold').text(String(col.val), cx + 75, y + 16);
      });

      y += 38;

      // 4. TWO-COLUMN FINANCIAL TABLE (EARNINGS VS DEDUCTIONS)
      const tableWidth = (pageWidth - 10) / 2; // 262.5 each
      const earningsX = 30;
      const deductionsX = 30 + tableWidth + 10;
      const tableHeight = 220;

      // Headers
      doc.rect(earningsX, y, tableWidth, 18).fill('#004B2A');
      doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
      doc.text('EARNINGS', earningsX + 10, y + 5);
      doc.text('AMOUNT (INR)', earningsX + tableWidth - 75, y + 5, { width: 65, align: 'right' });

      doc.rect(deductionsX, y, tableWidth, 18).fill('#004B2A');
      doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
      doc.text('DEDUCTIONS', deductionsX + 10, y + 5);
      doc.text('AMOUNT (INR)', deductionsX + tableWidth - 75, y + 5, { width: 65, align: 'right' });

      // Outer table frames
      doc.rect(earningsX, y + 18, tableWidth, tableHeight).strokeColor('#DDE5DC').stroke();
      doc.rect(deductionsX, y + 18, tableWidth, tableHeight).strokeColor('#DDE5DC').stroke();

      let rowY = y + 24;

      // Earnings rows
      data.earnings.forEach((earn, idx) => {
        if (idx % 2 === 1) {
          doc.rect(earningsX, rowY - 2, tableWidth, 14).fill('#F8FAF7');
        }
        doc.fillColor('#17231D').fontSize(7.5).font('Helvetica').text(earn.name, earningsX + 10, rowY);
        doc.font('Helvetica-Bold').text(formatIndianGrouping(earn.amount), earningsX + tableWidth - 75, rowY, {
          width: 65,
          align: 'right',
        });
        rowY += 15;
      });

      // Deductions rows
      let dedY = y + 24;
      data.deductions.forEach((ded, idx) => {
        if (idx % 2 === 1) {
          doc.rect(deductionsX, dedY - 2, tableWidth, 14).fill('#F8FAF7');
        }
        doc.fillColor('#17231D').fontSize(7.5).font('Helvetica').text(ded.name, deductionsX + 10, dedY);
        doc.font('Helvetica-Bold').text(formatIndianGrouping(ded.amount), deductionsX + tableWidth - 75, dedY, {
          width: 65,
          align: 'right',
        });
        dedY += 15;
      });

      // Subtotals Footer Row
      const subtotalY = y + 18 + tableHeight - 20;
      doc.rect(earningsX, subtotalY, tableWidth, 20).fill('#F3F7EC');
      doc.fillColor('#004B2A').fontSize(8).font('Helvetica-Bold');
      doc.text('TOTAL GROSS EARNINGS', earningsX + 10, subtotalY + 6);
      doc.text(`INR ${formatIndianGrouping(data.summary.gross)}`, earningsX + tableWidth - 85, subtotalY + 6, {
        width: 75,
        align: 'right',
      });

      doc.rect(deductionsX, subtotalY, tableWidth, 20).fill('#F3F7EC');
      doc.fillColor('#004B2A').fontSize(8).font('Helvetica-Bold');
      doc.text('TOTAL DEDUCTIONS', deductionsX + 10, subtotalY + 6);
      doc.text(`INR ${formatIndianGrouping(data.summary.deductions)}`, deductionsX + tableWidth - 85, subtotalY + 6, {
        width: 75,
        align: 'right',
      });

      y += 18 + tableHeight + 10;

      // 5. HIGHLIGHTED NET PAY BOX (AIC Leaf Green tint #E8F0D9)
      doc.rect(30, y, pageWidth, 45).fillAndStroke('#E8F0D9', '#004B2A');

      doc.fillColor('#004B2A').fontSize(9).font('Helvetica-Bold');
      doc.text('NET TAKE-HOME REMUNERATION (INR):', 45, y + 10);

      doc.fontSize(14).font('Helvetica-Bold');
      doc.text(`INR ${formatIndianGrouping(data.summary.net)}`, 45, y + 23);

      // Net pay in words
      const words = numberToIndianWords(data.summary.net);
      doc.fillColor('#17231D').fontSize(8.5).font('Helvetica-Oblique');
      doc.text(words, 220, y + 25, { width: pageWidth - 230, align: 'right' });

      y += 55;

      // 6. YTD CUMULATIVE & PROVISIONS STRIP
      doc.rect(30, y, pageWidth, 30).strokeColor('#DDE5DC').stroke();
      doc.rect(30, y, pageWidth, 13).fill('#F8FAF7');

      doc.fillColor('#647067').fontSize(7).font('Helvetica-Bold');
      doc.text('YEAR-TO-DATE (YTD) FINANCIAL SUMMARY', 40, y + 3);

      const grossYtd = data.ytd?.grossYtd || data.summary.gross;
      const pfYtd = data.ytd?.pfYtd || '0.00';
      const tdsYtd = data.ytd?.tdsYtd || '0.00';

      doc.fillColor('#647067').fontSize(7.5).font('Helvetica');
      doc.text(`YTD Gross Remuneration: INR ${formatIndianGrouping(grossYtd)}`, 40, y + 17);
      doc.text(`YTD Provident Fund: INR ${formatIndianGrouping(pfYtd)}`, 220, y + 17);
      doc.text(`YTD Tax Deducted (TDS): INR ${formatIndianGrouping(tdsYtd)}`, 390, y + 17);

      y += 45;

      // 7. FOOTER & INTEGRITY STAMP
      doc.rect(30, y, pageWidth, 40).strokeColor('#DDE5DC').stroke();

      doc.fillColor('#647067').fontSize(6.5).font('Helvetica');
      doc.text(
        'Note: This document is an electronically generated confidential record authorized by the employer. No physical signature is required.',
        40,
        y + 6,
      );

      const genDate = data.generatedAt ? data.generatedAt.toISOString() : new Date().toISOString();
      doc.text(`System Generation Timestamp: ${genDate}`, 40, y + 16);
      doc.fillColor('#004B2A').font('Helvetica-Bold');
      doc.text(`Document Integrity SHA-256 Fingerprint: ${data.integrityHash}`, 40, y + 26);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
