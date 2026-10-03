import { z } from 'zod';
import { createNextRoute, StorageService } from '@hrms/core';

const storageService = new StorageService();

const deleteFileSchema = z.object({
  id: z.string().uuid('File ID must be a valid UUID.'),
});

export const DELETE = createNextRoute({
  schema: deleteFileSchema,
  handler: async (input, ctx) => {
    const result = await storageService.deleteFile(ctx, input.id);
    return { data: result };
  },
});
