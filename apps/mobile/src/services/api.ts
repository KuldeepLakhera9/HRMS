import { storage } from './storage.js';

export class ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(message: string, statusCode: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

const getBaseUrl = (): string => {
  return process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
};

export async function apiClient<T = unknown>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': `mob-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    ...((options.headers as Record<string, string>) || {}),
  };

  if (!options.skipAuth) {
    const token = await storage.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const responseData = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage =
      (responseData && typeof responseData === 'object' && 'error' in responseData
        ? (responseData as { error: { message?: string; code?: string; details?: unknown } }).error?.message
        : null) || `Request failed with status ${response.status}`;

    const errorCode =
      (responseData && typeof responseData === 'object' && 'error' in responseData
        ? (responseData as { error: { code?: string } }).error?.code
        : undefined);

    const errorDetails =
      (responseData && typeof responseData === 'object' && 'error' in responseData
        ? (responseData as { error: { details?: unknown } }).error?.details
        : undefined);

    throw new ApiError(errorMessage, response.status, errorCode, errorDetails);
  }

  // Handle ApiResponse wrapped { data: ... }
  if (responseData && typeof responseData === 'object' && 'data' in responseData) {
    return (responseData as { data: T }).data;
  }

  return responseData as T;
}
