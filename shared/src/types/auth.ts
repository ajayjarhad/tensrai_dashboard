import type { User } from './user';

export interface AuthSession {
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    mustResetPassword: boolean;
  };
  sessionId: string;
  expiresAt: Date;
}

export interface LoginResponse {
  user: User;
  session: AuthSession;
  mustResetPassword?: boolean;
}

export interface AuthResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AuthError {
  code:
    | 'INVALID_CREDENTIALS'
    | 'SESSION_EXPIRED'
    | 'INSUFFICIENT_PERMISSIONS'
    | 'USER_NOT_FOUND'
    | 'TEMP_PASSWORD_EXPIRED';
  message: string;
  details?: Record<string, unknown>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface SessionValidation {
  valid: boolean;
  user?: User;
  error?: AuthError;
}

export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  session: AuthSession | null;
}
