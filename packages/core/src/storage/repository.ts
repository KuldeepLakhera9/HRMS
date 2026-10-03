import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';

export interface FileRow {
  id: string;
  companyId: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  sha256: string | null;
  status: 'pending' | 'clean' | 'rejected';
  ownerType: string;
  ownerId: string;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

interface RawFileRow extends Omit<FileRow, 'sizeBytes'> {
  sizeBytes: string | number;
}

function mapRow(row: RawFileRow): FileRow {
  return {
    ...row,
    sizeBytes: Number(row.sizeBytes),
  };
}

export class StorageRepository {
  /**
   * Creates a new file record in 'pending' status.
   */
  async createFile(
    params: {
      companyId: string;
      bucket: string;
      objectKey: string;
      originalName: string;
      mime: string;
      sizeBytes: number;
      ownerType: string;
      ownerId: string;
      uploadedBy: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<FileRow> {
    const id = generateUuidV7();
    return withTenant(
      {
        companyId: params.companyId,
        userId: params.uploadedBy,
      },
      async (_tx, client) => {
        const res = await client.query<RawFileRow>(
          `INSERT INTO files (
             id, company_id, bucket, object_key, original_name, mime, size_bytes,
             status, owner_type, owner_id, uploaded_by, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $10, $10)
           RETURNING id, company_id as "companyId", bucket, object_key as "objectKey",
                     original_name as "originalName", mime, size_bytes as "sizeBytes",
                     sha256, status, owner_type as "ownerType", owner_id as "ownerId",
                     uploaded_by as "uploadedBy", created_at as "createdAt",
                     updated_at as "updatedAt", deleted_at as "deletedAt",
                     row_version as "rowVersion"`,
          [
            id,
            params.companyId,
            params.bucket,
            params.objectKey,
            params.originalName,
            params.mime,
            params.sizeBytes,
            params.ownerType,
            params.ownerId,
            params.uploadedBy,
          ],
        );
        return mapRow(res.rows[0]!);
      },
      poolOverride,
    );
  }

  /**
   * Finds a file record by company_id and id.
   */
  async findById(
    companyId: string,
    fileId: string,
    poolOverride?: pg.Pool,
  ): Promise<FileRow | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<RawFileRow>(
          `SELECT id, company_id as "companyId", bucket, object_key as "objectKey",
                  original_name as "originalName", mime, size_bytes as "sizeBytes",
                  sha256, status, owner_type as "ownerType", owner_id as "ownerId",
                  uploaded_by as "uploadedBy", created_at as "createdAt",
                  updated_at as "updatedAt", deleted_at as "deletedAt",
                  row_version as "rowVersion"
           FROM files
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           LIMIT 1`,
          [companyId, fileId],
        );
        return res.rows[0] ? mapRow(res.rows[0]) : null;
      },
      poolOverride,
    );
  }

  /**
   * Updates file confirmation status, size, and SHA-256 hash.
   */
  async updateStatus(
    params: {
      companyId: string;
      fileId: string;
      status: 'clean' | 'rejected';
      sizeBytes?: number | undefined;
      sha256?: string | undefined;
      updatedBy: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<FileRow | null> {
    return withTenant(
      {
        companyId: params.companyId,
        userId: params.updatedBy,
      },
      async (_tx, client) => {
        const res = await client.query<RawFileRow>(
          `UPDATE files
           SET status = $3,
               size_bytes = COALESCE($4, size_bytes),
               sha256 = COALESCE($5, sha256),
               updated_by = $6,
               updated_at = NOW(),
               row_version = row_version + 1
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           RETURNING id, company_id as "companyId", bucket, object_key as "objectKey",
                     original_name as "originalName", mime, size_bytes as "sizeBytes",
                     sha256, status, owner_type as "ownerType", owner_id as "ownerId",
                     uploaded_by as "uploadedBy", created_at as "createdAt",
                     updated_at as "updatedAt", deleted_at as "deletedAt",
                     row_version as "rowVersion"`,
          [
            params.companyId,
            params.fileId,
            params.status,
            params.sizeBytes ?? null,
            params.sha256 ?? null,
            params.updatedBy,
          ],
        );
        return res.rows[0] ? mapRow(res.rows[0]) : null;
      },
      poolOverride,
    );
  }

  /**
   * Soft-deletes a file record.
   */
  async softDelete(
    companyId: string,
    fileId: string,
    userId: string,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      { companyId, userId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE files
           SET deleted_at = NOW(),
               updated_by = $3,
               updated_at = NOW(),
               row_version = row_version + 1
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, fileId, userId],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }

  /**
   * Lists active clean files for an owner.
   */
  async listByOwner(
    companyId: string,
    ownerType: string,
    ownerId: string,
    poolOverride?: pg.Pool,
  ): Promise<FileRow[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<RawFileRow>(
          `SELECT id, company_id as "companyId", bucket, object_key as "objectKey",
                  original_name as "originalName", mime, size_bytes as "sizeBytes",
                  sha256, status, owner_type as "ownerType", owner_id as "ownerId",
                  uploaded_by as "uploadedBy", created_at as "createdAt",
                  updated_at as "updatedAt", deleted_at as "deletedAt",
                  row_version as "rowVersion"
           FROM files
           WHERE company_id = $1 AND owner_type = $2 AND owner_id = $3
             AND status = 'clean' AND deleted_at IS NULL
           ORDER BY created_at DESC`,
          [companyId, ownerType, ownerId],
        );
        return res.rows.map(mapRow);
      },
      poolOverride,
    );
  }
}
