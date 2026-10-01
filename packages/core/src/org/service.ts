import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { getRedisClient } from '../redis/client.js';
import {
  OrgRepository,
  type DepartmentRow,
  type DesignationRow,
  type GradeRow,
  type CostCenterRow,
  type CompanyRow,
} from './repository.js';

export interface DepartmentTreeNode extends DepartmentRow {
  children: DepartmentTreeNode[];
}

const CACHE_TTL_SECONDS = 300; // 5 minutes

export class OrgService {
  private repository: OrgRepository;

  constructor(repository?: OrgRepository) {
    this.repository = repository ?? new OrgRepository();
  }

  private async invalidateOrgCache(companyId: string, prefix: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(`${prefix}:${companyId}`);
    } catch {
      // Non-fatal if Redis cache invalidation fails
    }
  }

  // ==========================================================================
  // Departments
  // ==========================================================================
  async createDepartment(
    ctx: RequestContext,
    params: {
      name: string;
      code: string;
      parentId?: string | null | undefined;
      headEmployeeId?: string | null | undefined;
      active?: boolean | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<DepartmentRow> {
    if (!can(ctx, PERMISSIONS.ORG_DEPARTMENT_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage departments.');
    }

    if (params.parentId) {
      const parent = await this.repository.findDepartmentById(ctx.companyId, params.parentId, poolOverride);
      if (!parent) {
        throw new NotFoundError('Parent department not found.');
      }
    }

    const dept = await this.repository.createDepartment(
      {
        companyId: ctx.companyId,
        name: params.name,
        code: params.code,
        parentId: params.parentId,
        headEmployeeId: params.headEmployeeId,
        active: params.active,
        userId: ctx.userId,
      },
      poolOverride,
    );

    await this.invalidateOrgCache(ctx.companyId, 'org:depts');
    await this.invalidateOrgCache(ctx.companyId, 'org:dept_tree');
    return dept;
  }

  async updateDepartment(
    ctx: RequestContext,
    id: string,
    params: {
      name?: string | undefined;
      code?: string | undefined;
      parentId?: string | null | undefined;
      headEmployeeId?: string | null | undefined;
      active?: boolean | undefined;
    },
    poolOverride?: pg.Pool,
  ): Promise<DepartmentRow> {
    if (!can(ctx, PERMISSIONS.ORG_DEPARTMENT_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage departments.');
    }

    const existing = await this.repository.findDepartmentById(ctx.companyId, id, poolOverride);
    if (!existing) {
      throw new NotFoundError('Department not found.');
    }

    // Cycle detection
    if (params.parentId !== undefined && params.parentId !== null) {
      if (params.parentId === id) {
        throw new ValidationError('A department cannot be its own parent.');
      }

      // Check if target parent is a descendant of this department
      const ancestorsOfNewParent = await this.repository.getDepartmentAncestors(
        ctx.companyId,
        params.parentId,
        poolOverride,
      );

      if (ancestorsOfNewParent.includes(id)) {
        throw new ValidationError(
          'Cycle detected: a department cannot be placed under its own descendant.',
        );
      }
    }

    const updated = await this.repository.updateDepartment(
      {
        companyId: ctx.companyId,
        id,
        name: params.name,
        code: params.code,
        parentId: params.parentId,
        headEmployeeId: params.headEmployeeId,
        active: params.active,
        userId: ctx.userId,
      },
      poolOverride,
    );

    if (!updated) {
      throw new NotFoundError('Department not found.');
    }

    await this.invalidateOrgCache(ctx.companyId, 'org:depts');
    await this.invalidateOrgCache(ctx.companyId, 'org:dept_tree');
    return updated;
  }

  async deleteDepartment(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<void> {
    if (!can(ctx, PERMISSIONS.ORG_DEPARTMENT_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage departments.');
    }

    const success = await this.repository.deleteDepartment(
      ctx.companyId,
      id,
      ctx.userId,
      poolOverride,
    );

    if (!success) {
      throw new NotFoundError('Department not found.');
    }

    await this.invalidateOrgCache(ctx.companyId, 'org:depts');
    await this.invalidateOrgCache(ctx.companyId, 'org:dept_tree');
  }

  async listDepartments(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<DepartmentRow[]> {
    if (!can(ctx, PERMISSIONS.ORG_DEPARTMENT_READ)) {
      throw new ForbiddenError('You do not have permission to view departments.');
    }

    const cacheKey = `org:depts:${ctx.companyId}`;
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DepartmentRow[];
      }
    } catch {
      // Non-fatal
    }

    const depts = await this.repository.listDepartments(ctx.companyId, poolOverride);

    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, JSON.stringify(depts), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Non-fatal
    }

    return depts;
  }

  async getDepartmentTree(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<DepartmentTreeNode[]> {
    if (!can(ctx, PERMISSIONS.ORG_DEPARTMENT_READ)) {
      throw new ForbiddenError('You do not have permission to view departments.');
    }

    const cacheKey = `org:dept_tree:${ctx.companyId}`;
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DepartmentTreeNode[];
      }
    } catch {
      // Non-fatal
    }

    const allDepts = await this.listDepartments(ctx, poolOverride);

    // Build hierarchical tree
    const map = new Map<string, DepartmentTreeNode>();
    const roots: DepartmentTreeNode[] = [];

    for (const d of allDepts) {
      map.set(d.id, { ...d, children: [] });
    }

    for (const d of allDepts) {
      const node = map.get(d.id)!;
      if (d.parentId && map.has(d.parentId)) {
        map.get(d.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, JSON.stringify(roots), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Non-fatal
    }

    return roots;
  }

  // ==========================================================================
  // Designations
  // ==========================================================================
  async createDesignation(
    ctx: RequestContext,
    params: { name: string; code: string; active?: boolean | undefined },
    poolOverride?: pg.Pool,
  ): Promise<DesignationRow> {
    if (!can(ctx, PERMISSIONS.ORG_DESIGNATION_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage designations.');
    }

    const desig = await this.repository.createDesignation(
      {
        companyId: ctx.companyId,
        name: params.name,
        code: params.code,
        active: params.active,
        userId: ctx.userId,
      },
      poolOverride,
    );

    await this.invalidateOrgCache(ctx.companyId, 'org:desigs');
    return desig;
  }

  async listDesignations(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<DesignationRow[]> {
    if (!can(ctx, PERMISSIONS.ORG_DESIGNATION_READ)) {
      throw new ForbiddenError('You do not have permission to view designations.');
    }

    const cacheKey = `org:desigs:${ctx.companyId}`;
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DesignationRow[];
      }
    } catch {
      // Non-fatal
    }

    const list = await this.repository.listDesignations(ctx.companyId, poolOverride);

    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, JSON.stringify(list), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Non-fatal
    }

    return list;
  }

  // ==========================================================================
  // Grades
  // ==========================================================================
  async createGrade(
    ctx: RequestContext,
    params: { name: string; code: string; level?: number | undefined; active?: boolean | undefined },
    poolOverride?: pg.Pool,
  ): Promise<GradeRow> {
    if (!can(ctx, PERMISSIONS.ORG_GRADE_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage grades.');
    }

    const grade = await this.repository.createGrade(
      {
        companyId: ctx.companyId,
        name: params.name,
        code: params.code,
        level: params.level,
        active: params.active,
        userId: ctx.userId,
      },
      poolOverride,
    );

    await this.invalidateOrgCache(ctx.companyId, 'org:grades');
    return grade;
  }

  async listGrades(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<GradeRow[]> {
    if (!can(ctx, PERMISSIONS.ORG_GRADE_READ)) {
      throw new ForbiddenError('You do not have permission to view grades.');
    }

    const cacheKey = `org:grades:${ctx.companyId}`;
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as GradeRow[];
      }
    } catch {
      // Non-fatal
    }

    const list = await this.repository.listGrades(ctx.companyId, poolOverride);

    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, JSON.stringify(list), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Non-fatal
    }

    return list;
  }

  // ==========================================================================
  // Cost Centers
  // ==========================================================================
  async createCostCenter(
    ctx: RequestContext,
    params: { name: string; code: string; active?: boolean | undefined },
    poolOverride?: pg.Pool,
  ): Promise<CostCenterRow> {
    if (!can(ctx, PERMISSIONS.ORG_COSTCENTER_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage cost centers.');
    }

    const cc = await this.repository.createCostCenter(
      {
        companyId: ctx.companyId,
        name: params.name,
        code: params.code,
        active: params.active,
        userId: ctx.userId,
      },
      poolOverride,
    );

    await this.invalidateOrgCache(ctx.companyId, 'org:costcenters');
    return cc;
  }

  async listCostCenters(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<CostCenterRow[]> {
    if (!can(ctx, PERMISSIONS.ORG_COSTCENTER_READ)) {
      throw new ForbiddenError('You do not have permission to view cost centers.');
    }

    const cacheKey = `org:costcenters:${ctx.companyId}`;
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as CostCenterRow[];
      }
    } catch {
      // Non-fatal
    }

    const list = await this.repository.listCostCenters(ctx.companyId, poolOverride);

    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, JSON.stringify(list), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Non-fatal
    }

    return list;
  }

  // ==========================================================================
  // Company
  // ==========================================================================
  async getCompany(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<CompanyRow> {
    if (!can(ctx, PERMISSIONS.ORG_COMPANY_READ)) {
      throw new ForbiddenError('You do not have permission to view company details.');
    }

    const comp = await this.repository.findCompanyById(ctx.companyId, poolOverride);
    if (!comp) {
      throw new NotFoundError('Company not found.');
    }
    return comp;
  }

  async updateCompany(
    ctx: RequestContext,
    data: { name?: string | undefined; legalName?: string | undefined; logoUrl?: string | null | undefined },
    poolOverride?: pg.Pool,
  ): Promise<CompanyRow> {
    if (!can(ctx, PERMISSIONS.ORG_COMPANY_UPDATE)) {
      throw new ForbiddenError('You do not have permission to update company details.');
    }

    const updated = await this.repository.updateCompany(ctx.companyId, data, poolOverride);
    if (!updated) {
      throw new NotFoundError('Company not found.');
    }
    return updated;
  }
}
