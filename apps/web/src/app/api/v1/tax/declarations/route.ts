import { z } from 'zod';
import { createNextRoute, TaxDeclarationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const taxService = new TaxDeclarationService();

const getDeclarationSchema = z.object({
  employeeId: z.string().uuid(),
  fy: z.string().default('2026-2027'),
});

const saveDeclarationSchema = z.object({
  employeeId: z.string().uuid(),
  fy: z.string(),
  regime: z.enum(['new', 'old']),
  regimeFormRef: z.string().optional(),
  previousEmployer: z
    .object({
      companyName: z.string().optional(),
      pan: z.string().optional(),
      income: z.number().optional(),
      tdsDeducted: z.number().optional(),
      pf: z.number().optional(),
      pt: z.number().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    })
    .optional(),
  hraDetails: z
    .object({
      monthlyRent: z.number().optional(),
      landlordName: z.string().optional(),
      landlordPan: z.string().optional(),
      cityType: z.enum(['metro', 'non_metro']).optional(),
      address: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        deductionCode: z.string(),
        amountDeclared: z.union([z.number(), z.string()]),
        proofFileId: z.string().uuid().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.TAX_DECLARATION_SUBMIT,
  schema: getDeclarationSchema,
  handler: async (input, ctx, tx) => {
    const result = await taxService.getDeclaration(ctx, tx!, input.employeeId, input.fy);
    return { success: true, ...result };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.TAX_DECLARATION_SUBMIT,
  schema: saveDeclarationSchema,
  handler: async (input, ctx, tx) => {
    const result = await taxService.saveDraftDeclaration(ctx, tx!, input);
    return { success: true, ...result };
  },
});
