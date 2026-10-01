import { describe, it, expect } from 'vitest';
import { redactSensitiveData } from './redaction.js';

describe('Audit Redaction Unit Tests', () => {
  it('redacts passwords, tokens, hashes, and secrets at top level and nested structures', () => {
    const raw = {
      user: 'admin',
      password: 'SuperSecretPassword123!',
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$...',
      token: 'opaque-token-12345',
      totp_secret: 'JBSWY3DPEHPK3PXP',
      pan: 'ABCDE1234F',
      aadhaar: '123456789012',
      bank_account: '9876543210',
      nested: {
        raw_token: 'secret-token',
        code_hash: 'hash-abc',
        safeField: 'This is visible',
      },
      list: [
        { secret: 'hidden-secret', name: 'safe-item' },
        'regular-string',
      ],
    };

    const redacted = redactSensitiveData(raw);

    expect(redacted.user).toBe('admin');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.password_hash).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.totp_secret).toBe('[REDACTED]');
    expect(redacted.pan).toBe('[REDACTED]');
    expect(redacted.aadhaar).toBe('[REDACTED]');
    expect(redacted.bank_account).toBe('[REDACTED]');
    expect(redacted.nested.raw_token).toBe('[REDACTED]');
    expect(redacted.nested.code_hash).toBe('[REDACTED]');
    expect(redacted.nested.safeField).toBe('This is visible');

    const firstListItem = redacted.list[0] as { secret: string; name: string };
    expect(firstListItem.secret).toBe('[REDACTED]');
    expect(firstListItem.name).toBe('safe-item');
    expect(redacted.list[1]).toBe('regular-string');

    // Original input remains unmutated
    expect(raw.password).toBe('SuperSecretPassword123!');
  });

  it('handles null, undefined, and non-object primitives gracefully', () => {
    expect(redactSensitiveData(null)).toBeNull();
    expect(redactSensitiveData(undefined)).toBeUndefined();
    expect(redactSensitiveData(42)).toBe(42);
    expect(redactSensitiveData('test')).toBe('test');
  });
});
