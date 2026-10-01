import { webcrypto } from 'node:crypto';

const crypto = globalThis.crypto || webcrypto;

/**
 * Generates an RFC 9562 compliant UUIDv7.
 * Characteristics:
 * - 48-bit UNIX timestamp in milliseconds (time-ordered)
 * - 4-bit version (0b0111)
 * - 12-bit pseudorandom data
 * - 2-bit variant (0b10)
 * - 62-bit pseudorandom data
 */
export function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = Date.now();

  // Timestamp bytes 0..5 (48 bits)
  bytes[0] = (timestamp / 0x10000000000) & 0xff;
  bytes[1] = (timestamp / 0x100000000) & 0xff;
  bytes[2] = (timestamp / 0x1000000) & 0xff;
  bytes[3] = (timestamp / 0x10000) & 0xff;
  bytes[4] = (timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 in high nibble of byte 6
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;

  // Variant RFC 4122 (0b10) in high 2 bits of byte 8
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    const byte = bytes[i] ?? 0;
    hex.push(byte.toString(16).padStart(2, '0'));
  }

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
