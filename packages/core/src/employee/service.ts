import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { requireStepUp } from '../auth/session.js';
import { AuditService } from '../audit/service.js';
import {
  encryptSensitiveField,
  decryptSensitiveField,
  computeBlindIndex,
  maskPan,
  maskAadhaar,
  maskBankAccount,
} from './crypto.js';
import {
  EmployeeRepository,
  type EmployeeRow,
  type EmployeeHistoryRow,
  type DirectoryEmployeeRow,
  type DirectoryQueryParams,
} from './repository.js';

export interface MaskedEmployee extends Omit<EmployeeRow, 'bankEnc' | 'panEnc' | 'panBlindIdx' | 'aadhaarEnc'> {
  bankAccount: string | null;
  pan: string | null;
  aadhaar: string | null;
}

export class EmployeeService {
  private repository: EmployeeRepository;
  private auditService: AuditService;

  constructor(repository?: EmployeeRepository, auditService?: AuditService) {
    this.repository = repository ?? new EmployeeRepository();
    this.auditService = auditService ?? new AuditService();
  }

  private maskEmployee(emp: EmployeeRow): MaskedEmployee {
    let pan: string | null = null;
    let aadhaar: string | null = null;
    let bankAccount: string | null = null;

    try {
      if (emp.panEnc) pan = maskPan(decryptSensitiveField(emp.panEnc));
    } catch {
      pan = 'XXXX';
    }

    try {
      if (emp.aadhaarEnc) aadhaar = maskAadhaar(decryptSensitiveField(emp.aadhaarEnc));
    } catch {
      aadhaar = 'XXXX';
    }

    try {
      if (emp.bankEnc) bankAccount = maskBankAccount(decryptSensitiveField(emp.bankEnc));
    } catch {
      bankAccount = 'XXXX';
    }

    const {
      bankEnc: _b,
      panEnc: _p,
      panBlindIdx: _pb,
      aadhaarEnc: _a,
      ...rest
    } = emp;

    return {
      ...rest,
      pan,
      aadhaar,
      bankAccount,
    };
  }

  /**
   * Creates a new employee master record with atomic sequence emp_code,
   * AES-256-GCM field encryption, PAN blind indexing, and reporting path computation.
   */
  async createEmployee(
    ctx: RequestContext,
    params: {
      firstName: string;
      lastName: string;
      dob?: string | null | undefined;
      gender?: string | null | undefined;
      maritalStatus?: string | null | undefined;
      emailWork: string;
      emailPersonal?: string | null | undefined;
      phone?: string | null | undefined;
      addresses?: Record<string, unknown> | undefined;
      emergencyContacts?: Array<Record<string, unknown>> | undefined;
      departmentId?: string | null | undefined;
      designationId?: string | null | undefined;
      gradeId?: string | null | undefined;
      costCenterId?: string | null | undefined;
      locationId?: string | null | undefined;
      managerId?: string | null | undefined;
      employmentType?: string | undefined;
      doj: string;
      confirmationDate?: string | null | undefined;
      status?: string | undefined;
      bankAccount?: string | null | undefined;
      pan?: string | null | undefined;
      aadhaar?: string | null | undefined;
      customFields?: Record<string, unknown> | undefined;
      userId?: string | null | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<MaskedEmployee> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_CREATE)) {
      throw new ForbiddenError('You do not have permission to create employee profiles.');
    }

    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to create employees.');
    }

    if (!params.firstName?.trim() || !params.lastName?.trim()) {
      throw new ValidationError('First name and last name are required.');
    }
    if (!params.emailWork?.trim()) {
      throw new ValidationError('Work email is required.');
    }
    if (!params.doj) {
      throw new ValidationError('Date of joining (doj) is required.');
    }

    // 1. Check duplicate PAN if provided
    let panBlindIdx: string | null = null;
    let panEnc: string | null = null;
    if (params.pan && params.pan.trim()) {
      panBlindIdx = computeBlindIndex(params.pan, ctx.companyId);
      const dup = await this.repository.findByPanBlindIndex(ctx.companyId, panBlindIdx, undefined, poolOverride);
      if (dup) {
        throw new ValidationError(`Employee with PAN already exists (Emp Code: ${dup.empCode}).`);
      }
      panEnc = encryptSensitiveField(params.pan.trim().toUpperCase());
    }

    // 2. Encrypt Aadhaar & Bank
    let aadhaarEnc: string | null = null;
    if (params.aadhaar && params.aadhaar.trim()) {
      aadhaarEnc = encryptSensitiveField(params.aadhaar.trim());
    }

    let bankEnc: string | null = null;
    if (params.bankAccount && params.bankAccount.trim()) {
      bankEnc = encryptSensitiveField(params.bankAccount.trim());
    }

    // 3. Compute Reporting Path & Hierarchy Depth Check
    let reportingPath: string[] = [];
    if (params.managerId) {
      const manager = await this.repository.findById(ctx.companyId, params.managerId, poolOverride);
      if (!manager) {
        throw new ValidationError('Assigned manager does not exist.');
      }
      if (manager.status !== 'active') {
        throw new ValidationError('Cannot assign an inactive manager.');
      }
      if (manager.reportingPath.length >= 25) {
        throw new ValidationError('Maximum reporting hierarchy depth of 25 exceeded.');
      }
      reportingPath = [...manager.reportingPath, manager.id];
    }

    // 4. Generate atomic emp_code sequence
    const empCode = await this.repository.getNextEmpCode(ctx.companyId, poolOverride);

    // 5. Construct search_key for fast trigram index
    const searchKey = `${params.firstName} ${params.lastName} ${empCode} ${params.emailWork}`.toLowerCase();

    // 6. Insert employee record
    const emp = await this.repository.createEmployee(
      {
        companyId: ctx.companyId,
        empCode,
        firstName: params.firstName.trim(),
        lastName: params.lastName.trim(),
        dob: params.dob,
        gender: params.gender,
        maritalStatus: params.maritalStatus,
        emailWork: params.emailWork.trim().toLowerCase(),
        emailPersonal: params.emailPersonal?.trim().toLowerCase() || null,
        phone: params.phone || null,
        addresses: params.addresses || {},
        emergencyContacts: params.emergencyContacts || [],
        departmentId: params.departmentId || null,
        designationId: params.designationId || null,
        gradeId: params.gradeId || null,
        costCenterId: params.costCenterId || null,
        locationId: params.locationId || null,
        managerId: params.managerId || null,
        employmentType: params.employmentType || 'full_time',
        doj: params.doj,
        confirmationDate: params.confirmationDate || null,
        status: params.status || 'active',
        jobEffectiveFrom: params.doj,
        reportingPath,
        bankEnc,
        panEnc,
        panBlindIdx,
        aadhaarEnc,
        customFields: params.customFields || {},
        userId: params.userId || null,
        searchKey,
        actorId: ctx.userId,
      },
      poolOverride,
    );

    // 7. Initial creation history entry
    await this.repository.insertHistory(
      {
        companyId: ctx.companyId,
        employeeId: emp.id,
        field: 'status',
        oldValue: null,
        newValue: emp.status,
        effectiveFrom: emp.doj,
        appliedAt: new Date(),
        changedBy: ctx.userId,
        reason: 'Initial onboarding',
      },
      poolOverride,
    );

    // 8. Audit event
    await this.auditService.recordEvent(ctx, {
      action: 'employee.create',
      entity: 'employee',
      entityId: emp.id,
      after: {
        empCode: emp.empCode,
        fullName: emp.fullName,
        emailWork: emp.emailWork,
        departmentId: emp.departmentId,
        designationId: emp.designationId,
        managerId: emp.managerId,
      },
      poolOverride,
    });

    return this.maskEmployee(emp);
  }

  /**
   * Retrieves an employee profile with sensitive fields masked by default.
   */
  async getEmployee(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<MaskedEmployee> {
    const isSelf = ctx.employeeId && ctx.employeeId === id;
    const hasReadPerm = can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ);

    if (!isSelf && !hasReadPerm) {
      throw new ForbiddenError('You do not have permission to view this employee profile.');
    }

    const emp = await this.repository.findById(ctx.companyId, id, poolOverride);
    if (!emp) {
      throw new NotFoundError('Employee not found.');
    }

    return this.maskEmployee(emp);
  }

  /**
   * Retrieves decrypted sensitive fields (bank, PAN, Aadhaar).
   * Strict security: Requires EMPLOYEE_PROFILE_VIEW_SENSITIVE, step-up auth, and logs audit event.
   */
  async getSensitiveFields(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<{ bankAccount: string | null; pan: string | null; aadhaar: string | null }> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE)) {
      throw new ForbiddenError('You do not have permission to view sensitive employee fields.');
    }

    // Require step-up elevation
    requireStepUp(ctx);

    const emp = await this.repository.findById(ctx.companyId, id, poolOverride);
    if (!emp) {
      throw new NotFoundError('Employee not found.');
    }

    let pan: string | null = null;
    let aadhaar: string | null = null;
    let bankAccount: string | null = null;

    if (emp.panEnc) {
      pan = decryptSensitiveField(emp.panEnc);
    }
    if (emp.aadhaarEnc) {
      aadhaar = decryptSensitiveField(emp.aadhaarEnc);
    }
    if (emp.bankEnc) {
      bankAccount = decryptSensitiveField(emp.bankEnc);
    }

    // Log immutable audit event for sensitive unmasking
    await this.auditService.recordEvent(ctx, {
      action: 'employee.view_sensitive',
      entity: 'employee',
      entityId: id,
      meta: {
        empCode: emp.empCode,
        unmaskedFields: ['bankAccount', 'pan', 'aadhaar'],
      },
      poolOverride,
    });

    return { bankAccount, pan, aadhaar };
  }

  /**
   * Updates employee basic info (non-job fields).
   */
  async updateProfile(
    ctx: RequestContext,
    id: string,
    data: {
      firstName?: string | undefined;
      lastName?: string | undefined;
      emailWork?: string | undefined;
      emailPersonal?: string | null | undefined;
      phone?: string | null | undefined;
      addresses?: Record<string, unknown> | undefined;
      emergencyContacts?: Array<Record<string, unknown>> | undefined;
      bankAccount?: string | null | undefined;
      pan?: string | null | undefined;
      aadhaar?: string | null | undefined;
      customFields?: Record<string, unknown> | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<MaskedEmployee> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_UPDATE)) {
      throw new ForbiddenError('You do not have permission to update employee profiles.');
    }

    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to update employee.');
    }

    const current = await this.repository.findById(ctx.companyId, id, poolOverride);
    if (!current) {
      throw new NotFoundError('Employee not found.');
    }

    const updates: Partial<EmployeeRow> = {};

    if (data.firstName !== undefined) updates.firstName = data.firstName.trim();
    if (data.lastName !== undefined) updates.lastName = data.lastName.trim();
    if (data.emailWork !== undefined) updates.emailWork = data.emailWork.trim().toLowerCase();
    if (data.emailPersonal !== undefined) updates.emailPersonal = data.emailPersonal ? data.emailPersonal.trim().toLowerCase() : null;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.addresses !== undefined) updates.addresses = data.addresses;
    if (data.emergencyContacts !== undefined) updates.emergencyContacts = data.emergencyContacts;

    // Check PAN if changed
    if (data.pan !== undefined) {
      if (data.pan && data.pan.trim()) {
        const panBlindIdx = computeBlindIndex(data.pan, ctx.companyId);
        const dup = await this.repository.findByPanBlindIndex(ctx.companyId, panBlindIdx, id, poolOverride);
        if (dup) {
          throw new ValidationError('Another employee with this PAN already exists.');
        }
        updates.panBlindIdx = panBlindIdx;
        updates.panEnc = encryptSensitiveField(data.pan.trim().toUpperCase());
      } else {
        updates.panBlindIdx = null;
        updates.panEnc = null;
      }
    }

    if (data.aadhaar !== undefined) {
      updates.aadhaarEnc = data.aadhaar && data.aadhaar.trim() ? encryptSensitiveField(data.aadhaar.trim()) : null;
    }

    if (data.bankAccount !== undefined) {
      updates.bankEnc = data.bankAccount && data.bankAccount.trim() ? encryptSensitiveField(data.bankAccount.trim()) : null;
    }

    const firstName = updates.firstName || current.firstName;
    const lastName = updates.lastName || current.lastName;
    const emailWork = updates.emailWork || current.emailWork;
    updates.searchKey = `${firstName} ${lastName} ${current.empCode} ${emailWork}`.toLowerCase();

    const updated = await this.repository.updateEmployee(
      {
        companyId: ctx.companyId,
        id,
        data: updates,
        actorId: ctx.userId,
      },
      poolOverride,
    );

    if (!updated) {
      throw new NotFoundError('Employee not found.');
    }

    await this.auditService.recordEvent(ctx, {
      action: 'employee.update',
      entity: 'employee',
      entityId: id,
      before: { firstName: current.firstName, lastName: current.lastName, emailWork: current.emailWork },
      after: { firstName: updated.firstName, lastName: updated.lastName, emailWork: updated.emailWork },
      poolOverride,
    });

    return this.maskEmployee(updated);
  }

  /**
   * Applies an effective-dated job change (immediate or future-dated).
   * Supports manager reassignment with cycle detection and atomic subtree re-parenting.
   */
  async changeJob(
    ctx: RequestContext,
    id: string,
    params: {
      field: 'departmentId' | 'designationId' | 'gradeId' | 'costCenterId' | 'locationId' | 'managerId' | 'status';
      newValue: string | null;
      effectiveFrom: string; // YYYY-MM-DD
      reason?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ applied: boolean; effectiveFrom: string }> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_UPDATE)) {
      throw new ForbiddenError('You do not have permission to change employee job assignments.');
    }

    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to change job assignment.');
    }

    const employee = await this.repository.findById(ctx.companyId, id, poolOverride);
    if (!employee) {
      throw new NotFoundError('Employee not found.');
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const isImmediate = params.effectiveFrom <= todayStr;

    // Capture old value
    let oldValue: unknown = null;
    switch (params.field) {
      case 'departmentId': oldValue = employee.departmentId; break;
      case 'designationId': oldValue = employee.designationId; break;
      case 'gradeId': oldValue = employee.gradeId; break;
      case 'costCenterId': oldValue = employee.costCenterId; break;
      case 'locationId': oldValue = employee.locationId; break;
      case 'managerId': oldValue = employee.managerId; break;
      case 'status': oldValue = employee.status; break;
    }

    // Special validation for Manager changes: cycle rejection & depth capping
    if (params.field === 'managerId') {
      const newManagerId = params.newValue;

      if (newManagerId === employee.id) {
        throw new ValidationError('An employee cannot be their own manager.');
      }

      let newReportingPath: string[] = [];
      if (newManagerId) {
        const newManager = await this.repository.findById(ctx.companyId, newManagerId, poolOverride);
        if (!newManager) {
          throw new ValidationError('Selected manager does not exist.');
        }

        // Cycle detection: Manager cannot be a current subordinate
        if (newManager.reportingPath.includes(employee.id)) {
          throw new ValidationError(
            'Cycle detected: An employee cannot report to one of their own direct or indirect subordinates.',
          );
        }

        // Depth check: newManager path length + 1 (manager) + subtree max depth <= 25
        const maxSubtreeDepth = await this.repository.getMaxSubtreeDepth(ctx.companyId, employee.id, poolOverride);
        const currentDepth = employee.reportingPath.length;
        const relativeSubtreeHeight = Math.max(0, maxSubtreeDepth - currentDepth);

        const targetNewDepth = newManager.reportingPath.length + 1;
        if (targetNewDepth + relativeSubtreeHeight > 25) {
          throw new ValidationError('Maximum reporting hierarchy depth of 25 exceeded.');
        }

        newReportingPath = [...newManager.reportingPath, newManager.id];
      }

      if (isImmediate) {
        // Run atomic subtree re-parenting
        const oldPrefix = [...employee.reportingPath, employee.id];
        await this.repository.updateReportingHierarchy(
          {
            companyId: ctx.companyId,
            employeeId: employee.id,
            newManagerId,
            newReportingPath,
            oldPrefix,
            actorId: ctx.userId,
          },
          poolOverride,
        );
      }
    } else if (isImmediate) {
      // Immediate non-manager field change
      const updates: Partial<EmployeeRow> = {
        [params.field]: params.newValue,
        jobEffectiveFrom: params.effectiveFrom,
      };

      await this.repository.updateEmployee(
        {
          companyId: ctx.companyId,
          id,
          data: updates,
          actorId: ctx.userId,
        },
        poolOverride,
      );
    }

    // Insert history record
    await this.repository.insertHistory(
      {
        companyId: ctx.companyId,
        employeeId: id,
        field: params.field,
        oldValue,
        newValue: params.newValue,
        effectiveFrom: params.effectiveFrom,
        appliedAt: isImmediate ? new Date() : null,
        changedBy: ctx.userId,
        reason: params.reason || null,
      },
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'employee.job_change',
      entity: 'employee',
      entityId: id,
      meta: {
        field: params.field,
        oldValue,
        newValue: params.newValue,
        effectiveFrom: params.effectiveFrom,
        applied: isImmediate,
      },
      poolOverride,
    });

    return { applied: isImmediate, effectiveFrom: params.effectiveFrom };
  }

  /**
   * Daily worker job: checks for scheduled future-dated changes that have become effective
   * and applies them atomically.
   */
  async applyScheduledChanges(
    ctx: RequestContext,
    targetDateStr?: string,
    poolOverride?: pg.Pool,
  ): Promise<{ appliedCount: number }> {
    const targetDate = targetDateStr || new Date().toISOString().slice(0, 10);
    const pending = await this.repository.getPendingScheduledChanges(ctx.companyId, targetDate, poolOverride);

    let count = 0;
    for (const change of pending) {
      try {
        const emp = await this.repository.findById(ctx.companyId, change.employeeId, poolOverride);
        if (!emp) continue;

        if (change.field === 'managerId') {
          const newManagerId = change.newValue as string | null;
          let newReportingPath: string[] = [];
          if (newManagerId) {
            const newManager = await this.repository.findById(ctx.companyId, newManagerId, poolOverride);
            if (newManager && !newManager.reportingPath.includes(emp.id)) {
              newReportingPath = [...newManager.reportingPath, newManager.id];
            }
          }
          const oldPrefix = [...emp.reportingPath, emp.id];
          await this.repository.updateReportingHierarchy(
            {
              companyId: ctx.companyId,
              employeeId: emp.id,
              newManagerId,
              newReportingPath,
              oldPrefix,
              actorId: change.changedBy,
            },
            poolOverride,
          );
        } else {
          await this.repository.updateEmployee(
            {
              companyId: ctx.companyId,
              id: emp.id,
              data: {
                [change.field]: change.newValue,
                jobEffectiveFrom: change.effectiveFrom,
              } as Partial<EmployeeRow>,
              actorId: change.changedBy,
            },
            poolOverride,
          );
        }

        await this.repository.markHistoryApplied(ctx.companyId, change.id, change.changedBy, poolOverride);
        count++;
      } catch {
        // Continue processing remaining changes if one fails
      }
    }

    return { appliedCount: count };
  }

  /**
   * Lists employees with filtering and keyset pagination.
   */
  async listEmployees(
    ctx: RequestContext,
    params: {
      query?: string | undefined;
      departmentId?: string | undefined;
      locationId?: string | undefined;
      status?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<{ employees: MaskedEmployee[]; nextCursor?: string | undefined }> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ)) {
      throw new ForbiddenError('You do not have permission to view employee directory.');
    }

    const rows = await this.repository.listEmployees(ctx.companyId, params, poolOverride);
    const masked = rows.map(r => this.maskEmployee(r));

    const limit = Math.min(params.limit || 50, 100);
    const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id : undefined;

    return {
      employees: masked,
      nextCursor,
    };
  }

  /**
   * Retrieves effective-dated timeline for an employee.
   */
  async getEmployeeHistory(
    ctx: RequestContext,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeHistoryRow[]> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_HISTORY_READ)) {
      throw new ForbiddenError('You do not have permission to view employee history.');
    }

    return this.repository.getEmployeeHistory(ctx.companyId, employeeId, poolOverride);
  }

  /**
   * Fast keyset directory listing with search, filters, and bounded count.
   */
  async getDirectory(
    ctx: RequestContext,
    params: DirectoryQueryParams,
    poolOverride?: pg.Pool,
  ): Promise<{ items: DirectoryEmployeeRow[]; nextCursor?: string | undefined; total: number }> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_PROFILE_READ)) {
      throw new ForbiddenError('You do not have permission to view employee directory.');
    }

    return this.repository.getDirectory(ctx.companyId, params, poolOverride);
  }
}
