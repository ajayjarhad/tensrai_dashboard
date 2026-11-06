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

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  session: AuthSession | null;
}
