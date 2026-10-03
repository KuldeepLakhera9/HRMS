import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '@hrms/config';
import {
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { createChildLogger } from '../logger/index.js';
import { AuditService } from '../audit/service.js';
import { getS3Client, ensureBucketExists } from './client.js';
import {
  validateMagicBytes,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
} from './magic-bytes.js';
import { StorageRepository, type FileRow } from './repository.js';

const logger = createChildLogger({ module: 'storage:service' });

export interface PresignedUploadResult {
  fileId: string;
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

export interface PresignedDownloadResult {
  downloadUrl: string;
  expiresIn: number;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

export class StorageService {
  private repository: StorageRepository;
  private auditService: AuditService;

  constructor(repository?: StorageRepository, auditService?: AuditService) {
    this.repository = repository ?? new StorageRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Generates a presigned S3 PUT URL for uploading a document.
   */
  async createPresignedUpload(
    ctx: RequestContext,
    params: {
      originalName: string;
      mime: string;
      sizeBytes: number;
      ownerType: string;
      ownerId: string;
      bucket?: string | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<PresignedUploadResult> {
    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to upload files.');
    }

    // 1. Authorization check: must have upload permission or be the employee uploading own doc
    const isSelfUpload =
      params.ownerType === 'employee' && ctx.employeeId && ctx.employeeId === params.ownerId;
    const hasPermission = can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD);

    if (!isSelfUpload && !hasPermission) {
      throw new ForbiddenError('You do not have permission to upload documents for this entity.');
    }

    // 2. MIME & size validation
    if (!ALLOWED_MIME_TYPES.includes(params.mime as AllowedMimeType)) {
      throw new ValidationError(
        `Invalid file type. Allowed types are: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    if (params.sizeBytes <= 0 || params.sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `File size must be greater than 0 and less than ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
      );
    }

    const env = getEnv();
    const bucket = params.bucket || env.MINIO_BUCKET_DOCUMENTS;
    await ensureBucketExists(bucket);

    // Sanitize filename to prevent directory traversal or malformed keys
    const sanitizedName = params.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${ctx.companyId}/${params.ownerType}/${params.ownerId}/${Date.now()}-${sanitizedName}`;

    // 3. Create file record in DB with 'pending' status
    const file = await this.repository.createFile(
      {
        companyId: ctx.companyId,
        bucket,
        objectKey,
        originalName: params.originalName,
        mime: params.mime,
        sizeBytes: params.sizeBytes,
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        uploadedBy: ctx.userId,
      },
      poolOverride,
    );

    // 4. Generate presigned PUT URL (valid for 15 minutes / 900 seconds)
    const s3 = getS3Client();
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: params.mime,
    });

    const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 900 });

    logger.info(
      { fileId: file.id, objectKey, bucket, userId: ctx.userId },
      'Generated presigned upload URL',
    );

    return {
      fileId: file.id,
      uploadUrl,
      objectKey,
      expiresIn: 900,
    };
  }

  /**
   * Confirms an upload after the client has sent bytes to S3.
   * Downloads the file stream from MinIO to verify actual size and binary magic bytes.
   */
  async confirmUpload(
    ctx: RequestContext,
    fileId: string,
    poolOverride?: pg.Pool,
  ): Promise<FileRow> {
    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to confirm file upload.');
    }

    const file = await this.repository.findById(ctx.companyId, fileId, poolOverride);
    if (!file) {
      throw new NotFoundError('File record not found.');
    }

    if (file.status === 'clean') {
      return file;
    }

    if (file.status === 'rejected') {
      throw new ValidationError('File was previously rejected due to invalid content.');
    }

    const s3 = getS3Client();

    let objectBuffer: Buffer;
    try {
      const getRes = await s3.send(
        new GetObjectCommand({
          Bucket: file.bucket,
          Key: file.objectKey,
        }),
      );

      if (!getRes.Body) {
        throw new ValidationError('Uploaded file body is empty.');
      }

      // Convert stream to Buffer
      const stream = getRes.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      objectBuffer = Buffer.concat(chunks);
    } catch (err: unknown) {
      logger.error({ err, fileId, objectKey: file.objectKey }, 'Failed to fetch uploaded file from MinIO');
      throw new ValidationError('File was not uploaded to storage or could not be retrieved.');
    }

    // Verify magic bytes
    const isValidSignature = validateMagicBytes(objectBuffer, file.mime);
    if (!isValidSignature) {
      logger.warn(
        { fileId, mime: file.mime, byteLength: objectBuffer.length },
        'Rejected file upload: magic bytes mismatch',
      );

      // Clean up fraudulent file from storage
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.objectKey }));
      } catch (delErr) {
        logger.error({ delErr, fileId }, 'Failed to clean up rejected object from S3');
      }

      await this.repository.updateStatus(
        {
          companyId: ctx.companyId,
          fileId,
          status: 'rejected',
          updatedBy: ctx.userId,
        },
        poolOverride,
      );

      throw new ValidationError('File content does not match the declared MIME type or is corrupted.');
    }

    // Compute SHA-256 hash
    const hash = createHash('sha256').update(objectBuffer).digest('hex');

    // Update status to 'clean'
    const updatedFile = await this.repository.updateStatus(
      {
        companyId: ctx.companyId,
        fileId,
        status: 'clean',
        sizeBytes: objectBuffer.length,
        sha256: hash,
        updatedBy: ctx.userId,
      },
      poolOverride,
    );

    if (!updatedFile) {
      throw new NotFoundError('File record could not be updated.');
    }

    // Audit event
    await this.auditService.recordEvent(ctx, {
      action: 'file.confirm',
      entity: 'file',
      entityId: fileId,
      after: {
        bucket: updatedFile.bucket,
        objectKey: updatedFile.objectKey,
        mime: updatedFile.mime,
        sizeBytes: updatedFile.sizeBytes,
        sha256: updatedFile.sha256,
      },
      poolOverride,
    });

    return updatedFile;
  }

  /**
   * Generates a short-lived presigned GET URL for viewing or downloading a clean file.
   */
  async getPresignedDownloadUrl(
    ctx: RequestContext,
    fileId: string,
    poolOverride?: pg.Pool,
  ): Promise<PresignedDownloadResult> {
    const file = await this.repository.findById(ctx.companyId, fileId, poolOverride);
    if (!file) {
      throw new NotFoundError('File not found.');
    }

    if (file.status !== 'clean') {
      throw new ValidationError('File is not ready for download.');
    }

    // Authorization: caller must have EMPLOYEE_DOCUMENT_READ or own the file
    const isOwner =
      file.ownerType === 'employee' && ctx.employeeId && ctx.employeeId === file.ownerId;
    const hasPermission = can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_READ);

    if (!isOwner && !hasPermission) {
      throw new ForbiddenError('You do not have permission to view or download this document.');
    }

    const s3 = getS3Client();
    const getCommand = new GetObjectCommand({
      Bucket: file.bucket,
      Key: file.objectKey,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.originalName)}"`,
    });

    const downloadUrl = await getSignedUrl(s3, getCommand, { expiresIn: 900 });

    // Record audit event for document access
    await this.auditService.recordEvent(ctx, {
      action: 'file.download',
      entity: 'file',
      entityId: fileId,
      meta: {
        originalName: file.originalName,
        mime: file.mime,
      },
      poolOverride,
    });

    return {
      downloadUrl,
      expiresIn: 900,
      fileName: file.originalName,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
    };
  }

  /**
   * Soft-deletes a file and removes it from MinIO.
   */
  async deleteFile(
    ctx: RequestContext,
    fileId: string,
    poolOverride?: pg.Pool,
  ): Promise<{ success: boolean }> {
    if (!ctx.userId) {
      throw new UnauthorizedError('Authentication required to delete file.');
    }

    const file = await this.repository.findById(ctx.companyId, fileId, poolOverride);
    if (!file) {
      throw new NotFoundError('File not found.');
    }

    const isOwner =
      file.ownerType === 'employee' && ctx.employeeId && ctx.employeeId === file.ownerId;
    const hasPermission = can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_DELETE);

    if (!isOwner && !hasPermission) {
      throw new ForbiddenError('You do not have permission to delete this document.');
    }

    // 1. Soft delete in DB
    await this.repository.softDelete(ctx.companyId, fileId, ctx.userId, poolOverride);

    // 2. Remove from MinIO
    try {
      const s3 = getS3Client();
      await s3.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.objectKey }));
    } catch (err) {
      logger.error({ err, fileId, objectKey: file.objectKey }, 'Failed to delete object from S3 during file deletion');
    }

    // 3. Record audit event
    await this.auditService.recordEvent(ctx, {
      action: 'file.delete',
      entity: 'file',
      entityId: fileId,
      before: {
        bucket: file.bucket,
        objectKey: file.objectKey,
        originalName: file.originalName,
      },
      poolOverride,
    });

    return { success: true };
  }

  /**
   * Lists files for an entity owner.
   */
  async listFilesByOwner(
    ctx: RequestContext,
    params: { ownerType: string; ownerId: string },
    poolOverride?: pg.Pool,
  ): Promise<FileRow[]> {
    const isOwner =
      params.ownerType === 'employee' && ctx.employeeId && ctx.employeeId === params.ownerId;
    const hasPermission = can(ctx, PERMISSIONS.EMPLOYEE_DOCUMENT_READ);

    if (!isOwner && !hasPermission) {
      throw new ForbiddenError('You do not have permission to view documents for this entity.');
    }

    return this.repository.listByOwner(ctx.companyId, params.ownerType, params.ownerId, poolOverride);
  }
}
