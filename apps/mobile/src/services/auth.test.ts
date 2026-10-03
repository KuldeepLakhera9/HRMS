import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from './auth.js';
import { storage } from './storage.js';

vi.mock('expo-secure-store', () => {
  const memoryStore = new Map<string, string>();
  return {
    setItemAsync: vi.fn(async (key: string, value: string) => {
      memoryStore.set(key, value);
    }),
    getItemAsync: vi.fn(async (key: string) => {
      return memoryStore.get(key) ?? null;
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      memoryStore.delete(key);
    }),
  };
});

describe('Mobile Auth & Storage Layer (P2-MOB-01)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await storage.clearAllTokens();
  });

  describe('Secure Storage Service', () => {
    it('sets and retrieves authentication tokens', async () => {
      await storage.setAuthToken('jwt-access-token-123');
      const retrieved = await storage.getAuthToken();
      expect(retrieved).toBe('jwt-access-token-123');
    });

    it('clears stored tokens cleanly', async () => {
      await storage.setAuthToken('jwt-access-token-123');
      await storage.clearAuthToken();
      const retrieved = await storage.getAuthToken();
      expect(retrieved).toBeNull();
    });

    it('persists and retrieves user metadata', async () => {
      const user = { id: 'u1', email: 'user@company.com', firstName: 'Alice' };
      await storage.setUserData(user);
      const retrieved = await storage.getUserData();
      expect(retrieved).toEqual(user);
    });
  });

  describe('Auth Service Workflows', () => {
    it('handles direct login when MFA is not required', async () => {
      const mockResponse = {
        data: {
          mfaRequired: false,
          token: 'auth-token-xyz',
          user: {
            id: 'u1',
            email: 'user@company.com',
            firstName: 'Alice',
            lastName: 'Smith',
            companyId: 'comp-1',
            roles: ['employee'],
          },
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      } as unknown as Response);

      const result = await authService.login('user@company.com', 'SecurePass123!');

      expect(result.mfaRequired).toBe(false);
      expect(result.token).toBe('auth-token-xyz');
      expect(await storage.getAuthToken()).toBe('auth-token-xyz');
      expect(await authService.isAuthenticated()).toBe(true);
    });

    it('handles MFA challenge requirement and subsequent verification', async () => {
      // 1. Initial Login returns mfaRequired
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: {
            mfaRequired: true,
            mfaTicket: 'mfa-ticket-temp-999',
          },
        }),
      } as unknown as Response);

      const loginRes = await authService.login('admin@company.com', 'AdminPass123!');
      expect(loginRes.mfaRequired).toBe(true);
      expect(loginRes.mfaTicket).toBe('mfa-ticket-temp-999');
      expect(await storage.getAuthToken()).toBeNull();

      // 2. Verify MFA TOTP code
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: {
            mfaRequired: false,
            token: 'mfa-verified-token-555',
            user: {
              id: 'u2',
              email: 'admin@company.com',
              firstName: 'Bob',
              lastName: 'Admin',
              companyId: 'comp-1',
              roles: ['admin'],
            },
          },
        }),
      } as unknown as Response);

      const verifyRes = await authService.verifyMfa('mfa-ticket-temp-999', '123456');
      expect(verifyRes.token).toBe('mfa-verified-token-555');
      expect(await storage.getAuthToken()).toBe('mfa-verified-token-555');
      expect(await authService.isAuthenticated()).toBe(true);
    });

    it('registers push notification token with backend', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: { success: true },
        }),
      } as unknown as Response);

      const res = await authService.registerPushToken({
        token: 'ExponentPushToken[xxxxxxxxxxxxxx]',
        platform: 'android',
        deviceId: 'device-test-1',
      });

      expect(res.success).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/me/push-token'),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('logs out and clears secure storage', async () => {
      await storage.setAuthToken('token-to-clear');

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { success: true } }),
      } as unknown as Response);

      await authService.logout();

      expect(await storage.getAuthToken()).toBeNull();
      expect(await authService.isAuthenticated()).toBe(false);
    });
  });
});
