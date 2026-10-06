import { Decimal } from 'decimal.js';
import {
  Database,
  SalaryRevision,
  NewSalaryRevision,
  payrollInputs,
  NewPayrollInput,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { SalaryRepository } from './repository.js';
import { calculateArrears, ArrearsCalculationResult } from './arrears.js';
import { assertSegregationOfDuties } from '../maker-checker.js';

export interface BulkRevisionItem {
  employeeId: string;
  newCtcAnnual: string;
  structureId?: string;
  structureVersion?: number;
  reason?: 'revision' | 'promotion' | 'correction';
}

export interface EmployeeRevisionPreview {
  employeeId: string;
  currentCtcAnnual: string;
  newCtcAnnual: string;
  annualDiff: string;
  monthlyDiff: string;
  arrears: ArrearsCalculationResult;
}

export interface BulkRevisionPreviewResult {
  effectiveFrom: string;
  effectiveFromPeriod: string;
  currentPeriod: string;
  totalEmployees: number;
  totalCurrentCtcAnnual: string;
  totalNewCtcAnnual: string;
  totalAnnualCostImpact: string;
  totalEstimatedArrears: string;
  employees: EmployeeRevisionPreview[];
}

export class SalaryRevisionService {
  constructor(private repo = new SalaryRepository()) {}

  /**
   * Previews the cost impact and arrears generation for a batch of employee salary revisions.
   */
  async previewBulkRevision(
    ctx: RequestContext,
    db: Database,
    input: {
      effectiveFrom: string; // 'YYYY-MM-DD'
      currentPeriod: string; // 'YYYY-MM'
      items: BulkRevisionItem[];
    },
  ): Promise<BulkRevisionPreviewResult> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SALARY_VIEW) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_SALARY_ASSIGN)) {
      throw new ForbiddenError('Permission denied: payroll.salary.view or assign required');
    }

    const effectiveFromPeriod = input.effectiveFrom.slice(0, 7);
    let totalCurrent = new Decimal(0);
    let totalNew = new Decimal(0);
    let totalArrears = new Decimal(0);

    const employees: EmployeeRevisionPreview[] = [];

    for (const item of input.items) {
      const activeSalary = await this.repo.getActiveSalaryAssignment(
        db,
        ctx.companyId,
        item.employeeId,
        input.effectiveFrom,
      );

      const currentCtc = activeSalary ? activeSalary.ctcAnnual : '0.00';
      const arrears = calculateArrears({
        currentCtcAnnual: currentCtc,
        newCtcAnnual: item.newCtcAnnual,
        effectiveFromPeriod,
        currentPeriod: input.currentPeriod,
      });

      const oldDec = new Decimal(currentCtc);
      const newDec = new Decimal(item.newCtcAnnual);
      const diffAnnual = newDec.minus(oldDec);
      const diffMonthly = diffAnnual.div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      totalCurrent = totalCurrent.plus(oldDec);
      totalNew = totalNew.plus(newDec);
      totalArrears = totalArrears.plus(new Decimal(arrears.totalArrears));

      employees.push({
        employeeId: item.employeeId,
        currentCtcAnnual: currentCtc,
        newCtcAnnual: item.newCtcAnnual,
        annualDiff: diffAnnual.toFixed(2),
        monthlyDiff: diffMonthly.toFixed(2),
        arrears,
      });
    }

    const totalAnnualCostImpact = totalNew.minus(totalCurrent).toFixed(2);

    return {
      effectiveFrom: input.effectiveFrom,
      effectiveFromPeriod,
      currentPeriod: input.currentPeriod,
      totalEmployees: input.items.length,
      totalCurrentCtcAnnual: totalCurrent.toFixed(2),
      totalNewCtcAnnual: totalNew.toFixed(2),
      totalAnnualCostImpact,
      totalEstimatedArrears: totalArrears.toFixed(2),
      employees,
    };
  }

  /**
   * Creates a draft bulk salary revision batch (Maker stage).
   */
  async createRevisionBatch(
    ctx: RequestContext,
    db: Database,
    input: {
      batchId: string;
      effectiveFrom: string;
      items: BulkRevisionItem[];
      arrearsPolicy?: Record<string, unknown>;
    },
  ): Promise<SalaryRevision> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SALARY_ASSIGN)) {
      throw new ForbiddenError('Permission denied: payroll.salary.assign required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const data: NewSalaryRevision = {
      companyId: ctx.companyId,
      batchId: input.batchId,
      effectiveFrom: input.effectiveFrom,
      rows: input.items as unknown as Array<Record<string, unknown>>,
      status: 'draft',
      arrearsPolicy: input.arrearsPolicy || {},
      createdBy: userId,
      updatedBy: userId,
    };

    return this.repo.createRevisionBatch(db, data);
  }

  /**
   * Approves and applies a salary revision batch (Checker stage).
   * Enforces Segregation of Duties and creates effective-dated assignments & arrears.
   */
  async approveRevisionBatch(
    ctx: RequestContext,
    db: Database,
    batchDbId: string,
    currentPeriod: string, // 'YYYY-MM'
  ): Promise<{ batch: SalaryRevision; arrearsGenerated: number }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SALARY_APPROVE)) {
      throw new ForbiddenError('Permission denied: payroll.salary.approve required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const batch = await this.repo.getRevisionBatchById(db, ctx.companyId, batchDbId);
    if (!batch) {
      throw new NotFoundError('Salary revision batch not found');
    }

    assertSegregationOfDuties(batch.createdBy, userId, 'salary revision batch');

    if (batch.status === 'applied') {
      throw new ValidationError('Salary revision batch has already been applied');
    }

    const items = batch.rows as unknown as BulkRevisionItem[];
    const effectiveFromPeriod = batch.effectiveFrom.slice(0, 7);
    let arrearsGenerated = 0;

    for (const item of items) {
      const activeSalary = await this.repo.getActiveSalaryAssignment(
        db,
        ctx.companyId,
        item.employeeId,
        batch.effectiveFrom,
      );

      const structureId = item.structureId || activeSalary?.structureId;
      const structureVersion = item.structureVersion || activeSalary?.structureVersion || 1;

      if (!structureId) {
        throw new ValidationError(`Structure not specified and no active salary found for employee ${item.employeeId}`);
      }

      // Close previous active salary: effectiveTo = day before batch.effectiveFrom
      if (activeSalary) {
        const fromDate = new Date(batch.effectiveFrom);
        fromDate.setDate(fromDate.getDate() - 1);
        const dayBefore = fromDate.toISOString().slice(0, 10);

        await this.repo.updateSalaryAssignment(db, ctx.companyId, activeSalary.id, {
          effectiveTo: dayBefore,
          updatedBy: userId,
        });
      }

      // Create new approved salary assignment
      await this.repo.createSalaryAssignment(db, {
        companyId: ctx.companyId,
        employeeId: item.employeeId,
        structureId,
        structureVersion,
        ctcAnnual: item.newCtcAnnual,
        overrides: {},
        effectiveFrom: batch.effectiveFrom,
        effectiveTo: null,
        reason: item.reason || 'revision',
        status: 'approved',
        makerId: batch.createdBy || userId,
        checkerId: userId,
        createdBy: userId,
        updatedBy: userId,
      });

      // Generate arrears if revision is backdated (effectiveFromPeriod < currentPeriod)
      if (activeSalary && effectiveFromPeriod < currentPeriod) {
        const arrearsCalc = calculateArrears({
          currentCtcAnnual: activeSalary.ctcAnnual,
          newCtcAnnual: item.newCtcAnnual,
          effectiveFromPeriod,
          currentPeriod,
        });

        for (const p of arrearsCalc.periods) {
          const diffVal = new Decimal(p.difference);
          if (diffVal.greaterThan(0)) {
            const inputRecord: NewPayrollInput = {
              companyId: ctx.companyId,
              employeeId: item.employeeId,
              type: 'arrear',
              componentCode: 'ARREAR',
              amount: p.difference,
              taxable: true,
              forPeriod: currentPeriod,
              sourceType: 'salary_revision',
              sourceId: `${batch.batchId}:${item.employeeId}:${p.period}`,
              status: 'approved',
              approvedBy: userId,
              note: `Backdated salary revision arrear for ${p.period}`,
              createdBy: userId,
              updatedBy: userId,
            };

            await db
              .insert(payrollInputs)
              .values(inputRecord)
              .onConflictDoNothing();

            arrearsGenerated++;
          }
        }
      }
    }

    const updatedBatch = await this.repo.updateRevisionBatch(db, ctx.companyId, batch.id, {
      status: 'applied',
      updatedBy: userId,
    });

    if (!updatedBatch) throw new Error('Failed to update revision batch status');

    return {
      batch: updatedBatch,
      arrearsGenerated,
    };
  }
}
