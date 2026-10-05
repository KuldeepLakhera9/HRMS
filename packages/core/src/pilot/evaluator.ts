import type { FeatureFlagItem } from './types.js';

/**
 * Deterministically evaluates whether a feature flag is enabled for a given user context.
 */
export function evaluateFeatureFlag(
  flag: FeatureFlagItem,
  context: { userId: string; departmentId?: string | null },
): boolean {
  if (!flag.isEnabled) {
    return false;
  }

  const { users, departments, percentage } = flag.rules || {};

  // 1. Explicit user targeting
  if (users && Array.isArray(users) && users.includes(context.userId)) {
    return true;
  }

  // 2. Department targeting
  if (departments && Array.isArray(departments) && context.departmentId && departments.includes(context.departmentId)) {
    return true;
  }

  // 3. Percentage rollout (deterministic bucket)
  if (typeof percentage === 'number' && percentage > 0) {
    const bucket = computeBucket(`${flag.companyId}:${flag.key}:${context.userId}`);
    return bucket < percentage;
  }

  // 4. Default: if no specific targeting rules are set, flag applies to all
  if ((!users || users.length === 0) && (!departments || departments.length === 0) && percentage === undefined) {
    return true;
  }

  return false;
}

/**
 * Computes deterministic hash bucket [0, 99] for a string.
 */
function computeBucket(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % 100;
}
