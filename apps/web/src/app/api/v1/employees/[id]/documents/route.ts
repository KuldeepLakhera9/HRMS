import { z } from 'zod';
import { createNextRoute, DocumentService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const documentService = new DocumentService();

const getDocumentsSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_DOCUMENT_READ,
  schema: getDocumentsSchema,
  handler: async (input, ctx) => {
    const docs = await documentService.listEmployeeDocuments(ctx, input.id);
    return { data: docs };
  },
});

const uploadDocumentSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
  type: z.string().min(1, 'Document type is required'),
  fileId: z.string().uuid('Valid fileId is required'),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be YYYY-MM-DD').optional().nullable(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD,
  schema: uploadDocumentSchema,
  handler: async (input, ctx) => {
    const doc = await documentService.uploadDocument(
      ctx,
      input.id,
      {
        type: input.type,
        fileId: input.fileId,
        expiry: input.expiry,
      },
    );
    return { data: doc };
  },
});
