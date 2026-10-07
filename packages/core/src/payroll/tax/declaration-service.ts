import { and, eq } from 'drizzle-orm';
import {
  Database,
  deductionCatalog,
  taxDeclarations,
  taxDeclarationItems,
  DeductionCatalog,
  TaxDeclaration,
  TaxDeclarationItem,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { compareRegimes, RegimeComparisonResult } from '../engines/regime-compare.js';
import { StatutoryRulesRepository } from '../rules/repository.js';
import { tdsRulePayloadSchema } from '../rules/schemas.js';

export interface SaveDeclarationDTO {
  employeeId: string;
  fy: string;
  regime: 'new' | 'old';
  regimeFormRef?: string;
  previousEmployer?: {
    companyName?: string;
    pan?: string;
    income?: number;
    tdsDeducted?: number;
    pf?: number;
    pt?: number;
    fromDate?: string;
    toDate?: string;
  };
  hraDetails?: {
    monthlyRent?: number;
    landlordName?: string;
    landlordPan?: string;
    cityType?: 'metro' | 'non_metro';
    address?: string;
  };
  notes?: string;
  items?: Array<{
    deductionCode: string;
    amountDeclared: number | string;
    proofFileId?: string;
    notes?: string;
  }>;
}

export interface VerifyItemDTO {
  proofStatus: 'verified' | 'rejected';
  amountVerified: number | string;
  notes?: string;
  rejectionReason?: string;
}

export interface CompareRegimesDTO {
  grossAnnual: number | string;
  deductions?: Record<string, number | string>;
  previousEmployerEarnings?: number | string;
  previousEmployerTds?: number | string;
}

export class TaxDeclarationService {
  constructor(private rulesRepo = new StatutoryRulesRepository()) {}

  /**
   * Asserts caller is either the employee themselves or has tax.declaration.verify permission.
   */
  private assertDeclarationAccess(ctx: RequestContext, targetEmployeeId: string): void {
    const isSelf = ctx.employeeId && ctx.employeeId === targetEmployeeId;
    const canVerify = ctx.permissions?.includes(PERMISSIONS.TAX_DECLARATION_VERIFY);
    if (!isSelf && !canVerify) {
      throw new ForbiddenError('Permission denied: You can only view or manage your own tax declarations');
    }
  }

  /**
   * Retrieves active deduction catalog entries for the company.
   * Auto-seeds standard statutory deductions (80C, 80D, 80CCD, 24B, etc.) if empty.
   */
  async getDeductionCatalog(ctx: RequestContext, db: Database): Promise<DeductionCatalog[]> {
    let items = await db
      .select()
      .from(deductionCatalog)
      .where(and(eq(deductionCatalog.companyId, ctx.companyId), eq(deductionCatalog.isActive, true)));

    if (items.length === 0) {
      await this.seedDefaultDeductionCatalog(ctx, db);
      items = await db
        .select()
        .from(deductionCatalog)
        .where(and(eq(deductionCatalog.companyId, ctx.companyId), eq(deductionCatalog.isActive, true)));
    }
    return items;
  }

  /**
   * Seeds default Indian Income Tax Act deduction catalog entries.
   */
  async seedDefaultDeductionCatalog(ctx: RequestContext, db: Database): Promise<void> {
    const defaults = [
      {
        companyId: ctx.companyId,
        code: '80C',
        label: 'Section 80C (PPF, ELSS, EPF, Life Insurance, Tuition Fees)',
        sectionRef: 'Section 80C',
        maxLimit: '150000.00',
        regimes: ['old'],
        requiresProof: true,
      },
      {
        companyId: ctx.companyId,
        code: '80CCD_1B',
        label: 'Section 80CCD(1B) - National Pension System (NPS)',
        sectionRef: 'Section 80CCD(1B)',
        maxLimit: '50000.00',
        regimes: ['old'],
        requiresProof: true,
      },
      {
        companyId: ctx.companyId,
        code: '80D',
        label: 'Section 80D - Medical Insurance Premium (Self & Parents)',
        sectionRef: 'Section 80D',
        maxLimit: '100000.00',
        regimes: ['old'],
        requiresProof: true,
      },
      {
        companyId: ctx.companyId,
        code: '24B',
        label: 'Section 24(b) - Interest on Home Loan (Self-Occupied)',
        sectionRef: 'Section 24(b)',
        maxLimit: '200000.00',
        regimes: ['old'],
        requiresProof: true,
      },
      {
        companyId: ctx.companyId,
        code: '10_13A',
        label: 'Section 10(13A) - House Rent Allowance (HRA) Exemption',
        sectionRef: 'Section 10(13A)',
        maxLimit: null,
        regimes: ['old'],
        requiresProof: true,
      },
      {
        companyId: ctx.companyId,
        code: '80E',
        label: 'Section 80E - Interest on Higher Education Loan',
        sectionRef: 'Section 80E',
        maxLimit: null,
        regimes: ['old'],
        requiresProof: true,
      },
      {
        companyId: ctx.companyId,
        code: '80G',
        label: 'Section 80G - Donations to Eligible Charitable Funds',
        sectionRef: 'Section 80G',
        maxLimit: null,
        regimes: ['old'],
        requiresProof: true,
      },
    ];

    for (const item of defaults) {
      await db
        .insert(deductionCatalog)
        .values(item)
        .onConflictDoNothing();
    }
  }

  /**
   * Retrieves an employee's tax declaration for a given FY, along with all declared items.
   */
  async getDeclaration(
    ctx: RequestContext,
    db: Database,
    employeeId: string,
    fy: string,
  ): Promise<{ declaration: TaxDeclaration | null; items: TaxDeclarationItem[] }> {
    this.assertDeclarationAccess(ctx, employeeId);

    const [decl] = await db
      .select()
      .from(taxDeclarations)
      .where(
        and(
          eq(taxDeclarations.companyId, ctx.companyId),
          eq(taxDeclarations.employeeId, employeeId),
          eq(taxDeclarations.fy, fy),
        ),
      );

    if (!decl) {
      return { declaration: null, items: [] };
    }

    const items = await db
      .select()
      .from(taxDeclarationItems)
      .where(
        and(
          eq(taxDeclarationItems.companyId, ctx.companyId),
          eq(taxDeclarationItems.declarationId, decl.id),
        ),
      );

    return { declaration: decl, items };
  }

  /**
   * Saves or updates an employee's tax declaration as a draft.
   */
  async saveDraftDeclaration(
    ctx: RequestContext,
    db: Database,
    dto: SaveDeclarationDTO,
  ): Promise<{ declaration: TaxDeclaration; items: TaxDeclarationItem[] }> {
    this.assertDeclarationAccess(ctx, dto.employeeId);

    // Check if declaration exists
    const [existing] = await db
      .select()
      .from(taxDeclarations)
      .where(
        and(
          eq(taxDeclarations.companyId, ctx.companyId),
          eq(taxDeclarations.employeeId, dto.employeeId),
          eq(taxDeclarations.fy, dto.fy),
        ),
      );

    if (existing && existing.status === 'locked') {
      throw new ValidationError('Declaration window is locked for this Financial Year');
    }

    let decl: TaxDeclaration;

    if (existing) {
      const [updated] = await db
        .update(taxDeclarations)
        .set({
          regime: dto.regime,
          regimeFormRef: dto.regimeFormRef || existing.regimeFormRef || 'Form 122',
          previousEmployer: (dto.previousEmployer as Record<string, unknown>) || existing.previousEmployer,
          hraDetails: (dto.hraDetails as Record<string, unknown>) || existing.hraDetails,
          notes: dto.notes ?? existing.notes,
          status: 'draft',
          updatedAt: new Date(),
          updatedBy: ctx.userId || null,
        })
        .where(and(eq(taxDeclarations.companyId, ctx.companyId), eq(taxDeclarations.id, existing.id)))
        .returning();
      if (!updated) throw new Error('Failed to update tax declaration');
      decl = updated;
    } else {
      const [created] = await db
        .insert(taxDeclarations)
        .values({
          companyId: ctx.companyId,
          employeeId: dto.employeeId,
          fy: dto.fy,
          regime: dto.regime,
          regimeFormRef: dto.regimeFormRef || 'Form 122',
          previousEmployer: (dto.previousEmployer as Record<string, unknown>) || {},
          hraDetails: (dto.hraDetails as Record<string, unknown>) || {},
          notes: dto.notes || null,
          status: 'draft',
          createdBy: ctx.userId || null,
          updatedBy: ctx.userId || null,
        })
        .returning();
      if (!created) throw new Error('Failed to create tax declaration');
      decl = created;
    }

    // Save line items
    if (dto.items && dto.items.length > 0) {
      for (const it of dto.items) {
        const declaredAmt = String(it.amountDeclared || 0);
        const [existingItem] = await db
          .select()
          .from(taxDeclarationItems)
          .where(
            and(
              eq(taxDeclarationItems.companyId, ctx.companyId),
              eq(taxDeclarationItems.declarationId, decl.id),
              eq(taxDeclarationItems.deductionCode, it.deductionCode),
            ),
          );

        if (existingItem) {
          await db
            .update(taxDeclarationItems)
            .set({
              amountDeclared: declaredAmt,
              proofFileId: it.proofFileId ? it.proofFileId : existingItem.proofFileId,
              notes: it.notes ?? existingItem.notes,
              proofStatus: it.proofFileId ? 'uploaded' : existingItem.proofStatus,
              updatedAt: new Date(),
              updatedBy: ctx.userId || null,
            })
            .where(
              and(
                eq(taxDeclarationItems.companyId, ctx.companyId),
                eq(taxDeclarationItems.id, existingItem.id),
              ),
            );
        } else {
          await db.insert(taxDeclarationItems).values({
            companyId: ctx.companyId,
            declarationId: decl.id,
            deductionCode: it.deductionCode,
            amountDeclared: declaredAmt,
            amountVerified: '0.00',
            proofStatus: it.proofFileId ? 'uploaded' : 'none',
            proofFileId: it.proofFileId || null,
            notes: it.notes || null,
            createdBy: ctx.userId || null,
            updatedBy: ctx.userId || null,
          });
        }
      }
    }

    const savedItems = await db
      .select()
      .from(taxDeclarationItems)
      .where(
        and(
          eq(taxDeclarationItems.companyId, ctx.companyId),
          eq(taxDeclarationItems.declarationId, decl.id),
        ),
      );

    return { declaration: decl, items: savedItems };
  }

  /**
   * Submits a draft declaration for HR/Finance review.
   */
  async submitDeclaration(
    ctx: RequestContext,
    db: Database,
    declarationId: string,
  ): Promise<TaxDeclaration> {
    const [decl] = await db
      .select()
      .from(taxDeclarations)
      .where(and(eq(taxDeclarations.companyId, ctx.companyId), eq(taxDeclarations.id, declarationId)));

    if (!decl) throw new NotFoundError('Tax declaration not found');
    this.assertDeclarationAccess(ctx, decl.employeeId);

    if (decl.status === 'locked') {
      throw new ValidationError('Cannot submit: Declaration is locked');
    }

    const [updated] = await db
      .update(taxDeclarations)
      .set({
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.userId || null,
      })
      .where(and(eq(taxDeclarations.companyId, ctx.companyId), eq(taxDeclarations.id, declarationId)))
      .returning();

    if (!updated) throw new NotFoundError('Tax declaration not found');
    return updated;
  }

  /**
   * HR/Finance item-level verification of investment proofs.
   */
  async verifyDeclarationItem(
    ctx: RequestContext,
    db: Database,
    itemId: string,
    dto: VerifyItemDTO,
  ): Promise<TaxDeclarationItem> {
    if (!ctx.permissions?.includes(PERMISSIONS.TAX_DECLARATION_VERIFY)) {
      throw new ForbiddenError('Permission denied: tax.declaration.verify required');
    }

    const [item] = await db
      .select()
      .from(taxDeclarationItems)
      .where(and(eq(taxDeclarationItems.companyId, ctx.companyId), eq(taxDeclarationItems.id, itemId)));

    if (!item) throw new NotFoundError('Declaration item not found');

    const verifiedAmount = dto.proofStatus === 'verified' ? String(dto.amountVerified || 0) : '0.00';

    const [updated] = await db
      .update(taxDeclarationItems)
      .set({
        proofStatus: dto.proofStatus,
        amountVerified: verifiedAmount,
        notes: dto.notes ?? item.notes,
        rejectionReason: dto.proofStatus === 'rejected' ? dto.rejectionReason || 'Proof document insufficient' : null,
        verifiedBy: ctx.userId || null,
        verifiedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.userId || null,
      })
      .where(and(eq(taxDeclarationItems.companyId, ctx.companyId), eq(taxDeclarationItems.id, itemId)))
      .returning();

    // Check if all items for the declaration have been verified
    const allItems = await db
      .select()
      .from(taxDeclarationItems)
      .where(
        and(
          eq(taxDeclarationItems.companyId, ctx.companyId),
          eq(taxDeclarationItems.declarationId, item.declarationId),
        ),
      );

    const allReviewed = allItems.every(i => i.proofStatus === 'verified' || i.proofStatus === 'rejected');
    if (allReviewed) {
      await db
        .update(taxDeclarations)
        .set({
          status: 'verified',
          updatedAt: new Date(),
          updatedBy: ctx.userId || null,
        })
        .where(
          and(
            eq(taxDeclarations.companyId, ctx.companyId),
            eq(taxDeclarations.id, item.declarationId),
          ),
        );
    }

    if (!updated) throw new NotFoundError('Tax declaration item not found');
    return updated;
  }

  /**
   * Locks the declaration for cut-off / year-end freeze.
   */
  async lockDeclaration(
    ctx: RequestContext,
    db: Database,
    declarationId: string,
  ): Promise<TaxDeclaration> {
    if (!ctx.permissions?.includes(PERMISSIONS.TAX_DECLARATION_VERIFY)) {
      throw new ForbiddenError('Permission denied: tax.declaration.verify required');
    }

    const [updated] = await db
      .update(taxDeclarations)
      .set({
        status: 'locked',
        updatedAt: new Date(),
        updatedBy: ctx.userId || null,
      })
      .where(and(eq(taxDeclarations.companyId, ctx.companyId), eq(taxDeclarations.id, declarationId)))
      .returning();

    if (!updated) throw new NotFoundError('Tax declaration not found');
    return updated;
  }

  /**
   * Regime comparison calculator using computeTds.
   */
  async compareRegimes(
    ctx: RequestContext,
    db: Database,
    dto: CompareRegimesDTO,
  ): Promise<RegimeComparisonResult> {
    if (!ctx.permissions?.includes(PERMISSIONS.TAX_REGIME_COMPARE)) {
      throw new ForbiddenError('Permission denied: tax.regime_compare.use required');
    }

    // Retrieve active TDS_IN rule
    const activeRule = await this.rulesRepo.getActiveRuleSet(
      db,
      ctx.companyId,
      'TDS_IN',
      'IN',
      new Date().toISOString().slice(0, 10),
    );

    if (!activeRule) {
      throw new NotFoundError('Active TDS_IN statutory rule set not found for regime comparison');
    }

    const ruleParsed = tdsRulePayloadSchema.parse(activeRule.payload);

    return compareRegimes({
      annualEarnings: dto.grossAnnual,
      rule: ruleParsed,
      verifiedDeductions: dto.deductions,
    });
  }
}
