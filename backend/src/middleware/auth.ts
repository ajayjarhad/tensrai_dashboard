import { trace } from '@opentelemetry/api';
import { ROLE } from '@tensrai/shared';
import type { AppFastifyReply, AppFastifyRequest, AppSession } from '../types/app.js';

// Staff act in the organization they entered; everyone else acts in their own.
export const actingOrgId = (session: AppSession): string | null => {
  const user = session.user;
  if (!user) return null;
  return user.role === ROLE.STAFF
    ? (session.session?.activeOrgId ?? user.orgId)
    : (user.orgId ?? null);
};

// Session gate for hot read paths (polled REST routes, websocket upgrades). It writes no audit
// row, so polling cannot turn into a DB write per request.
export const requireActiveSession = async (
  request: AppFastifyRequest,
  reply: AppFastifyReply
): Promise<AppFastifyReply | undefined> => {
  const session = await request.getUserSession();
  const user = session?.user;

  if (!session || !user) {
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

  const orgId = actingOrgId(session);
  if (!orgId) {
    return reply.code(403).send({
      error: 'Account is not part of an organization',
      code: 'NO_ORGANIZATION',
    });
  }

  request.orgId = orgId;
  trace.getActiveSpan()?.setAttribute('org.id', orgId);
  // A websocket upgrade cannot set a cookie, and an open dashboard keeps polling REST anyway.
  if (!request.ws) await request.renewSessionIfStale(reply);
  return undefined;
};

export const requireStaff = async (
  request: AppFastifyRequest,
  reply: AppFastifyReply
): Promise<AppFastifyReply | undefined> => {
  const rejected = await requireActiveSession(request, reply);
  if (rejected) return rejected;

  const user = await request.getCurrentUser();
  if (user?.role !== ROLE.STAFF) {
    return reply.code(403).send({
      error: 'Staff access required',
      code: 'INSUFFICIENT_PERMISSIONS',
    });
  }
  return undefined;
};

// Proves the robot in the URL belongs to the caller's organization. The registries and bridges
// are keyed by robot id alone, so everything reaching them through a route must pass this first.
export const requireOwnedRobot =
  (param = 'id') =>
  async (request: AppFastifyRequest, reply: AppFastifyReply) => {
    const robotId = (request.params as Record<string, string> | undefined)?.[param];
    let robot = null;
    try {
      robot = await request.server.prisma.robot.findFirst({
        // requireActiveSession runs first, so orgId is set; a null would fail the query and deny.
        where: { id: robotId as string, orgId: request.orgId as string },
        select: { id: true },
      });
    } catch {
      // A malformed id cannot belong to anyone.
    }

    if (!robot) {
      request.server.log.warn(
        { robotId, orgId: request.orgId, url: request.url },
        'Denied access to a robot outside the organization'
      );
      return reply.code(404).send({
        success: false,
        error: 'Robot not found',
        code: 'ROBOT_NOT_FOUND',
      });
    }
    return undefined;
  };

// The same decision as requireActiveSession + requireOwnedRobot, made again for a socket that is
// already open: a disabled user, a revoked session or a moved robot must not keep its access.
export const stillHasRobotAccess = async (
  request: AppFastifyRequest,
  robotId: string
): Promise<boolean> => {
  const session = await request.readFreshSession();
  const user = session?.user;
  if (!session || !user?.isActive || user.mustResetPassword) return false;

  const orgId = actingOrgId(session);
  if (!orgId) return false;

  const robot = await request.server.prisma.robot.findFirst({
    where: { id: robotId, orgId },
    select: { id: true },
  });
  return Boolean(robot);
};

export const requireAdmin = async (request: AppFastifyRequest, reply: AppFastifyReply) => {
  const user = await request.getCurrentUser();

  if (!user || (user.role !== ROLE.ADMIN && user.role !== ROLE.STAFF)) {
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
    orgId: request.orgId,
    userId: user.id,
    role: user.role,
    action: 'ADMIN_ACCESS',
    metadata: {
      url: request.url,
      method: request.method,
    },
  });
};
