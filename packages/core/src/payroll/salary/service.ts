import {
  Database,
  SalaryComponent,
  NewSalaryComponent,
  SalaryStructure,
  NewSalaryStructure,
  EmployeeSalary,
  NewEmployeeSalary,
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
import {
  calculateCtcBreakup,
  CtcBreakupResult,
  StructureComponentDef,
} from './ctc-calculator.js';
import { analyzeFormulaDependencies } from '../formula/dependency-graph.js';
import { assertSegregationOfDuties } from '../maker-checker.js';
import { assertStepUp, maskField } from '../crypto/cipher.js';

export class SalaryService {
  constructor(private repo = new SalaryRepository()) {}

  // --- Components ---
  async createComponent(
    ctx: RequestContext,
    db: Database,
    dto: Omit<NewSalaryComponent, 'companyId' | 'makerId' | 'status' | 'version' | 'createdBy' | 'updatedBy'>,
  ): Promise<SalaryComponent> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_COMPONENT_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.component.manage required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const existing = await this.repo.getComponentByCode(db, ctx.companyId, dto.code);
    const version = existing ? existing.version + 1 : 1;

    return this.repo.createComponent(db, {
      ...dto,
      companyId: ctx.companyId,
      version,
      status: 'draft',
      createdBy: userId,
      updatedBy: userId,
    });
  }

  async approveComponent(
    ctx: RequestContext,
    db: Database,
    componentId: string,
  ): Promise<SalaryComponent> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_COMPONENT_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.component.manage required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const component = await this.repo.getComponentById(db, ctx.companyId, componentId);
    if (!component) throw new NotFoundError('Salary component not found');

    assertSegregationOfDuties(component.createdBy, userId, 'salary component');

    const updated = await this.repo.updateComponent(db, ctx.companyId, componentId, {
      status: 'approved',
      updatedBy: userId,
    });
    if (!updated) throw new Error('Failed to approve salary component');
    return updated;
  }

  async listComponents(ctx: RequestContext, db: Database): Promise<SalaryComponent[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_COMPONENT_READ)) {
      throw new ForbiddenError('Permission denied: payroll.component.read required');
    }
    return this.repo.listComponents(db, ctx.companyId);
  }

  // --- Structures ---
  async createStructure(
    ctx: RequestContext,
    db: Database,
    name: string,
    components: StructureComponentDef[],
    validations: Record<string, unknown> = {},
  ): Promise<SalaryStructure> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STRUCTURE_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.structure.manage required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    if (components.length === 0) {
      throw new ValidationError('Salary structure must contain at least one component');
    }

    // Verify formula dependency graph is valid & cycle-free
    const formulaMap: Record<string, string> = { CTC: '', MONTHLY_CTC: '', GROSS: '' };
    for (const c of components) {
      if (c.calc === 'formula' && c.formula) formulaMap[c.code] = c.formula;
      else formulaMap[c.code] = '';
    }

    const analysis = analyzeFormulaDependencies(formulaMap);
    if (analysis.hasCycle) {
      throw new ValidationError(
        `Cycle detected in structure formulas: ${analysis.cyclePath?.join(' -> ')}`,
      );
    }

    const balancingCount = components.filter(c => c.isBalancing).length;
    if (balancingCount > 1) {
      throw new ValidationError('Salary structure cannot have more than one balancing component');
    }

    const structureData: NewSalaryStructure = {
      companyId: ctx.companyId,
      name,
      version: 1,
      components,
      validations,
      status: 'draft',
      createdBy: userId,
      updatedBy: userId,
    };

    return this.repo.createStructure(db, structureData);
  }

  async approveStructure(
    ctx: RequestContext,
    db: Database,
    structureId: string,
  ): Promise<SalaryStructure> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STRUCTURE_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.structure.manage required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const structure = await this.repo.getStructureById(db, ctx.companyId, structureId);
    if (!structure) throw new NotFoundError('Salary structure not found');

    assertSegregationOfDuties(structure.createdBy, userId, 'salary structure');

    const updated = await this.repo.updateStructure(db, ctx.companyId, structureId, {
      status: 'approved',
      updatedBy: userId,
    });
    if (!updated) throw new Error('Failed to approve structure');
    return updated;
  }

  async listStructures(ctx: RequestContext, db: Database): Promise<SalaryStructure[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STRUCTURE_READ)) {
      throw new ForbiddenError('Permission denied: payroll.structure.read required');
    }
    return this.repo.listStructures(db, ctx.companyId);
  }

  // --- Employee Salary Assignment ---
  async assignSalary(
    ctx: RequestContext,
    db: Database,
    dto: {
      employeeId: string;
      structureId: string;
      structureVersion: number;
      ctcAnnual: string;
      effectiveFrom: string;
      effectiveTo?: string;
      reason: 'join' | 'revision' | 'promotion' | 'correction';
      overrides?: Record<string, unknown>;
    },
  ): Promise<EmployeeSalary> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SALARY_ASSIGN)) {
      throw new ForbiddenError('Permission denied: payroll.salary.assign required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const structure = await this.repo.getStructureById(db, ctx.companyId, dto.structureId);
    if (!structure) throw new NotFoundError('Salary structure not found');
    if (structure.status !== 'approved') {
      throw new ValidationError('Cannot assign an unapproved salary structure');
    }

    const newAssignment: NewEmployeeSalary = {
      companyId: ctx.companyId,
      employeeId: dto.employeeId,
      structureId: dto.structureId,
      structureVersion: dto.structureVersion,
      ctcAnnual: dto.ctcAnnual,
      overrides: dto.overrides || {},
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo || null,
      reason: dto.reason,
      status: 'draft',
      makerId: userId,
      createdBy: userId,
      updatedBy: userId,
    };

    return this.repo.createSalaryAssignment(db, newAssignment);
  }

  async approveSalaryAssignment(
    ctx: RequestContext,
    db: Database,
    assignmentId: string,
  ): Promise<EmployeeSalary> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SALARY_APPROVE)) {
      throw new ForbiddenError('Permission denied: payroll.salary.approve required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const assignment = await this.repo.getSalaryAssignmentById(db, ctx.companyId, assignmentId);
    if (!assignment) throw new NotFoundError('Salary assignment not found');

    assertSegregationOfDuties(assignment.makerId, userId, 'salary assignment');

    const updated = await this.repo.updateSalaryAssignment(db, ctx.companyId, assignmentId, {
      status: 'approved',
      checkerId: userId,
      updatedBy: userId,
    });
    if (!updated) throw new Error('Failed to approve salary assignment');
    return updated;
  }

  async getEmployeeSalary(
    ctx: RequestContext,
    db: Database,
    employeeId: string,
    asOfDate: string,
    options?: { requireStepUp?: boolean; mask?: boolean },
  ): Promise<EmployeeSalary | null> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SALARY_VIEW)) {
      throw new ForbiddenError('Permission denied: payroll.salary.view required');
    }

    if (options?.requireStepUp) {
      assertStepUp(ctx, 'view employee salary');
    }

    const assignment = await this.repo.getActiveSalaryAssignment(db, ctx.companyId, employeeId, asOfDate);
    if (!assignment) return null;

    if (options?.mask) {
      return {
        ...assignment,
        ctcAnnual: maskField(assignment.ctcAnnual, 'salary'),
      };
    }

    return assignment;
  }

  async simulateCtcBreakup(
    ctx: RequestContext,
    db: Database,
    structureId: string,
    ctcAnnual: string,
  ): Promise<CtcBreakupResult> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STRUCTURE_READ)) {
      throw new ForbiddenError('Permission denied: payroll.structure.read required');
    }

    const structure = await this.repo.getStructureById(db, ctx.companyId, structureId);
    if (!structure) throw new NotFoundError('Salary structure not found');

    const components = structure.components as StructureComponentDef[];
    return calculateCtcBreakup(ctcAnnual, components);
  }
}
