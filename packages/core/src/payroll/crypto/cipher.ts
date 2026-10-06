import crypto from 'node:crypto';
import { getEnv } from '@hrms/config';
import { UnauthorizedError } from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';

// 32-byte default master encryption key for local dev if not supplied in env
const DEFAULT_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getMasterKey(): Buffer {
  const env = getEnv();
  const hex = (env as unknown as { ENCRYPTION_MASTER_KEY?: string }).ENCRYPTION_MASTER_KEY || DEFAULT_KEY_HEX;
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts sensitive fields (bank account, PAN, Aadhaar) using AES-256-GCM.
 * Output format: v1:<keyId>:<ivHex>:<tagHex>:<cipherHex>
 */
export function encryptField(plaintext: string, keyId = 'master'): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `v1:${keyId}:${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypts sensitive fields encrypted with encryptField().
 */
export function decryptField(ciphertext: string): string {
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
 * Masks sensitive fields (bank, pan, aadhaar, salary) by default.
 */
export function maskField(
  val: string | null | undefined,
  type: 'bank' | 'pan' | 'aadhaar' | 'salary',
): string {
  if (!val) return '';
  const str = String(val).trim();

  switch (type) {
    case 'bank': {
      if (str.length <= 4) return '••••' + str;
      return '••••••••' + str.slice(-4);
    }
    case 'pan': {
      if (str.length <= 4) return '•••••' + str;
      // Show first 3 and last 2 characters (e.g. ABC•••••1F)
      return str.slice(0, 3) + '•••••' + str.slice(-2);
    }
    case 'aadhaar': {
      if (str.length <= 4) return '•••• •••• ' + str;
      return '•••• •••• ' + str.slice(-4);
    }
    case 'salary': {
      return '••••••';
    }
    default:
      return '••••';
  }
}

/**
 * Checks if the caller has valid active step-up authentication.
 */
export function isStepUpActive(ctx: RequestContext): boolean {
  if (!ctx.stepUpUntil) return false;
  const expiry = typeof ctx.stepUpUntil === 'string' ? new Date(ctx.stepUpUntil) : ctx.stepUpUntil;
  return expiry.getTime() > Date.now();
}

/**
 * Asserts step-up auth is active, throwing UnauthorizedError if missing or expired.
 */
export function assertStepUp(ctx: RequestContext, actionName = 'this action'): void {
  if (!isStepUpActive(ctx)) {
    throw new UnauthorizedError(`Step-up authentication required to perform ${actionName}`);
  }
}
