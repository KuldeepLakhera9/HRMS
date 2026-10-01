import { eq, and, isNull } from 'drizzle-orm';
import type { DrizzleTransaction } from '@hrms/db';
import {
  sampleTenantItems,
  sampleTenantSubitems,
  type SampleTenantItem,
  type NewSampleTenantItem,
  type SampleTenantSubitem,
  type NewSampleTenantSubitem,
} from './schema.js';

export class SampleRepository {
  /**
   * Find item by ID, always filtering by companyId and soft delete check.
   */
  async findById(
    tx: DrizzleTransaction,
    companyId: string,
    id: string,
  ): Promise<SampleTenantItem | null> {
    const rows = await tx
      .select()
      .from(sampleTenantItems)
      .where(
        and(
          eq(sampleTenantItems.companyId, companyId),
          eq(sampleTenantItems.id, id),
          isNull(sampleTenantItems.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Insert a new tenant item.
   */
  async insert(
    tx: DrizzleTransaction,
    data: NewSampleTenantItem,
  ): Promise<SampleTenantItem> {
    const rows = await tx
      .insert(sampleTenantItems)
      .values(data)
      .returning();

    const created = rows[0];
    if (!created) {
      throw new Error('Failed to insert sample tenant item');
    }
    return created;
  }

  /**
   * Insert a new child subitem with composite foreign key.
   */
  async insertSubitem(
    tx: DrizzleTransaction,
    data: NewSampleTenantSubitem,
  ): Promise<SampleTenantSubitem> {
    const rows = await tx
      .insert(sampleTenantSubitems)
      .values(data)
      .returning();

    const created = rows[0];
    if (!created) {
      throw new Error('Failed to insert sample tenant subitem');
    }
    return created;
  }
}

export const sampleRepository = new SampleRepository();
