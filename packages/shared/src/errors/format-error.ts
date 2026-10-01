import { AppError } from './app-error.js';

export interface StandardErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function formatErrorResponse(
  error: unknown,
  requestId?: string,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): { statusCode: number; body: StandardErrorResponse } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          ...(requestId ? { requestId } : {}),
        },
      },
    };
  }

  // Handle unexpected or internal errors safely
  const message = isProduction
    ? 'An unexpected internal error occurred.'
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message,
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
