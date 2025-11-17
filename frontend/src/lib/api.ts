import type { Options } from 'ky';
import ky, { HTTPError } from 'ky';

export const api = ky.create({
  prefixUrl: 'http://localhost:5001/api',
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
    afterResponse: [
      async (request, _, response) => {
        if (import.meta.env.DEV) {
          console.log(`API Response: ${request.method} ${request.url} - ${response.status}`);
        }
      },
    ],
  },
});

export const authApi = ky.create({
  prefixUrl: 'http://localhost:5001/api/auth',
  credentials: 'include',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  retry: {
    limit: 1,
    methods: ['post'],
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

export const authClient = {
  post: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    authApi.post<T>(url, { json: data, ...withOptions(options) }),
  get: <T>(url: string, options?: ApiRequestOptions) => authApi.get<T>(url, withOptions(options)),
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

export const wrappedApiClient = {
  get: <T>(url: string, options?: ApiRequestOptions) =>
    unwrapApiResponse<T>(() =>
      api.get<ApiResponse<T>>(url, withOptions(options)).json<ApiResponse<T>>()
    ),

  post: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    unwrapApiResponse<T>(() =>
      api.post<ApiResponse<T>>(url, { json: data, ...withOptions(options) }).json<ApiResponse<T>>()
    ),

  put: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    unwrapApiResponse<T>(() =>
      api.put<ApiResponse<T>>(url, { json: data, ...withOptions(options) }).json<ApiResponse<T>>()
    ),

  patch: <T>(url: string, data?: any, options?: ApiRequestOptions) =>
    unwrapApiResponse<T>(() =>
      api.patch<ApiResponse<T>>(url, { json: data, ...withOptions(options) }).json<ApiResponse<T>>()
    ),

  delete: <T>(url: string, options?: ApiRequestOptions) =>
    unwrapApiResponse<T>(() =>
      api.delete<ApiResponse<T>>(url, withOptions(options)).json<ApiResponse<T>>()
    ),
};

export const fetchApi = async <T>(apiCall: () => Promise<T>, errorMessage?: string): Promise<T> => {
  try {
    return await apiCall();
  } catch (error) {
    const message = errorMessage || (error instanceof Error ? error.message : 'API request failed');
    throw new ApiError(message, undefined, undefined, error);
  }
};
