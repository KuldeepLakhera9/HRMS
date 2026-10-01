import type { DrizzleTransaction } from '@hrms/db';
import { ForbiddenError, NotFoundError } from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { can } from '../../routing/authorization.js';
import { sampleRepository } from './repository.js';
import { SAMPLE_POLICIES } from './policy.js';
import type { CreateSampleItemInput, CreateSampleSubitemInput } from './validation.js';
import type { SampleTenantItem, SampleTenantSubitem } from './schema.js';

export class SampleService {
  /**
   * Creates a new tenant item.
   * Checks authorization, enforces companyId context, and persists item.
   */
  async createItem(
    ctx: RequestContext,
    tx: DrizzleTransaction,
    input: CreateSampleItemInput,
  ): Promise<SampleTenantItem> {
    if (!can(ctx, SAMPLE_POLICIES.CREATE, { companyId: ctx.companyId })) {
      throw new ForbiddenError('You are not authorized to create items.');
    }

    return await sampleRepository.insert(tx, {
      companyId: ctx.companyId,
      name: input.name,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
  }

  /**
   * Creates a child subitem with composite foreign key.
   */
  async createSubitem(
    ctx: RequestContext,
    tx: DrizzleTransaction,
    input: CreateSampleSubitemInput,
  ): Promise<SampleTenantSubitem> {
    if (!can(ctx, SAMPLE_POLICIES.CREATE, { companyId: ctx.companyId })) {
      throw new ForbiddenError('You are not authorized to create subitems.');
    }

    return await sampleRepository.insertSubitem(tx, {
      companyId: ctx.companyId,
      parentId: input.parentId,
      name: input.name,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
  }

  /**
   * Retrieves an item by id, verifying tenant boundary and existence.
   */
  async getItem(
    ctx: RequestContext,
    tx: DrizzleTransaction,
    id: string,
  ): Promise<SampleTenantItem> {
    if (!can(ctx, SAMPLE_POLICIES.READ, { companyId: ctx.companyId })) {
      throw new ForbiddenError('You are not authorized to view this item.');
    }

    const item = await sampleRepository.findById(tx, ctx.companyId, id);
    if (!item) {
      throw new NotFoundError('SampleTenantItem', id);
    }
    return item;
  }
}

export const sampleService = new SampleService();
