import { describe, it, expect } from 'vitest';
import {
  generateRotatingQrToken,
  verifyRotatingQrToken,
  verifyWifiBssid,
} from './qr-service.js';

describe('P2-PUNCH-06: Rotating QR & Wi-Fi BSSID Fallback Tests', () => {
  const locationId = 'loc-test-101';
  const secret = 'test-secret-salt-super-secure';

  it('generates a valid rotating QR token and verifies in same time slot', () => {
    const now = Date.now();
    const token = generateRotatingQrToken(locationId, secret, now);

    const result = verifyRotatingQrToken(token, locationId, secret, now);
    expect(result.valid).toBe(true);
  });

  it('verifies token within 30-second window drift tolerance (previous slot)', () => {
    const generatedAt = 1000000;
    const token = generateRotatingQrToken(locationId, secret, generatedAt);

    // Verified 25 seconds later (within same slot or adjacent slot)
    const verifiedAt = generatedAt + 25000;
    const result = verifyRotatingQrToken(token, locationId, secret, verifiedAt);
    expect(result.valid).toBe(true);
  });

  it('rejects expired token after 60 seconds (beyond drift window)', () => {
    const generatedAt = 1000000;
    const token = generateRotatingQrToken(locationId, secret, generatedAt);

    // Verified 65 seconds later (two slots behind)
    const verifiedAt = generatedAt + 65000;
    const result = verifyRotatingQrToken(token, locationId, secret, verifiedAt);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('QR_TOKEN_EXPIRED');
  });

  it('rejects token with location mismatch', () => {
    const token = generateRotatingQrToken(locationId, secret);
    const result = verifyRotatingQrToken(token, 'other-location-id', secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('QR_LOCATION_MISMATCH');
  });

  it('rejects tampered token signature', () => {
    const token = generateRotatingQrToken(locationId, secret);
    const tampered = token.slice(0, -4) + 'abcd';
    const result = verifyRotatingQrToken(tampered, locationId, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('QR_SIGNATURE_MISMATCH');
  });

  describe('verifyWifiBssid', () => {
    it('matches identical and case-insensitive BSSIDs', () => {
      const allowed = ['AA:BB:CC:DD:EE:FF', '00:11:22:33:44:55'];
      expect(verifyWifiBssid('aa:bb:cc:dd:ee:ff', allowed)).toBe(true);
      expect(verifyWifiBssid('AA:BB:CC:DD:EE:FF', allowed)).toBe(true);
    });

    it('rejects unlisted BSSIDs', () => {
      const allowed = ['AA:BB:CC:DD:EE:FF'];
      expect(verifyWifiBssid('12:34:56:78:90:ab', allowed)).toBe(false);
      expect(verifyWifiBssid(undefined, allowed)).toBe(false);
      expect(verifyWifiBssid('AA:BB:CC:DD:EE:FF', [])).toBe(false);
    });
  });
});
