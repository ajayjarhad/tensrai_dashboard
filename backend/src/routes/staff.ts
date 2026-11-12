import type { RobotAddressStatus } from '@prisma/client';
import { z } from 'zod';
import { requireStaff } from '../middleware/auth.js';
import { appErrorHandler } from '../plugins/errorHandler.js';
import { addOrgAdmin, createOrgWithAdmin, moveRobotToOrg } from '../services/org.service.js';
import {
  heldByAnotherOrg,
  parseRobotAddress,
  reloadRobotConnections,
} from '../services/robotAddress.js';
import { ServiceError } from '../services/user.service.js';
import type {
  AppFastifyInstance,
  AppFastifyRequest,
  AppSession,
  IdParams,
  SessionUser,
} from '../types/app.js';

const AdminLoginSchema = z.object({
  username: z.string().trim().min(3).max(50),
  email: z.string().trim().email(),
});

const CreateOrgSchema = AdminLoginSchema.extend({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers and dashes'),
});

const ApproveAheadSchema = z.object({ ip: z.string().min(1) });
const MoveRobotSchema = z.object({ orgId: z.string().min(1) });

const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ServiceError(400, result.error.issues[0]?.message ?? 'Invalid request');
  }
  return result.data;
};

// Deliberately unscoped: this is the one place that works across organizations, which is why
// nothing here is reachable without the STAFF role and every change is audited.
const staffRoutes = async (server: AppFastifyInstance) => {
  server.addHook('onRequest', requireStaff);

  server.setErrorHandler((error: Parameters<typeof appErrorHandler>[0], request, reply) => {
    if (error instanceof ServiceError) {
      return reply.status(error.status).send({ success: false, error: error.message });
    }
    if (error.code === 'P2023') {
      return reply.status(404).send({ success: false, error: 'Not found' });
    }
    if (error.code === 'P2002') {
      return reply.status(409).send({ success: false, error: 'That name is already in use' });
    }
    return appErrorHandler(error, request, reply);
  });

  const prisma = () => server.prisma;

  // requireStaff has already established the user and session for every route here.
  const actorOf = async (request: AppFastifyRequest) => {
    const user = (await request.getCurrentUser()) as SessionUser;
    return { id: user.id, role: user.role };
  };

  const sessionOf = async (request: AppFastifyRequest) =>
    (await request.getUserSession()) as AppSession;

  const audit = async (
    request: AppFastifyRequest,
    action: string,
    orgId: string,
    metadata: Record<string, unknown>
  ) => {
    const actor = await actorOf(request);
    await server.audit?.({ orgId, userId: actor.id, role: actor.role, action, metadata });
  };

  const addressOr404 = async (id: string) => {
    const address = await prisma().robotAddress.findUnique({ where: { id } });
    if (!address) throw new ServiceError(404, 'Address not found');
    return address;
  };

  const assertNotHeldElsewhere = async (ip: string, orgId: string) => {
    const holder = await heldByAnotherOrg(prisma(), ip, orgId);
    if (!holder) return;
    const org = await prisma().organization.findUnique({
      where: { id: holder.orgId },
      select: { name: true },
    });
    throw new ServiceError(
      409,
      `This address already belongs to ${org?.name ?? 'another organization'}`
    );
  };

  const countByOrg = (rows: Array<{ orgId: string; _count: { _all: number } }>) =>
    new Map(rows.map(row => [row.orgId, row._count._all]));

  server.get('/staff/orgs', async () => {
    const [orgs, users, robots, pending] = await Promise.all([
      prisma().organization.findMany({ orderBy: { name: 'asc' } }),
      prisma().user.groupBy({ by: ['orgId'], _count: { _all: true } }),
      prisma().robot.groupBy({ by: ['orgId'], _count: { _all: true } }),
      prisma().robotAddress.groupBy({
        by: ['orgId'],
        where: { status: 'PENDING' },
        _count: { _all: true },
      }),
    ]);
    const userCounts = countByOrg(users);
    const robotCounts = countByOrg(robots);
    const pendingCounts = countByOrg(pending);

    return {
      success: true,
      data: orgs.map(org => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
        users: userCounts.get(org.id) ?? 0,
        robots: robotCounts.get(org.id) ?? 0,
        pendingAddresses: pendingCounts.get(org.id) ?? 0,
      })),
    };
  });

  server.post('/staff/orgs', async (request, reply) => {
    const input = parseBody(CreateOrgSchema, request.body);
    const result = await createOrgWithAdmin(prisma(), input, await actorOf(request));
    await audit(request, 'ORG_CREATED', result.org.id, { name: input.name, slug: input.slug });
    return reply.status(201).send({ success: true, data: result });
  });

  server.post<IdParams>('/staff/orgs/:id/admins', async (request, reply) => {
    const { id } = request.params;
    const login = parseBody(AdminLoginSchema, request.body);
    const result = await addOrgAdmin(prisma(), id, login, await actorOf(request));
    await audit(request, 'ORG_ADMIN_ADDED', id, { username: login.username });
    return reply.status(201).send({ success: true, data: result });
  });

  // The acting organization lives on the session, so REST and sockets both follow it.
  server.post<IdParams>('/staff/orgs/:id/enter', async request => {
    const { id } = request.params;
    const org = await prisma().organization.findUnique({ where: { id }, select: { id: true } });
    if (!org) throw new ServiceError(404, 'Organization not found');

    const session = await sessionOf(request);
    await prisma().session.updateMany({
      where: { id: session.session.id },
      data: { activeOrgId: id },
    });
    await audit(request, 'STAFF_ENTERED_ORG', id, {});
    return { success: true };
  });

  server.post('/staff/exit', async request => {
    const session = await sessionOf(request);
    await prisma().session.updateMany({
      where: { id: session.session.id },
      data: { activeOrgId: null },
    });
    return { success: true };
  });

  server.get<{ Querystring: { status?: RobotAddressStatus } }>(
    '/staff/addresses',
    async request => {
      const { status } = request.query;
      const addresses = await prisma().robotAddress.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
      });
      const ips = addresses.map(address => address.ip);

      const [orgs, robots, sameIp, requesters] = await Promise.all([
        prisma().organization.findMany({ select: { id: true, name: true } }),
        prisma().robot.findMany({
          where: { ipAddress: { in: ips } },
          select: { orgId: true, ipAddress: true, name: true },
        }),
        prisma().robotAddress.findMany({
          where: { ip: { in: ips } },
          select: { orgId: true, ip: true, status: true },
        }),
        prisma().user.findMany({
          where: {
            id: {
              in: addresses.map(a => a.requestedById).filter((id): id is string => Boolean(id)),
            },
          },
          select: { id: true, username: true },
        }),
      ]);
      const orgNames = new Map(orgs.map(org => [org.id, org.name]));
      const usernames = new Map(requesters.map(user => [user.id, user.username]));

      return {
        success: true,
        data: addresses.map(address => ({
          id: address.id,
          ip: address.ip,
          status: address.status,
          createdAt: address.createdAt,
          orgId: address.orgId,
          orgName: orgNames.get(address.orgId) ?? null,
          requestedBy: usernames.get(address.requestedById as string) ?? null,
          robots: robots
            .filter(r => r.orgId === address.orgId && r.ipAddress === address.ip)
            .map(r => r.name),
          otherOrgs: sameIp
            .filter(other => other.ip === address.ip && other.orgId !== address.orgId)
            .map(other => ({
              name: orgNames.get(other.orgId) ?? null,
              status: other.status,
            })),
        })),
      };
    }
  );

  const decide = async (
    request: AppFastifyRequest,
    id: string,
    status: Exclude<RobotAddressStatus, 'PENDING'>
  ) => {
    const address = await addressOr404(id);
    if (status === 'APPROVED') await assertNotHeldElsewhere(address.ip, address.orgId);

    const actor = await actorOf(request);
    const updated = await prisma().robotAddress.update({
      where: { id: address.id },
      data: { status, decidedById: actor.id, decidedAt: new Date() },
    });
    reloadRobotConnections(server);
    await audit(request, `ROBOT_ADDRESS_${status}`, address.orgId, { ip: address.ip });
    return { success: true, data: updated };
  };

  server.post<IdParams>('/staff/addresses/:id/approve', request =>
    decide(request, request.params.id, 'APPROVED')
  );
  server.post<IdParams>('/staff/addresses/:id/reject', request =>
    decide(request, request.params.id, 'REJECTED')
  );

  // Robots in the organization lose the address too. Otherwise the startup backfill, which approves
  // any robot address with no record, would hand it straight back on the next restart.
  server.delete<IdParams>('/staff/addresses/:id', async request => {
    const address = await addressOr404(request.params.id);
    await prisma().$transaction([
      prisma().robotAddress.delete({ where: { id: address.id } }),
      prisma().robot.updateMany({
        where: { orgId: address.orgId, ipAddress: address.ip },
        data: { ipAddress: null },
      }),
    ]);
    reloadRobotConnections(server);
    await audit(request, 'ROBOT_ADDRESS_RELEASED', address.orgId, { ip: address.ip });
    return { success: true };
  });

  server.post<IdParams>('/staff/orgs/:id/addresses', async (request, reply) => {
    const { id } = request.params;
    const org = await prisma().organization.findUnique({ where: { id }, select: { id: true } });
    if (!org) throw new ServiceError(404, 'Organization not found');

    const parsed = parseRobotAddress(parseBody(ApproveAheadSchema, request.body).ip);
    if ('error' in parsed) throw new ServiceError(400, parsed.error);
    await assertNotHeldElsewhere(parsed.ip, id);

    const actor = await actorOf(request);
    const decision = {
      status: 'APPROVED' as const,
      decidedById: actor.id,
      decidedAt: new Date(),
    };
    const address = await prisma().robotAddress.upsert({
      where: { orgId_ip: { orgId: id, ip: parsed.ip } },
      update: decision,
      create: { orgId: id, ip: parsed.ip, requestedById: actor.id, ...decision },
    });
    reloadRobotConnections(server);
    await audit(request, 'ROBOT_ADDRESS_APPROVED', id, { ip: parsed.ip, ahead: true });
    return reply.status(201).send({ success: true, data: address });
  });

  server.post<IdParams>('/staff/robots/:id/move', async request => {
    const { id } = request.params;
    const { orgId } = parseBody(MoveRobotSchema, request.body);
    await moveRobotToOrg(prisma(), id, orgId);
    reloadRobotConnections(server);
    await audit(request, 'ROBOT_MOVED', orgId, { robotId: id });
    return { success: true };
  });
};

export default staffRoutes;
