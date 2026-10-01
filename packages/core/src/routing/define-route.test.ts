import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineRoute } from './define-route.js';
import { PERMISSIONS } from '@hrms/shared';
import type { RequestContext } from './context.js';

describe('defineRoute Wrapper', () => {
  const ctx: RequestContext = {
    companyId: '11111111-1111-1111-1111-111111111111',
    requestId: 'req-test-123',
    isAuthenticated: true,
    roles: [],
    permissions: [],
  };

  it('rejects with 403 when permission is not granted', async () => {
    const route = defineRoute({
      permission: PERMISSIONS.ORG_COMPANY_UPDATE,
      handler: async () => 'ok',
    });

    const res = await route({}, ctx);

    expect(res.statusCode).toBe(403);
    expect(res.headers['X-Request-Id']).toBe('req-test-123');
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects with 400 when input schema validation fails', async () => {
    const schema = z.object({
      email: z.string().email(),
    });

    const route = defineRoute({
      schema,
      handler: async input => input,
    });

    const res = await route({ email: 'not-an-email' }, ctx);

    expect(res.statusCode).toBe(400);
    const body = res.body as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
  });
});
