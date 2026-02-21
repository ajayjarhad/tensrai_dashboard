import { getEnv } from '@tensrai/shared';
import type { Options } from 'ky';
import ky, { HTTPError } from 'ky';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1']);

const browserProtocol = () =>
  typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';

const browserHost = () => (typeof window !== 'undefined' ? window.location.hostname : 'localhost');

const ensureApiPath = (pathname: string) => {
  const trimmed = pathname.replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '/api';
  if (trimmed.toLowerCase().endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
};

const withProtocol = (raw: string, fallbackProtocol: 'http' | 'https') => {
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('ws://') ||
    raw.startsWith('wss://')
  ) {
    return raw;
  }
  return `${fallbackProtocol}://${raw}`;
};

export const resolveApiHttpBase = () => {
  const fallbackProtocol = browserProtocol();
  const fallbackHost = browserHost();
  const fallbackOrigin = `${fallbackProtocol}://${fallbackHost}:5001`;
  const raw = getEnv('VITE_API_URL', fallbackOrigin).trim();

  try {
    const parsed = new URL(withProtocol(raw, fallbackProtocol));
    if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
    if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      parsed.protocol = `${fallbackProtocol}:`;
    }

    // Default local dev backend port if omitted.
    if (!parsed.port && LOCALHOST_HOSTS.has(parsed.hostname)) {
      parsed.port = '5001';
    }

    parsed.pathname = ensureApiPath(parsed.pathname);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return `${fallbackOrigin}/api`;
  }
};

export const resolveWsBaseUrl = () => {
  const parsed = new URL(resolveApiHttpBase());
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
};

export const api = ky.create({
  prefixUrl: resolveApiHttpBase(),
  credentials: 'include',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  retry: {
    limit: 2,
    methods: ['get', 'put', 'patch', 'delete'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeError: [
      async error => {
        if (error instanceof HTTPError) {
          try {
            const cloned = error.response.clone();
            const payload = (await cloned.json()) as ApiResponse;
            const message = payload.error ?? payload.message ?? 'API request failed';
            error.message = message;
          } catch {}
        }
        return error;
      },
    ],
  },
});

type ApiRequestOptions = Omit<Options, 'prefixUrl'>;

const withOptions = (options?: ApiRequestOptions): Options | undefined => options;

export const apiClient = {
  get: <T>(url: string, options?: ApiRequestOptions) =>
    api.get<T>(url, withOptions(options)).json<T>(),

  post: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    api.post<T>(url, { json: data, ...withOptions(options) }).json<T>(),

  put: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    api.put<T>(url, { json: data, ...withOptions(options) }).json<T>(),

  patch: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    api.patch<T>(url, { json: data, ...withOptions(options) }).json<T>(),

  delete: <T>(url: string, options?: ApiRequestOptions) =>
    api.delete<T>(url, withOptions(options)).json<T>(),
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}

export const unwrapApiResponse = async <T>(apiCall: () => Promise<ApiResponse<T>>): Promise<T> => {
  try {
    const response = await apiCall();

    if (!response.success) {
      throw new ApiError(
        response.error || response.message || 'API request failed',
        undefined,
        response.code
      );
    }

    if (response.data === undefined) {
      throw new ApiError('API response missing data field');
    }

    return response.data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'API request failed';
    throw new ApiError(message, undefined, undefined, error);
  }
};

export const fetchApi = async <T>(apiCall: () => Promise<T>, errorMessage?: string): Promise<T> => {
  try {
    return await apiCall();
  } catch (error) {
    const message = errorMessage || (error instanceof Error ? error.message : 'API request failed');
    throw new ApiError(message, undefined, undefined, error);
  }
};
