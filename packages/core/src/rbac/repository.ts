import type pg from 'pg';
import { getAppPool } from '@hrms/db';

/**
 * Base abstract repository class enforcing tenant isolation at the data access layer.
 * All repository implementations MUST extend this class and ensure `companyId` is bound
 * to all queries, inserts, updates, and deletes.
 */
export abstract class TenantRepository {
  protected readonly companyId: string;
  protected readonly client: pg.PoolClient | pg.Pool | undefined;

  constructor(companyId: string, client?: pg.PoolClient | pg.Pool | undefined) {
    if (!companyId) {
      throw new Error('[TenantRepository] companyId is mandatory for all repository instances.');
    }
    this.companyId = companyId;
    this.client = client;
  }

  /**
   * Returns the database executor (provided transaction client or default app pool).
   */
  protected get db(): pg.PoolClient | pg.Pool {
    return this.client ?? getAppPool();
  }

  /**
   * Returns the bound tenant company ID.
   */
  public getCompanyId(): string {
    return this.companyId;
  }
}
