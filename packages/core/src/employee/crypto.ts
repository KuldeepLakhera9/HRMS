import crypto from 'node:crypto';
import { getEnv } from '@hrms/config';

// 32-byte default master encryption key for local dev if not supplied in env
const DEFAULT_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// HMAC salt for blind indexing
const DEFAULT_BLIND_INDEX_SALT = 'blind-index-salt-hrms-production-grade';

function getMasterKey(): Buffer {
  const env = getEnv();
  const hex =
    (env as unknown as { ENCRYPTION_MASTER_KEY?: string }).ENCRYPTION_MASTER_KEY ||
    DEFAULT_KEY_HEX;
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts sensitive employee data (bank, PAN, Aadhaar) using AES-256-GCM.
 * Format: v1:<keyId>:<ivHex>:<tagHex>:<cipherHex>
 */
export function encryptSensitiveField(plaintext: string, keyId = 'master'): string {
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
export function decryptSensitiveField(ciphertext: string): string {
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
 * Computes an HMAC-SHA256 blind index for exact-match searches (e.g. PAN lookup)
 * without decrypting or leaking the underlying plaintext.
 */
export function computeBlindIndex(value: string, companyId: string): string {
  const normalized = value.trim().toUpperCase();
  const hmac = crypto.createHmac('sha256', DEFAULT_BLIND_INDEX_SALT);
  hmac.update(`${companyId}:${normalized}`);
  return hmac.digest('hex');
}

/**
 * Mask PAN: displays only the last 4 characters (e.g. XXXXXX1234)
 */
export function maskPan(pan?: string | null): string | null {
  if (!pan) return null;
  const trimmed = pan.trim();
  if (trimmed.length <= 4) return 'XXXX';
  return 'X'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}

/**
 * Mask Aadhaar: displays only the last 4 characters (e.g. XXXXXXXX1234)
 */
export function maskAadhaar(aadhaar?: string | null): string | null {
  if (!aadhaar) return null;
  const trimmed = aadhaar.trim();
  if (trimmed.length <= 4) return 'XXXX';
  return 'X'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}

/**
 * Mask Bank Account Number: displays only the last 4 characters
 */
export function maskBankAccount(bankAccount?: string | null): string | null {
  if (!bankAccount) return null;
  const trimmed = bankAccount.trim();
  if (trimmed.length <= 4) return 'XXXX';
  return 'X'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}
