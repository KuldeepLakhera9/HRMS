import type pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../rbac/can.js';
import { getRedisClient } from '../redis/client.js';
import { AuditService } from '../audit/service.js';
import { CustomFieldRepository } from './repository.js';
import {
  buildDynamicValidator,
  type CreateCustomFieldInput,
  type UpdateCustomFieldInput,
  type CustomFieldDefinitionRecord,
} from './validation.js';

export class CustomFieldService {
  private repository: CustomFieldRepository;
  private auditService: AuditService;

  constructor(repository?: CustomFieldRepository, auditService?: AuditService) {
    this.repository = repository ?? new CustomFieldRepository();
    this.auditService = auditService ?? new AuditService();
  }

  private getCacheKey(companyId: string, entity: string): string {
    return `cf:${companyId}:${entity}`;
  }

  private async invalidateCache(companyId: string, entity: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(this.getCacheKey(companyId, entity));
    } catch {
      // Redis failure should not block core operations
    }
  }

  /**
   * Retrieves all active custom field definitions for an entity, utilizing Redis cache.
   */
  async listDefinitions(
    ctx: RequestContext,
    entity: 'employee' | 'department' | 'location',
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord[]> {
    if (!can(ctx, PERMISSIONS.ORG_CUSTOMFIELD_READ)) {
      throw new ForbiddenError('You do not have permission to view custom field definitions.');
    }

    const cacheKey = this.getCacheKey(ctx.companyId, entity);

    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Cache miss / error fallback
    }

    const definitions = await this.repository.listByEntity(ctx.companyId, entity, poolOverride);

    try {
      const redis = getRedisClient();
      await redis.set(cacheKey, JSON.stringify(definitions), 'EX', 300);
    } catch {
      // Ignore cache write error
    }

    return definitions;
  }

  /**
   * Creates a new custom field definition and invalidates cache.
   */
  async createDefinition(
    ctx: RequestContext,
    input: CreateCustomFieldInput,
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord> {
    if (!can(ctx, PERMISSIONS.ORG_CUSTOMFIELD_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage custom field definitions.');
    }

    // Check unique key
    const existing = await this.repository.findByKey(ctx.companyId, input.entity, input.key, poolOverride);
    if (existing) {
      throw new ConflictError(`Custom field with key '${input.key}' already exists for ${input.entity}.`);
    }

    const created = await this.repository.create(
      ctx.companyId,
      { ...input, createdBy: ctx.userId },
      undefined,
      poolOverride,
    );

    await this.invalidateCache(ctx.companyId, input.entity);

    await this.auditService.recordEvent(ctx, {
      action: 'org.customfield.create',
      entity: 'custom_field_definitions',
      entityId: created.id,
      after: created as unknown as Record<string, unknown>,
      poolOverride,
    });

    return created;
  }

  /**
   * Updates an existing custom field definition and invalidates cache.
   */
  async updateDefinition(
    ctx: RequestContext,
    id: string,
    input: UpdateCustomFieldInput,
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord> {
    if (!can(ctx, PERMISSIONS.ORG_CUSTOMFIELD_MANAGE)) {
      throw new ForbiddenError('You do not have permission to manage custom field definitions.');
    }

    const current = await this.repository.findById(ctx.companyId, id, poolOverride);
    if (!current) {
      throw new NotFoundError('Custom field definition not found.');
    }

    const updated = await this.repository.update(
      ctx.companyId,
      id,
      { ...input, updatedBy: ctx.userId },
      undefined,
      poolOverride,
    );

    if (!updated) {
      throw new NotFoundError('Custom field definition not found.');
    }

    await this.invalidateCache(ctx.companyId, current.entity);

    await this.auditService.recordEvent(ctx, {
      action: 'org.customfield.update',
      entity: 'custom_field_definitions',
      entityId: id,
      before: current as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      poolOverride,
    });

    return updated;
  }

  /**
   * Deletes a custom field definition and invalidates cache.
   */
  async deleteDefinition(
    ctx: RequestContext,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<{ success: boolean }> {
    if (!can(ctx, PERMISSIONS.ORG_CUSTOMFIELD_MANAGE)) {
      throw new ForbiddenError('You do not have permission to delete custom field definitions.');
    }

    const current = await this.repository.findById(ctx.companyId, id, poolOverride);
    if (!current) {
      throw new NotFoundError('Custom field definition not found.');
    }

    const deleted = await this.repository.delete(ctx.companyId, id, poolOverride);
    if (!deleted) {
      throw new NotFoundError('Custom field definition not found.');
    }

    await this.invalidateCache(ctx.companyId, current.entity);

    await this.auditService.recordEvent(ctx, {
      action: 'org.customfield.delete',
      entity: 'custom_field_definitions',
      entityId: id,
      before: current as unknown as Record<string, unknown>,
      poolOverride,
    });

    return { success: true };
  }

  /**
   * Dynamically validates an entity's custom fields against its active definitions.
   */
  async validateValues(
    companyId: string,
    entity: 'employee' | 'department' | 'location',
    values: unknown,
    poolOverride?: pg.Pool,
  ): Promise<Record<string, unknown>> {
    // Read through cached definitions or repository directly
    const definitions = await this.repository.listByEntity(companyId, entity, poolOverride);
    if (definitions.length === 0) {
      return {};
    }

    const validator = buildDynamicValidator(definitions);
    const result = validator.safeParse(values ?? {});

    if (!result.success) {
      const issue = result.error.issues[0];
      throw new ValidationError(
        issue ? `${issue.path.join('.')}: ${issue.message}` : 'Custom fields validation failed',
      );
    }

    return result.data;
  }
}
