import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { PERMISSIONS, type Permission } from '@tensrai/shared';
import { ArrowLeft, Home } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import type { NavigationService } from '@/lib/navigation';
import { setNavigationService } from '@/lib/navigation';
import { queryClient } from '@/lib/query-client';
import { useAuth, useAuthStore } from '@/stores/auth';
import { signedInGate } from './signedInGate';

// Each page is its own chunk, so sign-in doesn't download the map renderer or the admin screens.
// The shell (header, fleet E-stop) is one too, fetched only once someone is signed in, and the
// signed-in pages load through it (app/pages.ts says why).
const AppShell = lazyRouteComponent(() => import('@/app/AppShell'), 'AppShell');
const shellPages = () => import('@/app/AppShell').then(shell => shell.pages);
const Dashboard = lazyRouteComponent(
  () => shellPages().then(pages => pages.dashboard()),
  'Dashboard'
);
const RobotManagement = lazyRouteComponent(
  () => shellPages().then(pages => pages.robots()),
  'RobotManagement'
);
const UserManagement = lazyRouteComponent(
  () => shellPages().then(pages => pages.users()),
  'UserManagement'
);
const UserCreation = lazyRouteComponent(
  () => shellPages().then(pages => pages.newUser()),
  'UserCreation'
);
// Separate chunks: the password-setup form brings zod and react-hook-form, the login form doesn't.
const LoginForm = lazyRouteComponent(
  () => import('@/features/auth/components/login-form'),
  'LoginForm'
);
const FirstTimePasswordForm = lazyRouteComponent(
  () => import('@/features/auth/components/first-time-password-form'),
  'FirstTimePasswordForm'
);

const MapListPage = lazyRouteComponent(
  () => shellPages().then(pages => pages.mapList()),
  'MapListPage'
);
const MapEditorPage = lazyRouteComponent(
  () => shellPages().then(pages => pages.mapEditor()),
  'MapEditorPage'
);
const MergePage = lazyRouteComponent(
  () => shellPages().then(pages => pages.mapMerge()),
  'MergePage'
);

const PageLoading = ({ message }: { message: string }) => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  </div>
);

// The same permission table as the backend; a page the role can't use sends it to /unauthorized.
const requirePermission = (permission: Permission) => () => {
  const { hasPermission, isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated) throw redirect({ to: '/auth/login' });
  if (!hasPermission(permission)) throw redirect({ to: '/unauthorized' });
};

// Root Route
const rootRoute = createRootRoute({
  component: () => {
    return (
      <div className="h-screen flex flex-col bg-background text-foreground">
        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
      </div>
    );
  },
});

// Every signed-in page, under one header and fleet E-stop.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => {
    const { user, isAuthenticated, isLoading, hasHydrated } = useAuth();
    const gate = signedInGate({
      hasHydrated,
      isLoading,
      isAuthenticated,
      mustResetPassword: Boolean(user?.mustResetPassword),
    });

    if (gate === 'loading') {
      return <PageLoading message={hasHydrated ? 'Loading...' : 'Restoring session...'} />;
    }
    if (gate === 'login') return <Navigate to="/auth/login" replace />;
    if (gate === 'password-reset') return <Navigate to="/auth/first-time-setup" replace />;

    return (
      <Suspense fallback={<PageLoading message="Loading..." />}>
        <AppShell />
      </Suspense>
    );
  },
});

// Index Route (Dashboard)
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  loader: () => {
    if (!useAuthStore.getState().isAuthenticated) return;
    // The page fetches the same queries itself if this chunk fails to load.
    import('@/features/robot-map/queries')
      .then(({ prefetchDashboard }) => prefetchDashboard(queryClient))
      .catch(() => undefined);
    // Its code loads through the shell's chunk; left to the Suspense boundary below, that extra step
    // costs a frame of "Loading...". Never rejects: a failed load still surfaces when it renders.
    return Dashboard.preload?.();
  },
  component: () => (
    <Suspense fallback={<PageLoading message="Loading..." />}>
      <Dashboard />
    </Suspense>
  ),
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

    // Fetched while the operator types, so signing in doesn't wait for it. Only after the page has
    // loaded: on a slow link these downloads would otherwise hold back the form's first paint.
    useEffect(() => {
      const preload = () => {
        void AppShell.preload?.();
        void Dashboard.preload?.();
      };
      if (document.readyState === 'complete') {
        preload();
        return;
      }
      window.addEventListener('load', preload, { once: true });
      return () => window.removeEventListener('load', preload);
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

// Maps
const mapsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/maps',
  beforeLoad: requirePermission(PERMISSIONS.MAPS_VIEW),
});

const mapListRoute = createRoute({
  getParentRoute: () => mapsRoute,
  path: '/',
  component: MapListPage,
});

const mapMergeRoute = createRoute({
  getParentRoute: () => mapsRoute,
  path: 'merge',
  beforeLoad: requirePermission(PERMISSIONS.MAPS_EDIT),
  component: MergePage,
});

const mapEditorRoute = createRoute({
  getParentRoute: () => mapsRoute,
  path: '$mapId/edit',
  beforeLoad: requirePermission(PERMISSIONS.MAPS_EDIT),
  component: MapEditorPage,
});

// Admin Routes
const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  beforeLoad: requirePermission(PERMISSIONS.USER_MANAGEMENT),
});

const userManagementRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  component: UserManagement,
});

const createTempUserRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/create-temporary-user',
  component: UserCreation,
});

const robotManagementRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/robots',
  component: RobotManagement,
});

// Staff Route
const staffRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/staff',
  beforeLoad: requirePermission(PERMISSIONS.STAFF_CONSOLE),
  component: lazyRouteComponent(
    () => shellPages().then(pages => pages.organizations()),
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
  appRoute.addChildren([
    indexRoute,
    mapsRoute.addChildren([mapListRoute, mapMergeRoute, mapEditorRoute]),
    adminRoute.addChildren([userManagementRoute, createTempUserRoute, robotManagementRoute]),
    staffRoute,
  ]),
  authRoute.addChildren([loginRoute, firstTimeSetupRoute]),
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
