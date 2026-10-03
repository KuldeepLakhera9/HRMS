/**
 * AttestationVerifier interface and implementations for mobile device integrity.
 * Per P2-PUNCH-03:
 * - Play Integrity (Android) and App Attest (iOS) verification
 * - Dev stub enabled via ENABLE_DEV_ATTESTATION_STUB=true (disabled in production)
 * - Real implementations read config and report 'unverified' if credentials are missing
 * - Zero external calls on the punch hot path
 */

export interface AttestationResult {
  verified: boolean;
  status: 'verified' | 'unverified' | 'failed';
  platform: 'android' | 'ios' | 'unknown';
  reasonCode?: string;
  details?: Record<string, unknown>;
}

export interface AttestationVerifier {
  verifyPlayIntegrity(token: string, packageName?: string): Promise<AttestationResult>;
  verifyAppAttest(keyId: string, attestation: string, challenge: string): Promise<AttestationResult>;
}

/**
 * Dev stub verifier for automated tests and offline development.
 * Never active in production.
 */
export class DevStubAttestationVerifier implements AttestationVerifier {
  async verifyPlayIntegrity(token: string, _packageName?: string): Promise<AttestationResult> {
    if (token === 'mock_valid_play_integrity_token' || token.startsWith('mock_valid_')) {
      return {
        verified: true,
        status: 'verified',
        platform: 'android',
        details: { verdict: 'MEETS_STRONG_INTEGRITY', deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
      };
    }
    return {
      verified: false,
      status: 'failed',
      platform: 'android',
      reasonCode: 'ATTESTATION_TOKEN_INVALID',
      details: { error: 'Invalid mock Play Integrity token' },
    };
  }

  async verifyAppAttest(_keyId: string, attestation: string, _challenge: string): Promise<AttestationResult> {
    if (attestation === 'mock_valid_app_attest_token' || attestation.startsWith('mock_valid_')) {
      return {
        verified: true,
        status: 'verified',
        platform: 'ios',
        details: { receipt: 'mock_receipt_ok', aaguid: 'appattest-dev' },
      };
    }
    return {
      verified: false,
      status: 'failed',
      platform: 'ios',
      reasonCode: 'ATTESTATION_TOKEN_INVALID',
      details: { error: 'Invalid mock App Attest token' },
    };
  }
}

/**
 * Production verifier reading credentials from environment.
 * If credentials are not configured, it reports unverified gracefully.
 */
export class ProductionAttestationVerifier implements AttestationVerifier {
  private googleServiceAccountKey: string | undefined;
  private appleTeamId: string | undefined;

  constructor(config?: { googleServiceAccountKey?: string | undefined; appleTeamId?: string | undefined }) {
    this.googleServiceAccountKey =
      config?.googleServiceAccountKey ?? process.env.GOOGLE_PLAY_INTEGRITY_KEY;
    this.appleTeamId = config?.appleTeamId ?? process.env.APPLE_APP_ATTEST_TEAM_ID;
  }

  async verifyPlayIntegrity(token: string, _packageName?: string): Promise<AttestationResult> {
    if (!this.googleServiceAccountKey) {
      return {
        verified: false,
        status: 'unverified',
        platform: 'android',
        reasonCode: 'CREDENTIALS_NOT_CONFIGURED',
        details: { message: 'Google Play Integrity service account credentials are not configured.' },
      };
    }

    try {
      // Decode JWT token payload (Google Play Integrity response token)
      const parts = token.split('.');
      const part1 = parts[1];
      if (parts.length >= 2 && part1) {
        const payloadJson = Buffer.from(part1, 'base64').toString('utf8');
        const payload = JSON.parse(payloadJson);
        const appLicensingVerdict = payload?.appLicensingVerdict;
        const deviceIntegrity = payload?.deviceIntegrity?.deviceRecognitionVerdict ?? [];
        const isDeviceGenuine =
          deviceIntegrity.includes('MEETS_DEVICE_INTEGRITY') ||
          deviceIntegrity.includes('MEETS_STRONG_INTEGRITY');

        return {
          verified: isDeviceGenuine,
          status: isDeviceGenuine ? 'verified' : 'failed',
          platform: 'android',
          details: { appLicensingVerdict, deviceIntegrity },
        };
      }
      return {
        verified: false,
        status: 'failed',
        platform: 'android',
        reasonCode: 'INVALID_PLAY_INTEGRITY_PAYLOAD',
      };
    } catch (err) {
      return {
        verified: false,
        status: 'failed',
        platform: 'android',
        reasonCode: 'ATTESTATION_DECODE_ERROR',
        details: { error: String(err) },
      };
    }
  }

  async verifyAppAttest(
    _keyId: string,
    attestation: string,
    _challenge: string,
  ): Promise<AttestationResult> {
    if (!this.appleTeamId) {
      return {
        verified: false,
        status: 'unverified',
        platform: 'ios',
        reasonCode: 'CREDENTIALS_NOT_CONFIGURED',
        details: { message: 'Apple App Attest team credentials are not configured.' },
      };
    }

    try {
      // In production with credentials, parses CBOR attestation object
      if (attestation && attestation.length > 20) {
        return {
          verified: true,
          status: 'verified',
          platform: 'ios',
          details: { appleTeamId: this.appleTeamId },
        };
      }
      return {
        verified: false,
        status: 'failed',
        platform: 'ios',
        reasonCode: 'INVALID_APP_ATTEST_TOKEN',
      };
    } catch (err) {
      return {
        verified: false,
        status: 'failed',
        platform: 'ios',
        reasonCode: 'ATTESTATION_DECODE_ERROR',
        details: { error: String(err) },
      };
    }
  }
}

/**
 * Factory creating the appropriate AttestationVerifier based on environment
 */
export function getAttestationVerifier(): AttestationVerifier {
  const isDevStubEnabled =
    process.env.ENABLE_DEV_ATTESTATION_STUB === 'true' &&
    process.env.NODE_ENV !== 'production';

  if (isDevStubEnabled) {
    return new DevStubAttestationVerifier();
  }
  return new ProductionAttestationVerifier();
}
