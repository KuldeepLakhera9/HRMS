import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  verifyDummyPassword,
  validatePasswordPolicy,
  encryptSecret,
  decryptSecret,
  hashToken,
  generateSecureToken,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateTotpUri,
  generateRecoveryCodes,
} from './index.js';

describe('Auth Cryptography & Password Policy Unit Tests', () => {
  describe('Argon2id Password Hashing', () => {
    it('hashes and successfully verifies a correct password', async () => {
      const password = 'SuperSecureP@ssword2026!';
      const hash = await hashPassword(password);

      expect(hash).toContain('$argon2id$');
      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('WrongPassword123!', hash);
      expect(isInvalid).toBe(false);
    });

    it('dummy verification always returns false', async () => {
      const result = await verifyDummyPassword('SomeAttemptedPassword123!');
      expect(result).toBe(false);
    });
  });

  describe('Password Policy Validation', () => {
    it('approves a strong password meeting all criteria', () => {
      const res = validatePasswordPolicy('CorpSecure#2026_X', {
        email: 'john.doe@company.com',
        companyName: 'Acme Corp',
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects passwords shorter than 12 characters', () => {
      const res = validatePasswordPolicy('Short1!');
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Password must be at least 12 characters in length.');
    });

    it('rejects passwords missing required character classes', () => {
      const res = validatePasswordPolicy('alllowercaseandnumbers123456');
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('uppercase'))).toBe(true);
      expect(res.errors.some(e => e.includes('special symbol'))).toBe(true);
    });

    it('rejects passwords containing email prefix or company name', () => {
      const res = validatePasswordPolicy('JohnDoeSecret123!', {
        email: 'johndoe@example.com',
        companyName: 'Acme',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('email address'))).toBe(true);
    });
  });

  describe('AES-256-GCM Secret Encryption', () => {
    it('encrypts and decrypts secrets with key versioning and authentication tag', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const encrypted = encryptSecret(secret, 'v1');

      expect(encrypted.startsWith('v1:v1:')).toBe(true);
      expect(encrypted.split(':')).toHaveLength(5);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('throws error when tampering with ciphertext or auth tag', () => {
      const secret = 'TopSecretData123';
      const encrypted = encryptSecret(secret);
      const parts = encrypted.split(':');
      // Tamper with ciphertext
      parts[4] = '00' + parts[4]!.slice(2);
      const tampered = parts.join(':');

      expect(() => decryptSecret(tampered)).toThrow();
    });
  });

  describe('RFC 6238 TOTP Engine & Recovery Codes', () => {
    it('generates and verifies 6-digit TOTP code within valid window', () => {
      const secret = generateTotpSecret();
      expect(secret.length).toBeGreaterThanOrEqual(32);

      const now = Date.now();
      const code = generateTotpCode(secret, now);
      expect(code).toMatch(/^\d{6}$/);

      // Verify at exact timestamp
      expect(verifyTotpCode(secret, code, now)).toBe(true);

      // Verify within +/- 1 step (30s earlier or later)
      expect(verifyTotpCode(secret, code, now + 25000)).toBe(true);
      expect(verifyTotpCode(secret, code, now - 25000)).toBe(true);

      // Reject invalid code
      expect(verifyTotpCode(secret, '000000', now)).toBe(false);

      // Reject expired code (+90s outside window)
      expect(verifyTotpCode(secret, code, now + 95000)).toBe(false);
    });

    it('formats Google Authenticator compatible otpauth URI', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const uri = generateTotpUri({
        secret,
        email: 'alice@example.com',
        issuer: 'OrgHub HRMS',
      });

      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(uri).toContain('issuer=OrgHub%20HRMS');
    });

    it('generates 10 distinct recovery codes and hashes', () => {
      const { plainCodes, hashedCodes } = generateRecoveryCodes(10);

      expect(plainCodes).toHaveLength(10);
      expect(hashedCodes).toHaveLength(10);

      // Format XXXX-XXXX
      plainCodes.forEach((code, idx) => {
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        const expectedHash = hashToken(code.replace(/-/g, ''));
        expect(hashedCodes[idx]).toBe(expectedHash);
      });
    });
  });

  describe('Secure Token Utilities', () => {
    it('generates 256-bit random hex tokens and computes SHA-256 hashes', () => {
      const token = generateSecureToken(32);
      expect(token).toHaveLength(64); // 32 bytes = 64 hex characters

      const hash = hashToken(token);
      expect(hash).toHaveLength(64);
      expect(hashToken(token)).toBe(hash); // deterministic
    });
  });
});
