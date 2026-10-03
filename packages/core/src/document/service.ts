import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import { withTenant } from '@hrms/db';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { DocumentRepository, type EmployeeDocumentRow } from './repository.js';
import type { CreateDocumentInput, VerifyDocumentInput } from './validation.js';
import { AuditService } from '../audit/service.js';
import { StorageRepository } from '../storage/repository.js';
import { EmployeeRepository } from '../employee/repository.js';

export class DocumentService {
  private documentRepo: DocumentRepository;
  private storageRepo: StorageRepository;
  private employeeRepo: EmployeeRepository;
  private auditService: AuditService;

  constructor(
    documentRepo?: DocumentRepository,
    storageRepo?: StorageRepository,
    employeeRepo?: EmployeeRepository,
    auditService?: AuditService,
  ) {
    this.documentRepo = documentRepo ?? new DocumentRepository();
    this.storageRepo = storageRepo ?? new StorageRepository();
    this.employeeRepo = employeeRepo ?? new EmployeeRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Uploads/links a document for an employee.
   */
  async uploadDocument(
    ctx: RequestContext,
    employeeId: string,
    input: CreateDocumentInput,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDocumentRow> {
    const isSelf = ctx.employeeId === employeeId;
    const hasPerm = can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD);

    if (!isSelf && !hasPerm) {
      throw new ForbiddenError('You do not have permission to upload documents for this employee.');
    }

    // Verify employee exists in company
    const employee = await this.employeeRepo.findById(ctx.companyId, employeeId, poolOverride);
    if (!employee) {
      throw new NotFoundError('Employee not found.');
    }

    // Verify file exists and belongs to company
    const file = await this.storageRepo.findById(ctx.companyId, input.fileId, poolOverride);
    if (!file) {
      throw new NotFoundError('Underlying file not found.');
    }

    return withTenant(
      { companyId: ctx.companyId, ...(ctx.userId ? { userId: ctx.userId } : {}) },
      async (_tx, client) => {
        const doc = await this.documentRepo.createDocument(
          ctx.companyId,
          {
            employeeId,
            type: input.type,
            fileId: input.fileId,
            expiry: input.expiry,
            createdBy: ctx.userId,
          },
          client,
        );

        // Record outbox event for file scan / notifications
        await this.auditService.recordOutboxEvent(
          ctx,
          'employee_document',
          'document.uploaded',
          {
            documentId: doc.id,
            employeeId,
            fileId: input.fileId,
            type: input.type,
          },
          client,
        );

        return doc;
      },
      poolOverride,
    );
  }

  /**
   * Lists all documents for an employee.
   */
  async listEmployeeDocuments(
    ctx: RequestContext,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDocumentRow[]> {
    const isSelf = ctx.employeeId === employeeId;
    const hasPerm = can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_READ);

    if (!isSelf && !hasPerm) {
      throw new ForbiddenError('You do not have permission to view documents for this employee.');
    }

    return this.documentRepo.listByEmployee(ctx.companyId, employeeId, poolOverride);
  }

  /**
   * Verifies or rejects an employee document (HR only).
   */
  async verifyDocument(
    ctx: RequestContext,
    employeeId: string,
    documentId: string,
    input: VerifyDocumentInput,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDocumentRow> {
    if (!can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_VERIFY)) {
      throw new ForbiddenError('Only authorized HR personnel can verify or reject documents.');
    }

    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to verify documents.');
    }

    const userId = ctx.userId;

    const doc = await this.documentRepo.findById(ctx.companyId, documentId, poolOverride);
    if (!doc || doc.employeeId !== employeeId) {
      throw new NotFoundError('Employee document not found.');
    }

    return withTenant(
      { companyId: ctx.companyId, userId },
      async (_tx, client) => {
        const updated = await this.documentRepo.updateVerification(
          ctx.companyId,
          documentId,
          {
            status: input.status,
            verifiedBy: userId,
            verificationComment: input.comment,
          },
          client,
        );

        if (!updated) {
          throw new NotFoundError('Failed to update document status.');
        }

        // Record audit entry
        await this.auditService.recordEvent(ctx, {
          action: `employee.document.${input.status}`,
          entity: 'employee_document',
          entityId: documentId,
          before: { status: doc.status },
          after: { status: input.status, comment: input.comment },
          clientOverride: client,
        });

        // Record outbox event for notifications
        await this.auditService.recordOutboxEvent(
          ctx,
          'employee_document',
          `document.${input.status}`,
          {
            documentId,
            employeeId,
            status: input.status,
            comment: input.comment,
          },
          client,
        );

        return updated;
      },
      poolOverride,
    );
  }

  /**
   * Deletes an employee document.
   */
  async deleteDocument(
    ctx: RequestContext,
    employeeId: string,
    documentId: string,
    poolOverride?: pg.Pool,
  ): Promise<{ success: boolean }> {
    const isSelf = ctx.employeeId === employeeId;
    const hasPerm = can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_DELETE);

    if (!isSelf && !hasPerm) {
      throw new ForbiddenError('You do not have permission to delete this document.');
    }

    const doc = await this.documentRepo.findById(ctx.companyId, documentId, poolOverride);
    if (!doc || doc.employeeId !== employeeId) {
      throw new NotFoundError('Employee document not found.');
    }

    const deleted = await this.documentRepo.deleteDocument(ctx.companyId, documentId, poolOverride);
    if (deleted) {
      await this.auditService.recordEvent(ctx, {
        action: 'employee.document.delete',
        entity: 'employee_document',
        entityId: documentId,
        before: { id: documentId, type: doc.type, fileId: doc.fileId },
      });
    }

    return { success: deleted };
  }
}
