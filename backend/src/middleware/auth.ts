import type { AppFastifyReply, AppFastifyRequest } from '../types/app.js';
import { type Permission, ROLE, ROLE_PERMISSIONS } from '../types/shared-shim.js';
import { AuthTracer } from '../utils/tracing.js';

export const requireUser = async (request: AppFastifyRequest, reply: AppFastifyReply) => {
  const user = await request.getCurrentUser();

  if (!user) {
    await request.audit?.({
      userId: 'unknown',
      role: 'unknown',
      action: 'UNAUTHORIZED_ATTEMPT',
      metadata: {
        url: request.url,
        method: request.method,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });

    AuthTracer.traceAuthAttempt('unknown', 'require_user', false, 'Authentication required', {
      url: request.url,
      method: request.method,
      ip: request.ip,
    });

    reply.code(401).send({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });

    return;
  }

  await request.audit?.({
    userId: user.id,
    role: user.role,
    action: 'SYSTEM_ACCESS_GRANTED',
    metadata: {
      url: request.url,
      method: request.method,
    },
  });

  AuthTracer.traceAuthAttempt(user.id, 'require_user', true, undefined, {
    url: request.url,
    method: request.method,
    role: user.role,
  });
};

// Session gate for hot read paths (polled REST routes, websocket upgrades). Unlike
// requireUser it writes no audit row, so polling cannot turn into a DB write per request.
export const requireActiveSession = async (
  request: AppFastifyRequest,
  reply: AppFastifyReply
): Promise<AppFastifyReply | undefined> => {
  const user = await request.getCurrentUser();

  if (!user) {
    return reply.code(401).send({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  if (!user.isActive) {
    return reply.code(403).send({
      error: 'Account is disabled',
      code: 'ACCOUNT_DISABLED',
    });
  }

  if (user.mustResetPassword) {
    return reply.code(428).send({
      error: 'Password setup required',
      code: 'PASSWORD_SETUP_REQUIRED',
      requiresPasswordSetup: true,
    });
  }

  if (!user.orgId) {
    return reply.code(403).send({
      error: 'Account is not part of an organization',
      code: 'NO_ORGANIZATION',
    });
  }

  request.orgId = user.orgId;
  return undefined;
};

// Proves the robot in the URL belongs to the caller's organization. The registries and bridges
// are keyed by robot id alone, so everything reaching them through a route must pass this first.
export const requireOwnedRobot =
  (param = 'id') =>
  async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    let robot = null;
    try {
      robot = await request.server.prisma.robot.findFirst({
        where: { id: request.params?.[param], orgId: request.orgId },
        select: { id: true },
      });
    } catch {
      // A malformed id cannot belong to anyone.
    }

    if (!robot) {
      return reply.code(404).send({
        success: false,
        error: 'Robot not found',
        code: 'ROBOT_NOT_FOUND',
      });
    }
    return undefined;
  };

export const requireAdmin = async (request: AppFastifyRequest, reply: AppFastifyReply) => {
  const user = await request.getCurrentUser();

  if (!user || user.role !== ROLE.ADMIN) {
    await request.audit?.({
      userId: user?.id || 'unknown',
      role: user?.role || 'unknown',
      action: 'UNAUTHORIZED_ATTEMPT',
      metadata: {
        url: request.url,
        method: request.method,
        requiredRole: ROLE.ADMIN,
        userRole: user?.role || 'none',
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });

    reply.code(403).send({
      error: 'Admin access required',
      code: 'INSUFFICIENT_PERMISSIONS',
    });

    return;
  }

  await request.audit?.({
    userId: user.id,
    role: user.role,
    action: 'ADMIN_ACCESS',
    metadata: {
      url: request.url,
      method: request.method,
    },
  });
};

export const hasPermission = async (
  request: AppFastifyRequest,
  permission: Permission
): Promise<boolean> => {
  const user = await request.getCurrentUser();

  if (!user) {
    await request.audit?.({
      userId: 'unknown',
      role: 'unknown',
      action: 'PERMISSION_CHECK',
      metadata: {
        permission,
        userRole: 'none',
        granted: false,
        reason: 'unauthenticated',
      },
    });
    return false;
  }

  const rolePermissions =
    (ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS] as readonly Permission[]) || [];
  const hasRequiredPermission = rolePermissions.includes(permission);

  await request.audit?.({
    userId: user.id,
    role: user.role,
    action: 'PERMISSION_CHECK',
    metadata: {
      permission,
      userRole: user.role,
      granted: hasRequiredPermission,
      rolePermissions,
    },
  });

  AuthTracer.tracePermissionCheck(user.id, user.role, permission, hasRequiredPermission, {
    rolePermissions,
    url: request.url,
    method: request.method,
  });

  return hasRequiredPermission;
};

export const requirePermission = (permission: Permission) => {
  return async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    const hasRequiredPermission = await hasPermission(request, permission);

    if (!hasRequiredPermission) {
      const user = await request.getCurrentUser();

      await request.audit?.({
        userId: user?.id || 'unknown',
        role: user?.role || 'unknown',
        action: 'PERMISSION_DENIED',
        metadata: {
          requiredPermission: permission,
          userRole: user?.role || 'none',
          url: request.url,
          method: request.method,
        },
      });

      reply.code(403).send({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredPermission: permission,
      });
    }
  };
};

export const logRole = async (request: AppFastifyRequest) => {
  const user = await request.getCurrentUser();

  await request.audit?.({
    userId: user?.id || 'unknown',
    role: user?.role || 'unknown',
    action: 'ROLE_ACCESS',
    metadata: {
      url: request.url,
      method: request.method,
      userRole: user?.role || 'none',
      rbacActive: true,
    },
  });
};

export const isAdmin = async (request: AppFastifyRequest): Promise<boolean> => {
  const user = await request.getCurrentUser();
  return user?.role === ROLE.ADMIN;
};

export const isAuthenticated = async (request: AppFastifyRequest): Promise<boolean> => {
  const user = await request.getCurrentUser();
  return !!user;
};

export const requirePasswordSetup = async (request: AppFastifyRequest, reply: AppFastifyReply) => {
  const user = await request.getCurrentUser();

  if (!user) {
    reply.code(401).send({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  if (!user.mustResetPassword) {
    reply.code(403).send({
      error: 'Password setup not required',
      code: 'PASSWORD_SETUP_NOT_REQUIRED',
    });
    return;
  }
};

export const requireCompletedPasswordSetup = async (
  request: AppFastifyRequest,
  reply: AppFastifyReply
) => {
  const user = await request.getCurrentUser();

  if (!user) {
    reply.code(401).send({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  if (user.mustResetPassword) {
    reply.code(428).send({
      error: 'Password setup required',
      code: 'PASSWORD_SETUP_REQUIRED',
      requiresPasswordSetup: true,
    });
    return;
  }
};
