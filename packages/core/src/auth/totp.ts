import crypto from 'node:crypto';
import { hashToken } from './crypto.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a buffer into a Base32 string (RFC 4648 without padding).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes a Base32 string into a Buffer.
 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]!);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a cryptographically secure 20-byte Base32 secret for TOTP.
 */
export function generateTotpSecret(): string {
  const randomBytes = crypto.randomBytes(20);
  return base32Encode(randomBytes);
}

/**
 * Computes RFC 6238 TOTP 6-digit code for a given counter value.
 */
export function computeHotp(secretBuffer: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  // Big-endian 64-bit integer
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();

  // Dynamic truncation (RFC 4226 Section 5.3)
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

/**
 * Generates a 6-digit TOTP code for the current time (or specified timestamp).
 */
export function generateTotpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const secretBuffer = base32Decode(secret);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  return computeHotp(secretBuffer, counter);
}

/**
 * Verifies a 6-digit TOTP code against a secret within a +/- 1 step window (RFC 6238).
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  timestampMs = Date.now(),
  windowSteps = 1,
  stepSeconds = 30,
): boolean {
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return false;
  }

  try {
    const secretBuffer = base32Decode(secret);
    const currentCounter = Math.floor(timestampMs / 1000 / stepSeconds);

    for (let i = -windowSteps; i <= windowSteps; i++) {
      const stepCode = computeHotp(secretBuffer, currentCounter + i);
      if (crypto.timingSafeEqual(Buffer.from(stepCode), Buffer.from(code))) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Generates otpauth URI compatible with Google Authenticator, Authy, and 1Password.
 */
export function generateTotpUri(params: {
  secret: string;
  email: string;
  issuer?: string;
}): string {
  const issuer = params.issuer || 'OrgHub HRMS';
  const label = encodeURIComponent(`${issuer}:${params.email}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generates 10 single-use 8-character alphanumeric recovery codes and their SHA-256 hashes.
 */
export function generateRecoveryCodes(count = 10): {
  plainCodes: string[];
  hashedCodes: string[];
} {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Base32-like (omitting confusing characters like O, 0, I, 1)
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let j = 0; j < 8; j++) {
      code += charset[bytes[j]! % charset.length];
    }
    // Format: XXXX-XXXX
    const formatted = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
    plainCodes.push(formatted);
    hashedCodes.push(hashToken(formatted.replace(/-/g, '').toUpperCase()));
  }

  return { plainCodes, hashedCodes };
}
