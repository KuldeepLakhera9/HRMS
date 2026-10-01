import { z } from 'zod';

export const createSampleItemSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
});

export type CreateSampleItemInput = z.infer<typeof createSampleItemSchema>;

export const createSampleSubitemSchema = z.object({
  parentId: z.string().uuid('Valid parentId is required'),
  name: z.string().min(1, 'Name is required').max(100),
});

export type CreateSampleSubitemInput = z.infer<typeof createSampleSubitemSchema>;
