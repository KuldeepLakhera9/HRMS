import type pg from 'pg';
import { getAppPool, withTenant, type LeavePolicy } from '@hrms/db';
import { getRedisClient } from '../redis/client.js';

export interface ResolvedPolicyResult {
  policy: LeavePolicy;
  scopeType: 'employee' | 'department' | 'location' | 'employment_type' | 'company';
  scopeId: string | null;
}

const PRECEDENCE_ORDER: Record<string, number> = {
  employee: 1,
  department: 2,
  location: 3,
  employment_type: 4,
  company: 5,
};

export class LeavePolicyResolver {
  /**
   * Resolves the effective leave policy for an employee and leave type.
   * Precedence: employee > department > location > employment_type > company.
   * Cached in Redis with TTL 3600s.
   */
  async resolvePolicy(
    companyId: string,
    employeeId: string,
    leaveTypeId: string,
    poolOverride?: pg.Pool,
  ): Promise<ResolvedPolicyResult | null> {
    const cacheKey = `hrms:leave:policy:${companyId}:${employeeId}:${leaveTypeId}`;

    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as ResolvedPolicyResult;
      }
    } catch {
      // Redis fallback: proceed to DB if Redis is unreachable
    }

    const pool = poolOverride ?? getAppPool();

    const result = await withTenant({ companyId }, async (_tx, client) => {
      // 1. Fetch employee org attributes
      const empRes = await client.query<{
        departmentId: string | null;
        locationId: string | null;
        employmentType: string | null;
      }>(
        `SELECT
           department_id as "departmentId",
           location_id as "locationId",
           employment_type as "employmentType"
         FROM employees
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [companyId, employeeId],
      );

      const emp = empRes.rows[0];
      const deptId = emp?.departmentId ?? null;
      const locId = emp?.locationId ?? null;

      // 2. Fetch all candidate assignments for this leave type
      const assignRes = await client.query<{
        id: string;
        scopeType: 'employee' | 'department' | 'location' | 'employment_type' | 'company';
        scopeId: string | null;
        policyId: string;
      }>(
        `SELECT
           id,
           scope_type as "scopeType",
           scope_id as "scopeId",
           policy_id as "policyId"
         FROM leave_policy_assignments
         WHERE company_id = $1 AND leave_type_id = $2 AND deleted_at IS NULL`,
        [companyId, leaveTypeId],
      );

      if (assignRes.rows.length === 0) {
        return null;
      }

      // Filter matching assignments
      const matching = assignRes.rows.filter(a => {
        if (a.scopeType === 'employee') return a.scopeId === employeeId;
        if (a.scopeType === 'department') return deptId && a.scopeId === deptId;
        if (a.scopeType === 'location') return locId && a.scopeId === locId;
        if (a.scopeType === 'company') return true;
        return false;
      });

      if (matching.length === 0) {
        return null;
      }

      // Sort by precedence (lower number = higher priority)
      matching.sort((a, b) => (PRECEDENCE_ORDER[a.scopeType] ?? 99) - (PRECEDENCE_ORDER[b.scopeType] ?? 99));
      const winningAssignment = matching[0]!;

      // 3. Fetch winning policy
      const policyRes = await client.query<LeavePolicy>(
        `SELECT *
         FROM leave_policies
         WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [companyId, winningAssignment.policyId],
      );

      const policy = policyRes.rows[0];
      if (!policy) return null;

      return {
        policy,
        scopeType: winningAssignment.scopeType,
        scopeId: winningAssignment.scopeId,
      };
    }, pool);

    if (result) {
      try {
        const redis = getRedisClient();
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
      } catch {
        // Non-blocking cache write failure
      }
    }

    return result;
  }

  /**
   * Invalidates cached policy for an employee or all employees in tenant.
   */
  async invalidateCache(companyId: string, leaveTypeId: string, employeeId?: string): Promise<void> {
    try {
      const redis = getRedisClient();
      if (employeeId) {
        await redis.del(`hrms:leave:policy:${companyId}:${employeeId}:${leaveTypeId}`);
      } else {
        const pattern = `hrms:leave:policy:${companyId}:*:${leaveTypeId}`;
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch {
      // Ignored
    }
  }
}
