import { authClient, wrappedApiClient } from '@/lib/api';
import { useRouter } from '@tanstack/react-router';
import type { AuthState, LoginCredentials, ResetPasswordInput, User } from '@tensrai/shared';
import { type Permission, ROLE_PERMISSIONS } from '@tensrai/shared';
import React from 'react';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const errorData = await response.json();
    return errorData.error || errorData.message || 'Login failed';
  } catch {
    return response.ok ? 'Login failed' : `Login failed with status ${response.status}`;
  }
};

interface AuthStore extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (data: ResetPasswordInput) => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  hasPermission: (permission: Permission) => boolean;
  isAdmin: () => boolean;
  checkIsAuthenticated: () => boolean;
  _router: ReturnType<typeof useRouter> | null;
  _setRouter: (router: ReturnType<typeof useRouter>) => void;
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      session: null,
      _router: null,
      _setRouter: router => set({ _router: router }),
      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true, error: null });

        try {
          const response = await authClient.post<any>('sign-in', {
            email: credentials.email,
            password: credentials.password,
          });

          if (response?.ok) {
            await get().checkAuth();
            set({ isLoading: false, error: null });

            const router = get()._router;
            if (router) {
              router.navigate({ to: '/' });
            }
            return;
          }

          const errorMessage = await getErrorMessage(response);
          set({ isLoading: false, error: errorMessage });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Login failed',
          });
        }
      },

      logout: async () => {
        set({ isLoading: true, error: null });

        try {
          const response = await authClient.post('sign-out');

          // Better Auth returns empty response on successful logout
          if (!response || !response.ok) {
            throw new Error('Logout failed');
          }

          set({
            user: null,
            isAuthenticated: false,
            session: null,
            isLoading: false,
            error: null,
          });

          // Navigate to login after successful logout
          const router = get()._router;
          if (router) {
            router.navigate({ to: '/auth/login' });
          }
        } catch (error) {
          set({
            user: null,
            isAuthenticated: false,
            session: null,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Logout failed',
          });
        }
      },

      resetPassword: async (data: ResetPasswordInput) => {
        set({ isLoading: true, error: null });

        try {
          await wrappedApiClient.post('/auth/reset-password', {
            tempPassword: data.tempPassword,
            newPassword: data.newPassword,
            confirmPassword: data.confirmPassword,
            displayName: data.displayName,
          });

          await get().checkAuth();

          set({
            isLoading: false,
            error: null,
          });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Password reset failed',
          });
        }
      },

      checkAuth: async () => {
        try {
          const sessionResponse = await authClient.get<any>('session');

          if (sessionResponse?.ok) {
            // Session endpoint returns JSON data even for successful auth
            const sessionData = await sessionResponse.json();

            if (sessionData.user && sessionData.session) {
              set({
                user: sessionData.user as User,
                isAuthenticated: true,
                session: sessionData.session,
                error: null,
              });
            } else {
              set({
                user: null,
                isAuthenticated: false,
                session: null,
                error: null,
              });
            }
          } else {
            set({
              user: null,
              isAuthenticated: false,
              session: null,
              error: null,
            });
          }
        } catch (_error) {
          set({
            user: null,
            isAuthenticated: false,
            session: null,
            error: null,
          });
        }
      },

      clearError: () => {
        set({ error: null });
      },

      hasPermission: (permission: Permission) => {
        const { user } = get();
        if (!user || !user.role) {
          return false;
        }

        const rolePermissions = (ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS] ??
          []) as readonly Permission[];

        return rolePermissions.includes(permission);
      },

      isAdmin: () => {
        const { user } = get();
        return user?.role === 'ADMIN';
      },

      checkIsAuthenticated: () => {
        const { user } = get();
        return !!user;
      },
    }),
    {
      name: 'auth-store',
      partialize: (state: AuthStore) => {
        const { _router, _setRouter, ...stateToPersist } = state;
        return {
          user: stateToPersist.user,
          isAuthenticated: stateToPersist.isAuthenticated,
          session: stateToPersist.session,
        };
      },
    }
  )
);

export const useAuth = () => {
  const auth = useAuthStore();
  const router = useRouter();

  // Set the router in the store when it's available
  React.useEffect(() => {
    if (!auth._router) {
      auth._setRouter(router);
    }
  }, [router, auth._router, auth._setRouter]);

  return {
    ...auth,
    user: auth.user,
    isLoading: auth.isLoading,
    error: auth.error,
    canAccess: (resource: Permission) => {
      return auth.hasPermission(resource);
    },
    isLoggedIn: auth.checkIsAuthenticated(),
    needsPasswordReset: auth.user?.mustResetPassword || false,
    userRole: auth.user?.role,
    displayName: auth.user?.displayName || auth.user?.username,
  };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  React.useEffect(() => {
    useAuthStore.getState().checkAuth();
  }, []);

  return children;
};
