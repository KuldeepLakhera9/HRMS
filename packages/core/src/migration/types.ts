export interface MigrationErrorRow {
  rowNumber: number;
  empCode?: string;
  field?: string;
  reason: string;
  rawData?: string;
}

export interface LeaveBalanceImportRow {
  empCode: string;
  leaveTypeCode: string;
  periodYear: string;
  openingBalance: number;
}

export interface AttendanceImportRow {
  empCode: string;
  date: string;
  inTime?: string | null;
  outTime?: string | null;
  status?: string;
}

export interface MigrationPreviewResult<T = Record<string, unknown>> {
  batchId: string;
  type: 'leave_balances' | 'attendance_punches';
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: MigrationErrorRow[];
  preview: T[];
}

export interface MigrationConfirmResult {
  batchId: string;
  status: 'completed' | 'reverted' | 'failed';
  processedCount: number;
  summary: Record<string, unknown>;
}
