import crypto from 'node:crypto';

/**
 * QR Code Fallback and Wi-Fi BSSID Verification (P2-PUNCH-06)
 * - Rotating QR token signed with location secret using HMAC-SHA256
 * - 30-second window with 1-slot drift tolerance
 * - Wi-Fi BSSID matching
 */

export interface QrTokenPayload {
  locationId: string;
  slot: number;
  signature: string;
}

/**
 * Generates a rotating QR token for a work location.
 * Format: locationId:slot:signature
 */
export function generateRotatingQrToken(
  locationId: string,
  secret: string,
  timestampMs: number = Date.now(),
): string {
  const slot = Math.floor(timestampMs / 30000);
  const data = `${locationId}:${slot}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  return `${locationId}:${slot}:${signature}`;
}

/**
 * Verifies a rotating QR token against a work location and secret.
 * Allows current slot and previous slot (30-second drift).
 */
export function verifyRotatingQrToken(
  token: string,
  locationId: string,
  secret: string,
  timestampMs: number = Date.now(),
): { valid: boolean; reason?: string } {
  if (!token) {
    return { valid: false, reason: 'QR_TOKEN_MISSING' };
  }

  const parts = token.split(':');
  if (parts.length !== 3) {
    return { valid: false, reason: 'QR_TOKEN_MALFORMED' };
  }

  const [tokenLocationId, slotStr, signature] = parts;
  if (!tokenLocationId || !slotStr || !signature) {
    return { valid: false, reason: 'QR_TOKEN_MALFORMED' };
  }

  if (tokenLocationId !== locationId) {
    return { valid: false, reason: 'QR_LOCATION_MISMATCH' };
  }

  const slot = parseInt(slotStr, 10);
  if (isNaN(slot)) {
    return { valid: false, reason: 'QR_TOKEN_MALFORMED' };
  }

  const currentSlot = Math.floor(timestampMs / 30000);

  // Allow current slot and currentSlot - 1 (30s drift)
  if (slot < currentSlot - 1) {
    return { valid: false, reason: 'QR_TOKEN_EXPIRED' };
  }
  if (slot > currentSlot + 1) {
    return { valid: false, reason: 'QR_TOKEN_FUTURE' };
  }

  const data = `${locationId}:${slot}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return { valid: false, reason: 'QR_SIGNATURE_MISMATCH' };
  }

  return { valid: true };
}

/**
 * Verifies if the provided Wi-Fi BSSID matches any of the location's allowed BSSIDs.
 */
export function verifyWifiBssid(
  providedBssid: string | undefined | null,
  allowedBssids: string[] | undefined | null,
): boolean {
  if (!providedBssid || !allowedBssids || allowedBssids.length === 0) {
    return false;
  }

  const normalized = providedBssid.trim().toLowerCase();
  return allowedBssids.some(b => b.trim().toLowerCase() === normalized);
}
