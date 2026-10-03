import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'hrms_access_token';
const REFRESH_TOKEN_KEY = 'hrms_refresh_token';
const USER_DATA_KEY = 'hrms_user_profile';

export const storage = {
  /**
   * Securely saves the JWT/session access token.
   */
  async setAuthToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
    } catch {
      // In-memory fallback if SecureStore is unavailable in certain testing environments
      if (typeof globalThis !== 'undefined') {
        (globalThis as Record<string, unknown>)[ACCESS_TOKEN_KEY] = token;
      }
    }
  },

  /**
   * Retrieves the stored access token.
   */
  async getAuthToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      if (typeof globalThis !== 'undefined') {
        return ((globalThis as Record<string, unknown>)[ACCESS_TOKEN_KEY] as string) ?? null;
      }
      return null;
    }
  },

  /**
   * Removes the stored access token.
   */
  async clearAuthToken(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      if (typeof globalThis !== 'undefined') {
        delete (globalThis as Record<string, unknown>)[ACCESS_TOKEN_KEY];
      }
    }
  },

  /**
   * Securely saves the refresh token.
   */
  async setRefreshToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    } catch {
      if (typeof globalThis !== 'undefined') {
        (globalThis as Record<string, unknown>)[REFRESH_TOKEN_KEY] = token;
      }
    }
  },

  /**
   * Retrieves the stored refresh token.
   */
  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      if (typeof globalThis !== 'undefined') {
        return ((globalThis as Record<string, unknown>)[REFRESH_TOKEN_KEY] as string) ?? null;
      }
      return null;
    }
  },

  /**
   * Stores user profile metadata.
   */
  async setUserData(data: Record<string, unknown>): Promise<void> {
    try {
      await SecureStore.setItemAsync(USER_DATA_KEY, JSON.stringify(data));
    } catch {
      if (typeof globalThis !== 'undefined') {
        (globalThis as Record<string, unknown>)[USER_DATA_KEY] = JSON.stringify(data);
      }
    }
  },

  /**
   * Retrieves stored user profile metadata.
   */
  async getUserData(): Promise<Record<string, unknown> | null> {
    try {
      const data = await SecureStore.getItemAsync(USER_DATA_KEY);
      return data ? (JSON.parse(data) as Record<string, unknown>) : null;
    } catch {
      if (typeof globalThis !== 'undefined') {
        const data = (globalThis as Record<string, unknown>)[USER_DATA_KEY] as string | undefined;
        return data ? (JSON.parse(data) as Record<string, unknown>) : null;
      }
      return null;
    }
  },

  /**
   * Clears all session tokens and user data.
   */
  async clearAllTokens(): Promise<void> {
    await this.clearAuthToken();
    try {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_DATA_KEY);
    } catch {
      if (typeof globalThis !== 'undefined') {
        delete (globalThis as Record<string, unknown>)[REFRESH_TOKEN_KEY];
        delete (globalThis as Record<string, unknown>)[USER_DATA_KEY];
      }
    }
  },
};
