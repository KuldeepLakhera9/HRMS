import { describe, it, expect } from 'vitest';
import {
  DevStubAttestationVerifier,
  ProductionAttestationVerifier,
  getAttestationVerifier,
} from './attestation.js';

describe('P2-PUNCH-03: AttestationVerifier Tests', () => {
  describe('DevStubAttestationVerifier', () => {
    const verifier = new DevStubAttestationVerifier();

    it('verifies valid mock Play Integrity token on Android', async () => {
      const res = await verifier.verifyPlayIntegrity('mock_valid_play_integrity_token');
      expect(res.verified).toBe(true);
      expect(res.status).toBe('verified');
      expect(res.platform).toBe('android');
      expect(res.details?.verdict).toBe('MEETS_STRONG_INTEGRITY');
    });

    it('rejects invalid mock Play Integrity token', async () => {
      const res = await verifier.verifyPlayIntegrity('untrusted_tampered_token');
      expect(res.verified).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reasonCode).toBe('ATTESTATION_TOKEN_INVALID');
    });

    it('verifies valid mock App Attest token on iOS', async () => {
      const res = await verifier.verifyAppAttest('key-123', 'mock_valid_app_attest_token', 'challenge');
      expect(res.verified).toBe(true);
      expect(res.status).toBe('verified');
      expect(res.platform).toBe('ios');
    });

    it('rejects invalid mock App Attest token', async () => {
      const res = await verifier.verifyAppAttest('key-123', 'invalid_attest', 'challenge');
      expect(res.verified).toBe(false);
      expect(res.status).toBe('failed');
    });
  });

  describe('ProductionAttestationVerifier', () => {
    it('gracefully reports unverified with CREDENTIALS_NOT_CONFIGURED when secrets are missing', async () => {
      const prodVerifier = new ProductionAttestationVerifier({});

      const androidRes = await prodVerifier.verifyPlayIntegrity('any_token');
      expect(androidRes.verified).toBe(false);
      expect(androidRes.status).toBe('unverified');
      expect(androidRes.reasonCode).toBe('CREDENTIALS_NOT_CONFIGURED');

      const iosRes = await prodVerifier.verifyAppAttest('key-1', 'attest_data', 'challenge');
      expect(iosRes.verified).toBe(false);
      expect(iosRes.status).toBe('unverified');
      expect(iosRes.reasonCode).toBe('CREDENTIALS_NOT_CONFIGURED');
    });
  });

  describe('getAttestationVerifier factory', () => {
    it('returns a verifier instance', () => {
      const verifier = getAttestationVerifier();
      expect(verifier).toBeDefined();
    });
  });
});
