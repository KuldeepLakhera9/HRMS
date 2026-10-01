import crypto from 'node:crypto';
import { getEnv } from '@hrms/config';

// 32-byte default master encryption key for local dev if not supplied in env
const DEFAULT_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getMasterKey(): Buffer {
  const env = getEnv();
  const hex = (env as unknown as { ENCRYPTION_MASTER_KEY?: string }).ENCRYPTION_MASTER_KEY || DEFAULT_KEY_HEX;
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts sensitive plaintext (e.g. MFA secret, personal identifiable data) using AES-256-GCM.
 * Ciphertext format: v1:<keyId>:<ivHex>:<tagHex>:<cipherHex>
 */
export function encryptSecret(plaintext: string, keyId = 'master'): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `v1:${keyId}:${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM ciphertext in format v1:<keyId>:<ivHex>:<tagHex>:<cipherHex>.
 */
export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('Invalid ciphertext format. Expected v1:<keyId>:<iv>:<tag>:<ct>');
  }

  const [, , ivHex, tagHex, cipherHex] = parts;
  if (!ivHex || !tagHex || !cipherHex) {
    throw new Error('Invalid ciphertext components.');
  }

  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Computes SHA-256 hex digest of a token (opaque sessions, reset tokens, recovery codes).
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Generates a cryptographically secure random opaque token (default 32 bytes / 256 bits).
 */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}
