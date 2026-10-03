import { AppError } from './app-error.js';

export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  public readonly code = 'FORBIDDEN';

  constructor(
    message: string = 'You do not have permission to perform this action.',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class UnauthorizedError extends AppError {
  public readonly statusCode = 401;
  public readonly code = 'UNAUTHORIZED';

  constructor(
    message: string = 'Authentication is required to access this resource.',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly code = 'VALIDATION_ERROR';

  constructor(message: string = 'Validation failed for the supplied input.', details?: unknown) {
    super(message, details);
  }
}

export class ConflictError extends AppError {
  public readonly statusCode = 409;
  public readonly code = 'CONFLICT';

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class RateLimitedError extends AppError {
  public readonly statusCode = 429;
  public readonly code = 'RATE_LIMITED';
  public readonly retryAfterSeconds?: number | undefined;

  constructor(retryAfterSeconds?: number, message: string = 'Too many requests. Please try again later.') {
    super(message, retryAfterSeconds !== undefined ? { retryAfterSeconds } : undefined);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
