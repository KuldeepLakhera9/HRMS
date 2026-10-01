import { z, ZodType } from 'zod';
import { withTenant, DrizzleTransaction } from '@hrms/db';
import {
  ValidationError,
  ForbiddenError,
  formatErrorResponse,
} from '@hrms/shared';
import { RequestContext } from './context.js';
import { can } from './authorization.js';
import { createChildLogger } from '../logger/index.js';

export interface RouteDefinition<TInput, TOutput> {
  permission?: string;
  schema?: ZodType<TInput>;
  handler: (
    input: TInput,
    ctx: RequestContext,
    tx: DrizzleTransaction,
  ) => Promise<TOutput>;
}

export interface RouteExecutionResult<T> {
  statusCode: number;
  headers: Record<string, string>;
  body: T | { error: unknown };
}

/**
 * Universal route execution engine.
 * Authenticates, validates input, checks permissions, executes within withTenant,
 * catches errors, and guarantees standardized error formatting and logging.
 */
export function defineRoute<TInput = unknown, TOutput = unknown>(
  def: RouteDefinition<TInput, TOutput>,
) {
  return async (
    rawInput: unknown,
    ctx: RequestContext,
  ): Promise<RouteExecutionResult<TOutput>> => {
    const logger = createChildLogger({
      requestId: ctx.requestId,
      companyId: ctx.companyId,
      userId: ctx.userId,
    });

    const headers: Record<string, string> = {
      'X-Request-Id': ctx.requestId,
      'Content-Type': 'application/json',
    };

    try {
      // 1. Authorization Check (if permission defined)
      if (def.permission) {
        const authorized = can(ctx, def.permission);
        if (!authorized) {
          logger.warn(
            { permission: def.permission, userId: ctx.userId },
            'Access denied by authorization policy',
          );
          throw new ForbiddenError(
            `Access denied. Requires permission '${def.permission}'.`,
          );
        }
      }

      // 2. Input Validation (via Zod)
      let parsedInput = rawInput as TInput;
      if (def.schema) {
        const parseResult = def.schema.safeParse(rawInput);
        if (!parseResult.success) {
          const formatted = (parseResult as z.SafeParseError<unknown>).error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          }));
          throw new ValidationError('Validation failed for input.', formatted);
        }
        parsedInput = parseResult.data;
      }

      // 3. Execution inside withTenant transaction
      const result = await withTenant(ctx, async tx => {
        return await def.handler(parsedInput, ctx, tx);
      });

      return {
        statusCode: 200,
        headers,
        body: result,
      };
    } catch (err: unknown) {
      logger.error({ err }, 'Error during route execution');

      const { statusCode, body } = formatErrorResponse(
        err,
        ctx.requestId,
        process.env.NODE_ENV === 'production',
      );

      return {
        statusCode,
        headers,
        body,
      };
    }
  };
}
