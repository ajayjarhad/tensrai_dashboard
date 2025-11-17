import { type Permission, ROLE, ROLE_PERMISSIONS } from '@tensrai/shared';
import type { AppFastifyReply, AppFastifyRequest } from '../types/app.js';
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
