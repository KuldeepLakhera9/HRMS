import {
  Database,
  PayrollPeriod,
  NewPayrollPeriod,
  PayrollRun,
  NewPayrollRun,
  PayrollRunEvent,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { PayrollRunRepository } from './repository.js';
import {
  executeRunTransition,
  PayrollRunStatus,
  TransitionOptions,
} from './state-machine.js';

export interface CreatePayrollPeriodDto {
  legalEntityId: string;
  period: string; // 'YYYY-MM'
  fy: string; // 'YYYY-YYYY'
  startDate: string;
  endDate: string;
  cutoffDate: string;
  payDate: string;
}

export interface CreatePayrollRunDto {
  periodId: string;
  runType?: 'regular' | 'off_cycle' | 'correction' | 'final';
  sequence?: number;
  notes?: string;
}

export class PayrollRunService {
  constructor(private repo = new PayrollRunRepository()) {}

  // --- Periods ---
  async createPeriod(
    ctx: RequestContext,
    db: Database,
    dto: CreatePayrollPeriodDto,
  ): Promise<PayrollPeriod> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_CREATE)) {
      throw new ForbiddenError('Permission denied: payroll.run.create required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const existing = await this.repo.getPeriodByEntityAndMonth(
      db,
      ctx.companyId,
      dto.legalEntityId,
      dto.period,
    );
    if (existing) {
      throw new ValidationError(`Payroll period ${dto.period} already exists for this legal entity`);
    }

    const newPeriod: NewPayrollPeriod = {
      companyId: ctx.companyId,
      legalEntityId: dto.legalEntityId,
      period: dto.period,
      fy: dto.fy,
      startDate: dto.startDate,
      endDate: dto.endDate,
      cutoffDate: dto.cutoffDate,
      payDate: dto.payDate,
      status: 'open',
      createdBy: userId,
      updatedBy: userId,
    };

    return this.repo.createPeriod(db, newPeriod);
  }

  async listPeriods(
    ctx: RequestContext,
    db: Database,
    legalEntityId?: string,
  ): Promise<PayrollPeriod[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ)) {
      throw new ForbiddenError('Permission denied: payroll.run.read required');
    }
    return this.repo.listPeriods(db, ctx.companyId, legalEntityId);
  }

  // --- Runs ---
  async createRun(
    ctx: RequestContext,
    db: Database,
    dto: CreatePayrollRunDto,
  ): Promise<PayrollRun> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_CREATE)) {
      throw new ForbiddenError('Permission denied: payroll.run.create required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const period = await this.repo.getPeriodById(db, ctx.companyId, dto.periodId);
    if (!period) {
      throw new NotFoundError('Payroll period not found');
    }

    const newRun: NewPayrollRun = {
      companyId: ctx.companyId,
      periodId: dto.periodId,
      runType: dto.runType || 'regular',
      sequence: dto.sequence || 1,
      status: 'draft',
      calcVersion: 1,
      ruleVersions: {},
      settingsSnapshot: {},
      engineVersion: '1.0.0',
      notes: dto.notes || null,
      createdBy: userId,
      updatedBy: userId,
    };

    return this.repo.createRun(db, newRun);
  }

  async transitionRun(
    ctx: RequestContext,
    db: Database,
    runId: string,
    toStatus: PayrollRunStatus,
    options: TransitionOptions = {},
  ): Promise<PayrollRun> {
    return executeRunTransition(ctx, db, runId, toStatus, options);
  }

  async getRun(ctx: RequestContext, db: Database, runId: string): Promise<PayrollRun> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ)) {
      throw new ForbiddenError('Permission denied: payroll.run.read required');
    }
    const run = await this.repo.getRunById(db, ctx.companyId, runId);
    if (!run) throw new NotFoundError('Payroll run not found');
    return run;
  }

  async listRuns(ctx: RequestContext, db: Database, periodId: string): Promise<PayrollRun[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ)) {
      throw new ForbiddenError('Permission denied: payroll.run.read required');
    }
    return this.repo.listRunsByPeriod(db, ctx.companyId, periodId);
  }

  async listRunEvents(ctx: RequestContext, db: Database, runId: string): Promise<PayrollRunEvent[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ)) {
      throw new ForbiddenError('Permission denied: payroll.run.read required');
    }
    return this.repo.listRunEvents(db, ctx.companyId, runId);
  }
}
