import type pg from 'pg';
import { resolveJsonField } from './evaluator.js';

export type ApproverResolverType =
  | 'reporting_manager'
  | 'managers_manager'
  | 'department_head'
  | 'role'
  | 'user'
  | 'field_ref';

export interface ApproverResolverConfig {
  type: ApproverResolverType;
  roleName?: string;
  userId?: string;
  fieldPath?: string;
}

export interface ResolveApproversContext {
  companyId: string;
  requesterId: string; // employee_id
  payload: Record<string, unknown>;
  client: pg.PoolClient;
}

/**
 * Resolves list of assignee employee IDs for a given workflow step rule.
 */
export async function resolveApprovers(
  config: ApproverResolverConfig,
  ctx: ResolveApproversContext,
): Promise<string[]> {
  const { companyId, requesterId, payload, client } = ctx;

  switch (config.type) {
    case 'reporting_manager': {
      const res = await client.query<{ managerId: string | null }>(
        `SELECT manager_id as "managerId"
         FROM employees
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [companyId, requesterId],
      );
      const mgr = res.rows[0]?.managerId;
      return mgr ? [mgr] : [];
    }

    case 'managers_manager': {
      const res = await client.query<{ reportingPath: string[] | null }>(
        `SELECT reporting_path as "reportingPath"
         FROM employees
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [companyId, requesterId],
      );
      const path = res.rows[0]?.reportingPath || [];
      // reporting_path: [top, ..., skip_level, direct_manager]
      // skip-level manager is 2nd from the end
      if (path.length >= 2) {
        const skipLevel = path[path.length - 2];
        return skipLevel ? [skipLevel] : [];
      }
      return [];
    }

    case 'department_head': {
      const res = await client.query<{ headEmployeeId: string | null }>(
        `SELECT d.head_employee_id as "headEmployeeId"
         FROM employees e
         JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id AND d.deleted_at IS NULL
         WHERE e.company_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`,
        [companyId, requesterId],
      );
      const head = res.rows[0]?.headEmployeeId;
      return head ? [head] : [];
    }

    case 'role': {
      if (!config.roleName) return [];
      const res = await client.query<{ employeeId: string | null }>(
        `SELECT u.employee_id as "employeeId"
         FROM users u
         JOIN user_roles ur ON ur.company_id = u.company_id AND ur.user_id = u.id
         JOIN roles r ON r.company_id = ur.company_id AND r.id = ur.role_id
         WHERE u.company_id = $1
           AND r.name = $2
           AND u.status = 'active'
           AND u.employee_id IS NOT NULL`,
        [companyId, config.roleName],
      );
      return res.rows.map(r => r.employeeId).filter((id): id is string => Boolean(id));
    }

    case 'user': {
      return config.userId ? [config.userId] : [];
    }

    case 'field_ref': {
      if (!config.fieldPath) return [];
      const val = resolveJsonField(payload, config.fieldPath);
      if (typeof val === 'string' && val.length > 0) {
        return [val];
      }
      if (Array.isArray(val)) {
        return val.filter((item): item is string => typeof item === 'string' && item.length > 0);
      }
      return [];
    }

    default:
      return [];
  }
}
