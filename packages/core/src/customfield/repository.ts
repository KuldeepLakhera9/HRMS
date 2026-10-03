import type pg from 'pg';
import { generateUuidV7, withTenant } from '@hrms/db';
import type {
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
  CustomFieldDefinitionRecord,
} from './validation.js';

interface RawCustomFieldRow extends Omit<CustomFieldDefinitionRecord, 'options' | 'validation'> {
  options: string;
  validation: string;
}

function mapRow(row: RawCustomFieldRow): CustomFieldDefinitionRecord {
  return {
    ...row,
    options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options || [],
    validation: typeof row.validation === 'string' ? JSON.parse(row.validation) : row.validation || {},
  };
}

export class CustomFieldRepository {
  /**
   * Lists all active custom field definitions for an entity ordered by sort_order ASC, label ASC.
   */
  async listByEntity(
    companyId: string,
    entity: string,
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord[]> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<RawCustomFieldRow>(
          `SELECT id, company_id as "companyId", entity, key, label, type,
                  required, options, section, sort_order as "sortOrder",
                  view_permission as "viewPermission", edit_permission as "editPermission",
                  validation, created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM custom_field_definitions
           WHERE company_id = $1 AND entity = $2 AND deleted_at IS NULL
           ORDER BY sort_order ASC, label ASC`,
          [companyId, entity],
        );
        return res.rows.map(mapRow);
      },
      poolOverride,
    );
  }

  /**
   * Finds a custom field definition by ID within company.
   */
  async findById(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<RawCustomFieldRow>(
          `SELECT id, company_id as "companyId", entity, key, label, type,
                  required, options, section, sort_order as "sortOrder",
                  view_permission as "viewPermission", edit_permission as "editPermission",
                  validation, created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM custom_field_definitions
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id],
        );
        return res.rows[0] ? mapRow(res.rows[0]) : null;
      },
      poolOverride,
    );
  }

  /**
   * Finds a custom field definition by key within company and entity.
   */
  async findByKey(
    companyId: string,
    entity: string,
    key: string,
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord | null> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query<RawCustomFieldRow>(
          `SELECT id, company_id as "companyId", entity, key, label, type,
                  required, options, section, sort_order as "sortOrder",
                  view_permission as "viewPermission", edit_permission as "editPermission",
                  validation, created_at as "createdAt", updated_at as "updatedAt",
                  deleted_at as "deletedAt", row_version as "rowVersion"
           FROM custom_field_definitions
           WHERE company_id = $1 AND entity = $2 AND key = $3 AND deleted_at IS NULL`,
          [companyId, entity, key],
        );
        return res.rows[0] ? mapRow(res.rows[0]) : null;
      },
      poolOverride,
    );
  }

  /**
   * Creates a new custom field definition.
   */
  async create(
    companyId: string,
    data: CreateCustomFieldInput & { createdBy?: string | undefined },
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord> {
    const id = generateUuidV7();

    const execute = async (client: pg.PoolClient | pg.Pool) => {
      const res = await client.query<RawCustomFieldRow>(
        `INSERT INTO custom_field_definitions (
           id, company_id, entity, key, label, type,
           required, options, section, sort_order,
           view_permission, edit_permission, validation,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
         RETURNING id, company_id as "companyId", entity, key, label, type,
                   required, options, section, sort_order as "sortOrder",
                   view_permission as "viewPermission", edit_permission as "editPermission",
                   validation, created_at as "createdAt", updated_at as "updatedAt",
                   deleted_at as "deletedAt", row_version as "rowVersion"`,
        [
          id,
          companyId,
          data.entity,
          data.key,
          data.label,
          data.type,
          data.required ?? false,
          JSON.stringify(data.options ?? []),
          data.section ?? 'general',
          data.sortOrder ?? 0,
          data.viewPermission ?? null,
          data.editPermission ?? null,
          JSON.stringify(data.validation ?? {}),
          data.createdBy ?? null,
        ],
      );
      const row = res.rows[0];
      if (!row) throw new Error('Failed to insert custom field definition');
      return mapRow(row);
    };

    if (clientOverride) return execute(clientOverride);

    return withTenant(
      { companyId, ...(data.createdBy ? { userId: data.createdBy } : {}) },
      async (_tx, client) => execute(client),
      poolOverride,
    );
  }

  /**
   * Updates an existing custom field definition.
   */
  async update(
    companyId: string,
    id: string,
    data: UpdateCustomFieldInput & { updatedBy?: string | undefined },
    clientOverride?: pg.PoolClient,
    poolOverride?: pg.Pool,
  ): Promise<CustomFieldDefinitionRecord | null> {
    const sets: string[] = ['updated_at = now()', 'row_version = row_version + 1'];
    const values: unknown[] = [companyId, id];
    let pIdx = 3;

    if (data.label !== undefined) {
      sets.push(`label = $${pIdx++}`);
      values.push(data.label);
    }
    if (data.type !== undefined) {
      sets.push(`type = $${pIdx++}`);
      values.push(data.type);
    }
    if (data.required !== undefined) {
      sets.push(`required = $${pIdx++}`);
      values.push(data.required);
    }
    if (data.options !== undefined) {
      sets.push(`options = $${pIdx++}`);
      values.push(JSON.stringify(data.options));
    }
    if (data.section !== undefined) {
      sets.push(`section = $${pIdx++}`);
      values.push(data.section);
    }
    if (data.sortOrder !== undefined) {
      sets.push(`sort_order = $${pIdx++}`);
      values.push(data.sortOrder);
    }
    if (data.viewPermission !== undefined) {
      sets.push(`view_permission = $${pIdx++}`);
      values.push(data.viewPermission);
    }
    if (data.editPermission !== undefined) {
      sets.push(`edit_permission = $${pIdx++}`);
      values.push(data.editPermission);
    }
    if (data.validation !== undefined) {
      sets.push(`validation = $${pIdx++}`);
      values.push(JSON.stringify(data.validation));
    }
    if (data.updatedBy !== undefined) {
      sets.push(`updated_by = $${pIdx++}`);
      values.push(data.updatedBy);
    }

    const execute = async (client: pg.PoolClient | pg.Pool) => {
      const res = await client.query<RawCustomFieldRow>(
        `UPDATE custom_field_definitions
         SET ${sets.join(', ')}
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id, company_id as "companyId", entity, key, label, type,
                   required, options, section, sort_order as "sortOrder",
                   view_permission as "viewPermission", edit_permission as "editPermission",
                   validation, created_at as "createdAt", updated_at as "updatedAt",
                   deleted_at as "deletedAt", row_version as "rowVersion"`,
        values,
      );
      return res.rows[0] ? mapRow(res.rows[0]) : null;
    };

    if (clientOverride) return execute(clientOverride);

    return withTenant(
      { companyId, ...(data.updatedBy ? { userId: data.updatedBy } : {}) },
      async (_tx, client) => execute(client),
      poolOverride,
    );
  }

  /**
   * Soft-deletes a custom field definition.
   */
  async delete(
    companyId: string,
    id: string,
    poolOverride?: pg.Pool,
  ): Promise<boolean> {
    return withTenant(
      { companyId },
      async (_tx, client) => {
        const res = await client.query(
          `UPDATE custom_field_definitions
           SET deleted_at = now(), row_version = row_version + 1
           WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [companyId, id],
        );
        return (res.rowCount ?? 0) > 0;
      },
      poolOverride,
    );
  }
}
