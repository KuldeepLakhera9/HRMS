import { describe, it, expect } from 'vitest';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  RateLimitedError,
  formatErrorResponse,
} from './index.js';

describe('Error Handling and Formatting', () => {
  it('formats NotFoundError correctly with 404 status', () => {
    const err = new NotFoundError('Employee', 'emp_123');
    const { statusCode, body } = formatErrorResponse(err, 'req-abc');

    expect(statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe("Employee with identifier 'emp_123' was not found.");
    expect(body.error.requestId).toBe('req-abc');
  });

  it('formats ForbiddenError correctly with 403 status', () => {
    const err = new ForbiddenError('Custom forbidden message');
    const { statusCode, body } = formatErrorResponse(err);

    expect(statusCode).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('Custom forbidden message');
    expect(body.error.requestId).toBeUndefined();
  });

  it('formats ValidationError with details and 400 status', () => {
    const details = [{ field: 'email', message: 'Invalid email' }];
    const err = new ValidationError('Invalid input', details);
    const { statusCode, body } = formatErrorResponse(err, 'req-xyz');

    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(details);
    expect(body.error.requestId).toBe('req-xyz');
  });

  it('formats RateLimitedError with 429 status and retry details', () => {
    const err = new RateLimitedError(60);
    const { statusCode, body } = formatErrorResponse(err);

    expect(statusCode).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.details).toEqual({ retryAfterSeconds: 60 });
  });

  it('hides internal error details in production', () => {
    const internalErr = new Error('Database password leak or sensitive trace');
    const { statusCode, body } = formatErrorResponse(internalErr, 'req-999', true);

    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe('An unexpected internal error occurred.');
    expect(body.error.requestId).toBe('req-999');
  });

  it('shows error message in non-production for debugging', () => {
    const internalErr = new Error('Failed to connect to dev redis');
    const { statusCode, body } = formatErrorResponse(internalErr, 'req-dev', false);

    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe('Failed to connect to dev redis');
  });
});
