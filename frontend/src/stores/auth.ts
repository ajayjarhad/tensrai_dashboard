import type {
  AuthState,
  LoginCredentials,
  Permission,
  ResetPasswordInput,
  User,
} from '@tensrai/shared';
import { ROLE_PERMISSIONS } from '@tensrai/shared';
import { HTTPError } from 'ky';
import React from 'react';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { apiClient } from '@/lib/api';
import { navigateAfterLogin, navigateToLogin, setSessionRejectedHandler } from '@/lib/navigation';
import { queryClient } from '@/lib/query-client';

// Check if localStorage is available
const isLocalStorageAvailable = () => {
  try {
    const test = '__localStorage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
};

const shouldPersist = isLocalStorageAvailable();

interface AuthStore extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  firstTimeSetup: (data: ResetPasswordInput) => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  hasPermission: (permission: Permission) => boolean;
  isAdmin: () => boolean;
  checkIsAuthenticated: () => boolean;
}

export type UseAuthReturn = AuthStore & {
  hasHydrated: boolean;
  needsPasswordReset: boolean;
};

type PersistApi = {
  onHydrate: (callback: (state: AuthStore) => void) => () => void;
  onFinishHydration: (callback: (state: AuthStore) => void) => () => void;
  hasHydrated: () => boolean;
};

export const useAuthStore = create<AuthStore>()(
  devtools(
    shouldPersist
      ? persist(
          (set, get) => ({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
            session: null,
            login: async (credentials: LoginCredentials) => {
              set({ isLoading: true, error: null });

              try {
                const response = await apiClient.post<any>('auth/sign-in', {
                  username: credentials.username,
                  password: credentials.password,
                });

                if (response?.success === true) {
                  // Set auth state directly from login response
                  set({
                    user: response.user as User,
                    isAuthenticated: true,
                    session: response.session,
                    isLoading: false,
                    error: null,
                  });

                  // Handle post-login navigation using navigation service
                  const state = get();
                  if (state.user) {
                    navigateAfterLogin(state.user);
                  }
                } else {
                  const errorMessage = response?.error || 'Login failed';
                  set({ isLoading: false, error: errorMessage });
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Login failed';
                set({ isLoading: false, error: message });
              }
            },

            logout: async () => {
              set({ isLoading: true, error: null });

              try {
                await apiClient.post('auth/sign-out');

                set({
                  user: null,
                  isAuthenticated: false,
                  session: null,
                  isLoading: false,
                  error: null,
                });

                // Navigate to login after successful logout
                navigateToLogin();
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

            firstTimeSetup: async (data: ResetPasswordInput) => {
              set({ isLoading: true, error: null });

              try {
                await apiClient.post('auth/first-time-setup', {
                  tempPassword: data.tempPassword,
                  newPassword: data.newPassword,
                  confirmPassword: data.confirmPassword,
                  displayName: data.displayName,
                });

                try {
                  await apiClient.post('auth/sign-out');
                } catch (logoutError) {
                  console.warn('Failed to sign out after password setup', logoutError);
                }

                set({
                  user: null,
                  isAuthenticated: false,
                  session: null,
                  isLoading: false,
                  error: null,
                });

                navigateToLogin();
              } catch (error) {
                set({
                  isLoading: false,
                  error: error instanceof Error ? error.message : 'Password setup failed',
                });
              }
            },

            checkAuth: async () => {
              // Don't check auth if already authenticated to prevent race conditions
              const currentState = get();
              if (currentState.isAuthenticated && currentState.user) {
                return;
              }

              set({ isLoading: true });

              try {
                const sessionResponse = await apiClient.get<any>('auth/session');

                if (sessionResponse?.user && sessionResponse?.session) {
                  set({
                    user: sessionResponse.user as User,
                    isAuthenticated: true,
                    session: sessionResponse.session,
                    isLoading: false,
                    error: null,
                  });
                } else {
                  set({
                    user: null,
                    isAuthenticated: false,
                    session: null,
                    isLoading: false,
                    error: null,
                  });
                }
              } catch (_error) {
                set({
                  user: null,
                  isAuthenticated: false,
                  session: null,
                  isLoading: false,
                  error: null,
                });
              }
            },

            clearError: () => {
              set({ error: null });
            },

            hasPermission: (permission: Permission) => {
              const { user } = get();
              if (!user || !user.isActive) return false;

              const userPermissions = ROLE_PERMISSIONS[user.role] || [];
              return userPermissions.includes(permission as any);
            },

            isAdmin: () => {
              const { user } = get();
              return (user?.role === 'ADMIN' || user?.role === 'STAFF') && user.isActive;
            },

            checkIsAuthenticated: () => {
              return get().isAuthenticated && !!get().user?.isActive;
            },
          }),
          {
            name: 'auth-storage',
            partialize: state => ({
              user: state.user,
              isAuthenticated: state.isAuthenticated,
              session: state.session,
              // Don't persist loading states, errors
            }),
            onRehydrateStorage: () => state => {
              // Reset loading states on rehydration
              if (state) {
                state.isLoading = false;
                state.error = null;
              }
            },
          }
        )
      : (set, get) => ({
          // Fallback store without persistence when localStorage is unavailable
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
          session: null,
          login: async (credentials: LoginCredentials) => {
            set({ isLoading: true, error: null });

            try {
              const response = await apiClient.post<any>('auth/sign-in', {
                username: credentials.username,
                password: credentials.password,
              });

              if (response?.success === true) {
                // Set auth state directly from login response
                set({
                  user: response.user as User,
                  isAuthenticated: true,
                  session: response.session,
                  isLoading: false,
                  error: null,
                });

                // Handle post-login navigation using navigation service
                const state = get();
                if (state.user) {
                  navigateAfterLogin(state.user);
                }
              } else {
                const errorMessage = response?.error || 'Login failed';
                set({ isLoading: false, error: errorMessage });
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Login failed';
              set({ isLoading: false, error: message });
            }
          },

          logout: async () => {
            set({ isLoading: true, error: null });

            try {
              await apiClient.post('auth/sign-out');

              set({
                user: null,
                isAuthenticated: false,
                session: null,
                isLoading: false,
                error: null,
              });

              // Navigate to login after successful logout
              navigateToLogin();
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

          firstTimeSetup: async (data: ResetPasswordInput) => {
            set({ isLoading: true, error: null });

            try {
              await apiClient.post('auth/first-time-setup', {
                tempPassword: data.tempPassword,
                newPassword: data.newPassword,
                confirmPassword: data.confirmPassword,
                displayName: data.displayName,
              });

              try {
                await apiClient.post('auth/sign-out');
              } catch (logoutError) {
                console.warn('Failed to sign out after password setup', logoutError);
              }

              set({
                user: null,
                isAuthenticated: false,
                session: null,
                isLoading: false,
                error: null,
              });

              navigateToLogin();
            } catch (error) {
              set({
                isLoading: false,
                error: error instanceof Error ? error.message : 'Password setup failed',
              });
            }
          },

          checkAuth: async () => {
            // Don't check auth if already authenticated to prevent race conditions
            const currentState = get();
            if (currentState.isAuthenticated && currentState.user) {
              return;
            }

            set({ isLoading: true });

            try {
              const sessionResponse = await apiClient.get<any>('auth/session');

              if (sessionResponse?.user && sessionResponse?.session) {
                set({
                  user: sessionResponse.user as User,
                  isAuthenticated: true,
                  session: sessionResponse.session,
                  isLoading: false,
                  error: null,
                });
              } else {
                set({
                  user: null,
                  isAuthenticated: false,
                  session: null,
                  isLoading: false,
                  error: null,
                });
              }
            } catch (_error) {
              set({
                user: null,
                isAuthenticated: false,
                session: null,
                isLoading: false,
                error: null,
              });
            }
          },

          clearError: () => {
            set({ error: null });
          },

          hasPermission: (permission: Permission) => {
            const { user } = get();
            if (!user || !user.isActive) return false;

            const userPermissions = ROLE_PERMISSIONS[user.role] || [];
            return userPermissions.includes(permission as any);
          },

          isAdmin: () => {
            const { user } = get();
            return (user?.role === 'ADMIN' || user?.role === 'STAFF') && user.isActive;
          },

          checkIsAuthenticated: () => {
            return get().isAuthenticated && !!get().user?.isActive;
          },
        }),
    { name: 'auth-store' }
  )
);

// Cached robots, maps and runs belong to one organization: drop them whenever the signed-in
// user changes (logout, expired session, another account logging in).
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) queryClient.clear();
});

const clearSignedInState = () => {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    session: null,
    isLoading: false,
    error: null,
  });
};

setSessionRejectedHandler(rejection => {
  const { isAuthenticated, user } = useAuthStore.getState();
  if (!isAuthenticated || !user) return;

  if (rejection === 'lost') {
    clearSignedInState();
    navigateToLogin();
    return;
  }

  // Update the saved user first: the setup page sends anyone who doesn't need it back here.
  const needsSetup = { ...user, mustResetPassword: true };
  useAuthStore.setState({ user: needsSetup });
  navigateAfterLogin(needsSetup);
});

// Saved login state only says who was signed in last time. Check it against the server once on
// load, which also picks up changes such as a new organization name or role. Only a definite "no
// session" signs out: a network problem must not end the session of someone watching a robot.
export const revalidateSession = async () => {
  try {
    const response = await apiClient.get<any>('auth/session');
    if (response?.user && response?.session) {
      useAuthStore.setState({
        user: response.user as User,
        session: response.session,
        isAuthenticated: true,
      });
    }
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 401) clearSignedInState();
  }
};

const getPersistApi = (): PersistApi | undefined => {
  return (useAuthStore as typeof useAuthStore & { persist?: PersistApi }).persist;
};

export const useAuth = (): UseAuthReturn => {
  const store = useAuthStore();
  const [hasHydrated, setHasHydrated] = React.useState(false);

  // Handle Zustand persistence hydration
  React.useEffect(() => {
    const persistApi = getPersistApi();

    if (!persistApi) {
      setHasHydrated(true);
      return undefined;
    }

    setHasHydrated(persistApi.hasHydrated());

    const unsubHydrate = persistApi.onHydrate(() => {
      setHasHydrated(false);
    });

    const unsubFinishHydration = persistApi.onFinishHydration(() => {
      setHasHydrated(true);
    });

    return () => {
      unsubHydrate();
      unsubFinishHydration();
    };
  }, []);

  return {
    ...store,
    hasHydrated,
    needsPasswordReset: store.user?.mustResetPassword || false,
  };
};
