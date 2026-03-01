// Query keys for Robot Map feature
const ROBOT_MAP = 'robot-map';

// Robot-related query keys
const robots = {
  all: [ROBOT_MAP, 'robots'] as const,
  lists: [ROBOT_MAP, 'robots', 'list'] as const,
  detail: (id: string) => [ROBOT_MAP, 'robots', id] as const,
};

// Mission-related query keys
const missions = {
  all: [ROBOT_MAP, 'missions'] as const,
  lists: [ROBOT_MAP, 'missions', 'list'] as const,
  detail: (id: string) => [ROBOT_MAP, 'missions', id] as const,
  runs: (filters?: string) => [ROBOT_MAP, 'missions', 'runs', filters ?? 'all'] as const,
  current: (robotId: string) => [ROBOT_MAP, 'missions', 'current', robotId] as const,
};

// Query keys for Admin feature
const ADMIN = 'admin';
const users = {
  all: [ADMIN, 'users'] as const,
  lists: [ADMIN, 'users', 'list'] as const,
  detail: (id: string) => [ADMIN, 'users', id] as const,
};

// Query keys for Auth feature
const AUTH = 'auth';
const session = {
  all: [AUTH, 'session'] as const,
  current: [AUTH, 'session', 'current'] as const,
};

// Export all query keys
export const queryKeys = {
  robotMap: {
    robots,
    missions,
  },
  admin: {
    users,
  },
  auth: {
    session,
  },
  robots: robots,
  missions: missions,
  users: users,
  session: session,
};
