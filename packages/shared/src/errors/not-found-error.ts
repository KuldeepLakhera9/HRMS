import { AppError } from './app-error.js';

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly code = 'NOT_FOUND';

  constructor(resource: string, identifier?: string | number) {
    const msg = identifier
      ? `${resource} with identifier '${identifier}' was not found.`
      : `${resource} was not found.`;
    super(msg);
  }
}
