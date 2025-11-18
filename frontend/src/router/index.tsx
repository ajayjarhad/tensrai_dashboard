import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { PERMISSIONS } from '@tensrai/shared';
import { UserManagement } from '@/features/admin/components';
import { FirstTimePasswordForm, LoginForm } from '@/features/auth/components';
import type { NavigationService } from '@/lib/navigation';
import { setNavigationService } from '@/lib/navigation';
import { useAuth, useAuthStore } from '@/stores/auth';

// Root Route
const rootRoute = createRootRoute({
  component: () => {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Outlet />
      </div>
    );
  },
});

// Index Route (Dashboard)
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => {
    const { user, isAuthenticated, isLoading, hasHydrated } = useAuth();

    // Show loading while Zustand is rehydrating or checking auth state
    if (!hasHydrated || isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">
              {hasHydrated ? 'Loading...' : 'Restoring session...'}
            </p>
          </div>
        </div>
      );
    }

    if (!isAuthenticated) {
      return <Navigate to="/auth/login" replace />;
    }

    if (user?.mustResetPassword) {
      return <Navigate to="/auth/first-time-setup" replace />;
    }

    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6 text-foreground">Tensrai Dashboard</h1>
        <div className="space-y-4">
          <div className="p-4 border border-border rounded-lg bg-card">
            <h2 className="text-lg font-semibold mb-2 text-foreground">Welcome back!</h2>
            <p className="text-muted-foreground">Hello, {user?.displayName || user?.username}!</p>
          </div>

          {user?.role === 'ADMIN' && (
            <div className="p-4 border border-border rounded-lg bg-secondary">
              <h3 className="font-semibold text-foreground">Admin Access</h3>
              <p className="text-muted-foreground text-sm">You have administrative privileges.</p>
            </div>
          )}
        </div>
      </div>
    );
  },
});

// Auth Routes
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
});

const loginRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/login',
  component: () => {
    const { isAuthenticated } = useAuth();

    if (isAuthenticated) {
      throw redirect({
        to: '/',
      });
    }

    return <LoginForm />;
  },
});

const firstTimeSetupRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/first-time-setup',
  component: () => {
    const { isAuthenticated, user } = useAuth();

    if (!isAuthenticated) {
      throw redirect({
        to: '/auth/login',
      });
    }

    if (!user?.mustResetPassword) {
      throw redirect({
        to: '/',
      });
    }

    return <FirstTimePasswordForm />;
  },
});

// Admin Routes
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: () => {
    const { hasPermission, isAuthenticated } = useAuthStore.getState();

    if (!isAuthenticated) {
      throw redirect({
        to: '/auth/login',
      });
    }

    if (!hasPermission(PERMISSIONS.USER_MANAGEMENT)) {
      throw redirect({
        to: '/unauthorized',
      });
    }
  },
});

const userManagementRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  component: () => {
    return <UserManagement />;
  },
});

// Unauthorized Route
const unauthorizedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/unauthorized',
  component: () => {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-md w-full text-center p-8">
          <div className="mb-4">
            <svg
              className="mx-auto h-12 w-12 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-6">
            You don't have permission to access this page.
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors focus-ring"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 transition-colors focus-ring"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  },
});

// Route Tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute.addChildren([loginRoute, firstTimeSetupRoute]),
  adminRoute.addChildren([userManagementRoute]),
  unauthorizedRoute,
]);

// Navigation Service Implementation
const navigationServiceImpl: NavigationService = {
  navigateAfterLogin: user => {
    if (user?.mustResetPassword) {
      router.navigate({ to: '/auth/first-time-setup' });
    } else {
      router.navigate({ to: '/' });
    }
  },
  navigateToLogin: () => {
    router.navigate({ to: '/auth/login' });
  },
  navigateToDashboard: () => {
    router.navigate({ to: '/' });
  },
  navigateToUnauthorized: () => {
    router.navigate({ to: '/unauthorized' });
  },
};

// Set up navigation service
setNavigationService(navigationServiceImpl);

// Router Instance
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground mb-4">404</h1>
        <p className="text-muted-foreground mb-4">Page not found</p>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 focus-ring"
        >
          Go Back
        </button>
      </div>
    </div>
  ),
});

// Router Types
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
