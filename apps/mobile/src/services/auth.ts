import { apiClient } from './api.js';
import { storage } from './storage.js';

export interface LoginResult {
  mfaRequired: boolean;
  mfaTicket?: string;
  token?: string;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    companyId: string;
    roles: string[];
  };
}

export interface PushTokenPayload {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
}

export const authService = {
  /**
   * Submits email and password to initiate authentication.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const res = await apiClient<LoginResult>('/api/v1/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email, password }),
    });

    if (res.token) {
      await storage.setAuthToken(res.token);
      if (res.user) {
        await storage.setUserData(res.user);
      }
    }

    return res;
  },

  /**
   * Completes login by verifying TOTP MFA code with temporary mfaTicket.
   */
  async verifyMfa(mfaTicket: string, code: string): Promise<LoginResult> {
    const res = await apiClient<LoginResult>('/api/v1/auth/mfa/verify', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ mfaTicket, code }),
    });

    if (res.token) {
      await storage.setAuthToken(res.token);
      if (res.user) {
        await storage.setUserData(res.user);
      }
    }

    return res;
  },

  /**
   * Registers Expo/device push notification token on backend.
   */
  async registerPushToken(payload: PushTokenPayload): Promise<{ success: boolean }> {
    return apiClient<{ success: boolean }>('/api/v1/me/push-token', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Log out active session and clear secure storage.
   */
  async logout(): Promise<void> {
    try {
      await apiClient('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      await storage.clearAllTokens();
    }
  },

  /**
   * Checks if an authenticated session exists in secure storage.
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await storage.getAuthToken();
    return !!token;
  },
};
