interface SessionState {
  hasHydrated: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  mustResetPassword: boolean;
}

// Decided before the app shell mounts, so robot polling and e-stop sockets never start signed out.
export const signedInGate = ({
  hasHydrated,
  isLoading,
  isAuthenticated,
  mustResetPassword,
}: SessionState) => {
  if (!hasHydrated || isLoading) return 'loading';
  if (!isAuthenticated) return 'login';
  if (mustResetPassword) return 'password-reset';
  return 'app';
};
