import { z } from 'zod';
import { createNextRoute, DocumentService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const documentService = new DocumentService();

const verifyDocumentRouteSchema = z.object({
  id: z.string().uuid('Employee ID must be a valid UUID.'),
  docId: z.string().uuid('Document ID must be a valid UUID.'),
  status: z.enum(['verified', 'rejected']),
  comment: z.string().max(500).optional(),
});

export const PATCH = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_DOCUMENT_VERIFY,
  schema: verifyDocumentRouteSchema,
  handler: async (input, ctx) => {
    const updated = await documentService.verifyDocument(
      ctx,
      input.id,
      input.docId,
      {
        status: input.status,
        comment: input.comment,
      },
    );
    return { data: updated };
  },
});
