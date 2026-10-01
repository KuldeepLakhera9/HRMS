import { hash, verify } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id (default)
  memoryCost: 65536, // 64 MB (OWASP recommendation)
  timeCost: 3,
  parallelism: 4,
};

// Pre-computed dummy Argon2id hash used to perform constant-time verification for non-existent users
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQxMjM0NTY3OA$9vAfxn1p3iNlXo499y2gqMfx0yR2b71Gv0N/f4+96mE';

/**
 * Hashes a plaintext password using Argon2id with OWASP-recommended parameters.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Constant-time dummy verification executed when a user email is not found.
 * Prevents timing attacks and user enumeration.
 */
export async function verifyDummyPassword(password: string): Promise<boolean> {
  try {
    await verify(DUMMY_HASH, password);
  } catch {
    // Expected to fail
  }
  return false;
}
