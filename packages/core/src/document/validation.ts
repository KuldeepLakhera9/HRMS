import { z } from 'zod';

export const createDocumentSchema = z.object({
  type: z.string().min(1, 'Document type is required'),
  fileId: z.string().uuid('Valid fileId is required'),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be YYYY-MM-DD').optional().nullable(),
});

export const verifyDocumentSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  comment: z.string().max(500).optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type VerifyDocumentInput = z.infer<typeof verifyDocumentSchema>;
