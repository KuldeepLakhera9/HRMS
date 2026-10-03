import { z } from 'zod';
import { createNextRoute, StorageService } from '@hrms/core';

const storageService = new StorageService();

const getDownloadUrlSchema = z.object({
  id: z.string().uuid('File ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  schema: getDownloadUrlSchema,
  handler: async (input, ctx) => {
    const result = await storageService.getPresignedDownloadUrl(ctx, input.id);
    return { data: result };
  },
});
