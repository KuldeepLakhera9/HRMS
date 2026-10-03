import { z } from 'zod';
import { createNextRoute, StorageService } from '@hrms/core';

const storageService = new StorageService();

const presignedUploadSchema = z.object({
  originalName: z.string().min(1, 'File name is required.').max(255),
  mime: z.string().min(1, 'MIME type is required.'),
  sizeBytes: z.number().int().positive('Size must be positive.'),
  ownerType: z.string().min(1, 'Owner type is required.'),
  ownerId: z.string().uuid('Owner ID must be a valid UUID.'),
});

export const POST = createNextRoute({
  schema: presignedUploadSchema,
  handler: async (input, ctx) => {
    const result = await storageService.createPresignedUpload(ctx, input);
    return { data: result };
  },
});
