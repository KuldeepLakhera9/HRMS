import { z, type ZodType } from 'zod';
import { withTenant, type DrizzleTransaction, generateUuidV7 } from '@hrms/db';
import {
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
  RateLimitedError,
  formatErrorResponse,
} from '@hrms/shared';
import { type RequestContext, createAnonymousContext } from './context.js';
import { can } from './authorization.js';
import { createChildLogger } from '../logger/index.js';
import { checkRateLimit } from '../auth/rate-limiter.js';
import { getSessionByToken } from '../auth/session.js';
import { getUserAuthorization } from '../rbac/effective-permissions.js';

export interface RouteDefinition<TInput, TOutput> {
  permission?: string | undefined;
  requireAuth?: boolean | undefined;
  skipTenantTransaction?: boolean | undefined;
  rateLimit?: {
    limit: number;
    windowSeconds: number;
    keyGenerator?: ((ctx: RequestContext) => string) | undefined;
  } | undefined;
  schema?: ZodType<TInput> | undefined;
  handler: (
    input: TInput,
    ctx: RequestContext,
    tx?: DrizzleTransaction,
  ) => Promise<TOutput>;
}

export interface RouteExecutionResult<T> {
  statusCode: number;
  headers: Record<string, string>;
  body: T | { error: unknown };
}

/**
 * Universal route execution engine.
 * Authenticates, rate-limits, validates input, checks permissions, executes within withTenant,
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
      // 1. Rate Limiting (if defined)
      if (def.rateLimit) {
        const rateKey = def.rateLimit.keyGenerator
          ? def.rateLimit.keyGenerator(ctx)
          : `${ctx.companyId}:${ctx.userId || ctx.ip || 'anon'}`;
        const rateResult = await checkRateLimit(
          rateKey,
          def.rateLimit.limit,
          def.rateLimit.windowSeconds,
        );

        headers['X-RateLimit-Limit'] = String(def.rateLimit.limit);
        headers['X-RateLimit-Remaining'] = String(rateResult.remaining);
        headers['X-RateLimit-Reset'] = String(rateResult.resetSeconds);

        if (!rateResult.allowed) {
          logger.warn({ rateKey }, 'Request rejected by rate limiter');
          throw new RateLimitedError(rateResult.resetSeconds);
        }
      }

      // 2. Authentication Requirement
      if (def.requireAuth && !ctx.isAuthenticated) {
        throw new UnauthorizedError('Authentication is required to access this resource.');
      }

      // 3. Authorization Check (if permission defined)
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

      // 4. Input Validation (via Zod)
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

      // 5. Execution (with or without tenant transaction envelope)
      let result: TOutput;
      if (def.skipTenantTransaction) {
        result = await def.handler(parsedInput, ctx);
      } else {
        result = await withTenant(ctx, async tx => {
          return await def.handler(parsedInput, ctx, tx);
        });
      }

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

/**
 * Next.js App Router adapter wrapping defineRoute.
 * Automatically resolves session tokens from cookies/headers, binds context,
 * extracts JSON or URL query params, and returns standard Response.
 */
export function createNextRoute<TInput = unknown, TOutput = unknown>(
  def: RouteDefinition<TInput, TOutput>,
) {
  const runner = defineRoute(def);

  return async (
    req: Request,
    // Context is typed as any to satisfy Next.js 15 App Router route typing polymorphism
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any,
  ): Promise<Response> => {
    // 1. Extract request metadata
    const requestId = req.headers.get('x-request-id') || generateUuidV7();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || undefined;

    // 2. Extract session token
    let token: string | undefined;
    const cookieHeader = req.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/hrms_session=([^;]+)/);
      if (match) token = match[1];
    }
    if (!token) {
      const authHeader = req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    // 3. Resolve session & context
    let ctx: RequestContext;
    if (token) {
      const session = await getSessionByToken(token);
      if (session) {
        const authData = await getUserAuthorization(session.companyId, session.userId);
        ctx = {
          companyId: session.companyId,
          userId: session.userId,
          sessionId: session.id,
          stepUpUntil: session.stepUpUntil,
          roles: authData.roles,
          permissions: authData.permissions,
          requestId,
          ip,
          userAgent,
          isAuthenticated: true,
        };
      } else {
        ctx = createAnonymousContext(requestId, ip, userAgent);
      }
    } else {
      ctx = createAnonymousContext(requestId, ip, userAgent);
    }

    // 4. Parse input (JSON body for mutating requests, query parameters for GET/DELETE)
    let rawInput: Record<string, unknown> = {};
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        const text = await req.text();
        if (text) {
          rawInput = JSON.parse(text);
        }
      } catch {
        rawInput = {};
      }
    } else {
      const url = new URL(req.url);
      url.searchParams.forEach((val, key) => {
        rawInput[key] = val;
      });
    }

    // Merge route params if provided
    if (context?.params) {
      const resolvedParams = await context.params;
      if (resolvedParams) {
        rawInput = { ...rawInput, ...resolvedParams };
      }
    }

    // 5. Run route runner
    const result = await runner(rawInput, ctx);

    let responseHeaders: Record<string, string> = { ...result.headers };
    let responseBody: unknown = result.body;

    if (
      result.body &&
      typeof result.body === 'object' &&
      '__headers' in (result.body as Record<string, unknown>)
    ) {
      const { __headers, ...rest } = result.body as { __headers?: Record<string, string> };
      if (__headers) {
        responseHeaders = { ...responseHeaders, ...__headers };
      }
      responseBody = rest;
    }

    const isTextStream =
      responseHeaders['Content-Type']?.startsWith('text/csv') ||
      responseHeaders['Content-Type']?.startsWith('text/plain');

    if (isTextStream) {
      let textContent = '';
      if (typeof responseBody === 'string') {
        textContent = responseBody;
      } else if (
        typeof responseBody === 'object' &&
        responseBody !== null &&
        'csv' in (responseBody as Record<string, unknown>)
      ) {
        textContent = String((responseBody as { csv: unknown }).csv || '');
      } else {
        textContent = String(responseBody ?? '');
      }

      return new Response(textContent, {
        status: result.statusCode,
        headers: responseHeaders,
      }) as unknown as Response;
    }

    return new Response(JSON.stringify(responseBody), {
      status: result.statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...responseHeaders,
      },
    }) as unknown as Response;
  };
}
