import { ConflictError, ValidationError } from '@hrms/shared';

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

function isPgError(err: unknown): err is PgErrorLike {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * Walks the error cause chain (drizzle wraps driver errors) looking for a PostgreSQL error code.
 */
function findPgError(err: unknown): PgErrorLike | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (isPgError(current) && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Translates well-known PostgreSQL integrity violations into typed domain errors so that
 * clients never see raw SQL errors, constraint names or stack traces.
 * - 23P01 (exclusion violation) / 23505 (unique violation) -> ConflictError
 * - 23503 (foreign key violation) -> ValidationError (unknown or cross-tenant reference)
 * - 23514 (check violation) -> ValidationError
 * Any other error is rethrown unchanged.
 */
export function translateDbError(err: unknown): never {
  const pg = findPgError(err);
  switch (pg?.code) {
    case '23P01':
      throw new ConflictError('The requested change overlaps an existing effective-dated record.');
    case '23505':
      throw new ConflictError('A record with the same unique key already exists.');
    case '40P01':
    case '40001':
      throw new ConflictError('A concurrent transaction conflict occurred. Please retry.');
    case '23503':
      throw new ValidationError('A referenced record does not exist.');
    case '23514':
      throw new ValidationError('A value violates a data integrity rule.');
    default:
      throw err;
  }
}

/**
 * Runs a database operation and translates integrity violations into typed domain errors.
 */
export async function withDbErrorTranslation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return translateDbError(err);
  }
}
