const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'raw_token',
  'token_hash',
  'tokenhash',
  'secret',
  'totp_secret',
  'totpsecret',
  'mfa_secret',
  'mfasecret',
  'recovery_code',
  'recovery_codes',
  'code_hash',
  'codehash',
  'pan',
  'aadhaar',
  'bank_account',
  'bankaccount',
  'account_number',
  'accountnumber',
  'ifsc',
  'authorization',
  'cookie',
]);

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  for (const s of SENSITIVE_KEYS) {
    const sNorm = s.replace(/[-_]/g, '');
    if (normalized === sNorm || normalized.endsWith(sNorm)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively deep-clones an object or array, replacing any values of sensitive keys
 * with '[REDACTED]'.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(item => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof input === 'object' && !(input instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = redactSensitiveData(value);
      } else {
        result[key] = value;
      }
    }
    return result as T;
  }

  return input;
}
