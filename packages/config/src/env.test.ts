import { describe, it, expect } from 'vitest';
import { validateEnv } from './env.js';

describe('Environment Config Validation', () => {
  const validMockEnv = {
    DATABASE_URL: 'postgresql://hrms_app:pwd@localhost:5432/hrms_db',
    DATABASE_APP_URL: 'postgresql://hrms_app:pwd@localhost:5432/hrms_db',
    DATABASE_OWNER_URL: 'postgresql://hrms_owner:pwd@localhost:5432/hrms_db',
  };

  it('successfully validates complete valid environment configuration', () => {
    const config = validateEnv(validMockEnv);
    expect(config.DATABASE_URL).toBe(validMockEnv.DATABASE_URL);
    expect(config.DATABASE_APP_URL).toBe(validMockEnv.DATABASE_APP_URL);
    expect(config.DATABASE_OWNER_URL).toBe(validMockEnv.DATABASE_OWNER_URL);
    expect(config.PORT).toBe(3000); // default
    expect(config.NODE_ENV).toBe('development'); // default
  });

  it('fails fast when required database connection urls are missing', () => {
    expect(() => validateEnv({})).toThrow(/\[Config Error\] Invalid environment variables/);
  });

  it('validates port coercion and custom port', () => {
    const config = validateEnv({
      ...validMockEnv,
      PORT: '8080',
    });
    expect(config.PORT).toBe(8080);
  });
});
