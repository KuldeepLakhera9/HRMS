import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';

export interface EmployeeDocumentRow {
  id: string;
  companyId: string;
  employeeId: string;
  type: string;
  fileId: string;
  status: 'pending' | 'verified' | 'rejected';
  expiry: string | null;
  verifiedBy: string | null;
  verificationComment: string | null;
  originalName?: string;
  mime?: string;
  sizeBytes?: number;
  bucket?: string;
  objectKey?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

export class DocumentRepository {
  /**
   * Links a file as an employee document with initial 'pending' status.
   */
  async createDocument(
    companyId: string,
    data: {
      employeeId: string;
      type: string;
      fileId: string;
      expiry?: string | null | undefined;
      createdBy?: string | null | undefined;
    },
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDocumentRow> {
    const id = generateUuidV7();

    const execute = async (client: pg.PoolClient | pg.Pool) => {
      const res = await client.query<EmployeeDocumentRow>(
        `INSERT INTO employee_documents (
           id, company_id, employee_id, type, file_id, status, expiry, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $7)
         RETURNING
           id, company_id as "companyId", employee_id as "employeeId", type, file_id as "fileId",
           status, expiry, verified_by as "verifiedBy", verification_comment as "verificationComment",
           created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"`,
        [
          id,
          companyId,
          data.employeeId,
          data.type,
          data.fileId,
          data.expiry || null,
          data.createdBy || null,
        ],
      );
      return res.rows[0]!;
    };

    if (clientOverride) {
      return execute(clientOverride);
    }

    return withTenant({ companyId }, async (_tx, client) => execute(client), poolOverride);
  }

  /**
   * Fetches an employee document by ID with associated file metadata.
   */
  async findById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDocumentRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<EmployeeDocumentRow>(
          `SELECT
             d.id, d.company_id as "companyId", d.employee_id as "employeeId", d.type, d.file_id as "fileId",
             d.status, d.expiry, d.verified_by as "verifiedBy", d.verification_comment as "verificationComment",
             d.created_at as "createdAt", d.updated_at as "updatedAt", d.deleted_at as "deletedAt", d.row_version as "rowVersion",
             f.original_name as "originalName", f.mime, f.size_bytes as "sizeBytes", f.bucket, f.object_key as "objectKey"
           FROM employee_documents d
           LEFT JOIN files f ON f.id = d.file_id AND f.company_id = d.company_id AND f.deleted_at IS NULL
           WHERE d.company_id = $1 AND d.id = $2 AND d.deleted_at IS NULL
           LIMIT 1`,
          [companyId, id],
        );
        return res.rows[0] || null;
      },
      poolOverride,
    );
  }

  /**
   * Lists all documents for a specific employee.
   */
  async listByEmployee(
    companyId: string,
    employeeId: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDocumentRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<EmployeeDocumentRow>(
          `SELECT
             d.id, d.company_id as "companyId", d.employee_id as "employeeId", d.type, d.file_id as "fileId",
             d.status, d.expiry, d.verified_by as "verifiedBy", d.verification_comment as "verificationComment",
             d.created_at as "createdAt", d.updated_at as "updatedAt", d.deleted_at as "deletedAt", d.row_version as "rowVersion",
             f.original_name as "originalName", f.mime, f.size_bytes as "sizeBytes", f.bucket, f.object_key as "objectKey"
           FROM employee_documents d
           LEFT JOIN files f ON f.id = d.file_id AND f.company_id = d.company_id AND f.deleted_at IS NULL
           WHERE d.company_id = $1 AND d.employee_id = $2 AND d.deleted_at IS NULL
           ORDER BY d.created_at DESC`,
          [companyId, employeeId],
        );
        return res.rows;
      },
      poolOverride,
    );
  }

  /**
   * Updates verification status of an employee document.
   */
  async updateVerification(
    companyId: string,
    id: string,
    data: {
      status: 'verified' | 'rejected';
      verifiedBy: string;
      verificationComment?: string | null | undefined;
    },
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDocumentRow | null> {
    const execute = async (client: pg.PoolClient | pg.Pool) => {
      const res = await client.query<EmployeeDocumentRow>(
        `UPDATE employee_documents
         SET status = $1, verified_by = $2, verification_comment = $3, updated_at = now()
         WHERE company_id = $4 AND id = $5 AND deleted_at IS NULL
         RETURNING
           id, company_id as "companyId", employee_id as "employeeId", type, file_id as "fileId",
           status, expiry, verified_by as "verifiedBy", verification_comment as "verificationComment",
           created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt", row_version as "rowVersion"`,
        [data.status, data.verifiedBy, data.verificationComment || null, companyId, id],
      );
      return res.rows[0] || null;
    };

    if (clientOverride) {
      return execute(clientOverride);
    }

    return withTenant({ companyId }, async (_tx, client) => execute(client), poolOverride);
  }

  /**
   * Soft deletes a document.
   */
  async deleteDocument(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE employee_documents
           SET deleted_at = now()
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }
}
