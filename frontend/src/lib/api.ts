import { getEnv } from '@tensrai/shared';
import type { Options } from 'ky';
import ky, { HTTPError } from 'ky';
import { notifySessionRejected } from './navigation';

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

  // Support reverse-proxy style relative values like "/api".
  // Without this branch, withProtocol("/api") becomes "http:///api",
  // which URL-parses as host "api" and causes requests to http://api/...
  if (raw.startsWith('/')) {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : fallbackOrigin;
    try {
      const parsed = new URL(raw, origin);
      parsed.pathname = ensureApiPath(parsed.pathname);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return `${origin}/api`;
    }
  }

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

const ACCOUNT_BLOCKED_CODES = new Set(['ACCOUNT_DISABLED', 'NO_ORGANIZATION']);

// Saved login state can outlive the session behind it. Without this the dashboard would keep
// polling and show an empty fleet. /auth/ is exempt: a 401 there just means "not signed in".
const handleRejectedSession = async (request: Request, response: Response) => {
  if (new URL(request.url).pathname.includes('/auth/')) return;

  if (response.status === 401) {
    notifySessionRejected('lost');
  } else if (response.status === 428) {
    notifySessionRejected('password-setup');
  } else if (response.status === 403) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: string } | null;
    if (body?.code && ACCOUNT_BLOCKED_CODES.has(body.code)) notifySessionRejected('lost');
  }
};

export const api = ky.create({
  prefixUrl: resolveApiHttpBase(),
  credentials: 'include',
  timeout: 10000,
  retry: {
    limit: 2,
    methods: ['get', 'put', 'patch', 'delete'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
  hooks: {
    afterResponse: [(request, _options, response) => handleRejectedSession(request, response)],
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

const withJsonBody = (data?: any, options?: ApiRequestOptions): Options | undefined => {
  if (data === undefined) {
    return withOptions(options);
  }
  return { json: data, ...withOptions(options) };
};

export const apiClient = {
  get: <T>(url: string, options?: ApiRequestOptions) =>
    api.get<T>(url, withOptions(options)).json<T>(),

  post: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    api.post<T>(url, withJsonBody(data, options)).json<T>(),

  put: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    api.put<T>(url, withJsonBody(data, options)).json<T>(),

  patch: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    api.patch<T>(url, withJsonBody(data, options)).json<T>(),

  delete: <T>(url: string, options?: ApiRequestOptions) =>
    api.delete<T>(url, withOptions(options)).json<T>(),
};

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}
