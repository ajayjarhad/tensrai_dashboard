export const ROLE = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export const ROLE_PERMISSIONS = {
  [ROLE.ADMIN]: [
    'admin:user_management',
    'admin:system_config',
    'user:dashboard_view',
    'user:robot_status_read',
    'robot:control',
    'robot:emergency_stop',
  ],
  [ROLE.USER]: ['user:dashboard_view', 'user:robot_status_read'],
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];
export type Permission = string;

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  displayName?: string;
  mustResetPassword: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  username: string;
  email: string;
  role: Role;
  displayName?: string;
}

export interface CreateUserResponse {
  user: Pick<User, 'id' | 'username' | 'email' | 'role' | 'displayName'>;
  tempPassword: string;
}

export interface UpdateUserInput {
  username?: string;
  email?: string;
  role?: Role;
  displayName?: string;
  isActive?: boolean;
  mustResetPassword?: boolean;
}

export interface ResetPasswordInput {
  tempPassword: string;
  newPassword: string;
  confirmPassword: string;
  displayName?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: Role;
  displayName?: string;
  mustResetPassword: boolean;
}

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
