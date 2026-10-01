export interface PasswordPolicyOptions {
  email?: string;
  companyName?: string;
}

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a password against enterprise security policies per AGENTS.md and PHASE1_SPEC.md:
 * - Minimum 12 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one digit (0-9)
 * - At least one special symbol (!@#$%^&*...)
 * - Must not contain email prefix or company name substrings (case-insensitive)
 */
export function validatePasswordPolicy(
  password: string,
  options: PasswordPolicyOptions = {},
): PasswordPolicyResult {
  const errors: string[] = [];

  if (!password || password.length < 12) {
    errors.push('Password must be at least 12 characters in length.');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter (A-Z).');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter (a-z).');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one digit (0-9).');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special symbol or punctuation.');
  }

  // Check against email prefix
  if (options.email) {
    const emailPrefix = options.email.split('@')[0]?.toLowerCase();
    if (emailPrefix && emailPrefix.length >= 3 && password.toLowerCase().includes(emailPrefix)) {
      errors.push('Password must not contain parts of your email address.');
    }
  }

  // Check against company name
  if (options.companyName) {
    const companyClean = options.companyName.trim().toLowerCase();
    if (companyClean.length >= 4 && password.toLowerCase().includes(companyClean)) {
      errors.push('Password must not contain the company name.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
