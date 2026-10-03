import { z } from 'zod';
import { createNextRoute, StorageService } from '@hrms/core';

const storageService = new StorageService();

const confirmUploadSchema = z.object({
  id: z.string().uuid('File ID must be a valid UUID.'),
});

export const POST = createNextRoute({
  schema: confirmUploadSchema,
  handler: async (input, ctx) => {
    const file = await storageService.confirmUpload(ctx, input.id);
    return { data: file };
  },
});
