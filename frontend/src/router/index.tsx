import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { PERMISSIONS } from '@tensrai/shared';
import { ArrowLeft, Home } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { StaffOrgBanner } from '@/features/staff/components/StaffOrgBanner';
import type { NavigationService } from '@/lib/navigation';
import { setNavigationService } from '@/lib/navigation';
import { useAuth, useAuthStore } from '@/stores/auth';

// Each page is its own chunk, so sign-in doesn't download the map renderer or the admin screens.
const Dashboard = lazyRouteComponent(
  () => import('@/features/robot-map/components/Dashboard'),
  'Dashboard'
);
const adminPage = (name: 'RobotManagement' | 'UserCreation' | 'UserManagement') =>
  lazyRouteComponent(() => import('@/features/admin/components'), name);
// Separate chunks: the password-setup form brings zod and react-hook-form, the login form doesn't.
const LoginForm = lazyRouteComponent(
  () => import('@/features/auth/components/login-form'),
  'LoginForm'
);
const FirstTimePasswordForm = lazyRouteComponent(
  () => import('@/features/auth/components/first-time-password-form'),
  'FirstTimePasswordForm'
);

const PageLoading = ({ message }: { message: string }) => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  </div>
);

// Root Route
const rootRoute = createRootRoute({
  component: () => {
    return (
      <div className="h-screen flex flex-col bg-background text-foreground">
        <StaffOrgBanner />
        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
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
      return <PageLoading message={hasHydrated ? 'Loading...' : 'Restoring session...'} />;
    }

    if (!isAuthenticated) {
      return <Navigate to="/auth/login" replace />;
    }

    if (user?.mustResetPassword) {
      return <Navigate to="/auth/first-time-setup" replace />;
    }

    return (
      <Suspense fallback={<PageLoading message="Loading..." />}>
        <Dashboard />
      </Suspense>
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

    // Fetched while the operator types, so signing in doesn't wait for it.
    useEffect(() => {
      void Dashboard.preload?.();
    }, []);

    if (isAuthenticated) {
      return <Navigate to="/" replace />;
    }

    return (
      <Suspense fallback={<PageLoading message="Loading..." />}>
        <LoginForm />
      </Suspense>
    );
  },
});

const firstTimeSetupRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/first-time-setup',
  component: () => {
    const { isAuthenticated, user } = useAuth();

    if (!isAuthenticated) {
      return <Navigate to="/auth/login" replace />;
    }

    if (!user?.mustResetPassword) {
      return <Navigate to="/" replace />;
    }

    return (
      <Suspense fallback={<PageLoading message="Loading..." />}>
        <FirstTimePasswordForm />
      </Suspense>
    );
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
  component: adminPage('UserManagement'),
});

const createTempUserRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/create-temporary-user',
  component: adminPage('UserCreation'),
});

const robotManagementRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/robots',
  component: adminPage('RobotManagement'),
});

// Staff Route
const staffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/staff',
  beforeLoad: () => {
    const { hasPermission, isAuthenticated } = useAuthStore.getState();

    if (!isAuthenticated) {
      throw redirect({
        to: '/auth/login',
      });
    }

    if (!hasPermission(PERMISSIONS.STAFF_CONSOLE)) {
      throw redirect({
        to: '/unauthorized',
      });
    }
  },
  component: lazyRouteComponent(
    () => import('@/features/staff/components/OrganizationsPage'),
    'OrganizationsPage'
  ),
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
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors focus-ring inline-flex items-center justify-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 transition-colors focus-ring inline-flex items-center justify-center gap-2"
            >
              <Home className="h-4 w-4" />
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
  adminRoute.addChildren([userManagementRoute, createTempUserRoute, robotManagementRoute]),
  staffRoute,
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
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 focus-ring inline-flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
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
