import { describe, it, expect } from 'vitest';
import {
  encryptField,
  decryptField,
  maskField,
  isStepUpActive,
  assertStepUp,
} from './cipher.js';
import { UnauthorizedError } from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';

describe('Payroll Crypto Cipher & Step-Up Auth (P4-SAL-04)', () => {
  describe('AES-256-GCM Field Encryption & Decryption', () => {
    it('encrypts and decrypts sensitive bank account number successfully', () => {
      const plaintext = '12345678901234';
      const encrypted = encryptField(plaintext, 'v1');

      expect(encrypted).toMatch(/^v1:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(encrypted).not.toBe(plaintext);

      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts PAN and Aadhaar strings with distinct IVs', () => {
      const pan = 'ABCDE1234F';
      const enc1 = encryptField(pan);
      const enc2 = encryptField(pan);

      // Random IV ensures ciphertexts differ
      expect(enc1).not.toBe(enc2);
      expect(decryptField(enc1)).toBe(pan);
      expect(decryptField(enc2)).toBe(pan);
    });

    it('throws on tampered or invalid ciphertext', () => {
      const encrypted = encryptField('test-secret');
      const tampered = encrypted.slice(0, -4) + 'abcd';

      expect(() => decryptField(tampered)).toThrow();
      expect(() => decryptField('invalid-token')).toThrow(/Invalid ciphertext format/);
    });
  });

  describe('Sensitive Field Masking', () => {
    it('masks bank account showing only last 4 digits', () => {
      expect(maskField('1234567890', 'bank')).toBe('••••••••7890');
      expect(maskField('1234', 'bank')).toBe('••••1234');
    });

    it('masks PAN showing first 3 and last 2 characters', () => {
      expect(maskField('ABCDE1234F', 'pan')).toBe('ABC•••••4F');
    });

    it('masks Aadhaar showing only last 4 digits', () => {
      expect(maskField('987654321098', 'aadhaar')).toBe('•••• •••• 1098');
    });

    it('masks salary amount', () => {
      expect(maskField('1200000.00', 'salary')).toBe('••••••');
    });
  });

  describe('Step-Up Auth Verification', () => {
    const baseCtx: RequestContext = {
      companyId: '00000000-0000-0000-0000-000000000001',
      requestId: 'req-1',
      isAuthenticated: true,
      roles: ['hr_manager'],
      permissions: ['payroll.salary.view'],
    };

    it('returns false when stepUpUntil is absent or expired', () => {
      expect(isStepUpActive(baseCtx)).toBe(false);

      const expiredCtx: RequestContext = {
        ...baseCtx,
        stepUpUntil: new Date(Date.now() - 10000),
      };
      expect(isStepUpActive(expiredCtx)).toBe(false);
    });

    it('returns true when stepUpUntil is in the future', () => {
      const validCtx: RequestContext = {
        ...baseCtx,
        stepUpUntil: new Date(Date.now() + 60000),
      };
      expect(isStepUpActive(validCtx)).toBe(true);
    });

    it('assertStepUp throws UnauthorizedError when step-up is inactive', () => {
      expect(() => assertStepUp(baseCtx, 'view sensitive salary')).toThrow(UnauthorizedError);
    });

    it('assertStepUp succeeds without throwing when step-up is valid', () => {
      const validCtx: RequestContext = {
        ...baseCtx,
        stepUpUntil: new Date(Date.now() + 60000),
      };
      expect(() => assertStepUp(validCtx, 'view sensitive salary')).not.toThrow();
    });
  });
});
