import type { PrismaClient } from '@prisma/client';
import { createUserWithTempPassword, ServiceError } from './user.service.js';

type Actor = { id: string; role: string };
type AdminLogin = { username: string; email: string };

const assertLoginAvailable = async (prisma: PrismaClient, { username, email }: AdminLogin) => {
  const taken = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true },
  });
  if (taken) throw new ServiceError(409, 'A user with this username or email already exists');
};

const createAdmin = (prisma: PrismaClient, orgId: string, login: AdminLogin, actor: Actor) =>
  createUserWithTempPassword(prisma, { ...login, role: 'ADMIN' }, actor.id, actor.role, orgId);

// Everything that could fail is checked before the organization exists, so a taken username can't
// leave behind an organization with no admin and no way to retry under the same name.
export const createOrgWithAdmin = async (
  prisma: PrismaClient,
  input: { name: string; slug: string } & AdminLogin,
  actor: Actor
) => {
  const { name, slug, username, email } = input;
  await assertLoginAvailable(prisma, { username, email });

  const existing = await prisma.organization.findFirst({
    where: { OR: [{ name }, { slug }] },
    select: { id: true },
  });
  if (existing)
    throw new ServiceError(409, 'An organization with this name or slug already exists');

  const org = await prisma.organization.create({ data: { name, slug } });
  const admin = await createAdmin(prisma, org.id, { username, email }, actor);
  return { org, ...admin };
};

export const addOrgAdmin = async (
  prisma: PrismaClient,
  orgId: string,
  login: AdminLogin,
  actor: Actor
) => {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new ServiceError(404, 'Organization not found');

  await assertLoginAvailable(prisma, login);
  return createAdmin(prisma, orgId, login, actor);
};

// Moves a robot with everything that belongs to it. Refuses rather than splitting anything shared:
// a map used by another robot, or an address another robot of this organization still connects to.
export const moveRobotToOrg = async (prisma: PrismaClient, robotId: string, toOrgId: string) => {
  const robot = await prisma.robot.findUnique({ where: { id: robotId } });
  if (!robot) throw new ServiceError(404, 'Robot not found');

  const target = await prisma.organization.findUnique({
    where: { id: toOrgId },
    select: { id: true },
  });
  if (!target) throw new ServiceError(404, 'Organization not found');
  if (robot.orgId === toOrgId) throw new ServiceError(409, 'Robot is already in this organization');

  const nameTaken = await prisma.robot.findFirst({
    where: { orgId: toOrgId, name: robot.name },
    select: { id: true },
  });
  if (nameTaken)
    throw new ServiceError(409, 'That organization already has a robot with this name');

  const links = await prisma.robotMap.findMany({
    where: { robotId },
    select: { mapId: true, map: { select: { filename: true, contentHash: true } } },
  });
  const mapIds = links.map(link => link.mapId);
  const sharedMap = await prisma.robotMap.findFirst({
    where: { mapId: { in: mapIds }, robotId: { not: robotId } },
    select: { id: true },
  });
  if (sharedMap) throw new ServiceError(409, 'A map on this robot is shared with another robot');

  const sameMap = await prisma.map.findFirst({
    where: { orgId: toOrgId, OR: links.map(({ map }) => map) },
    select: { id: true },
  });
  if (sameMap) throw new ServiceError(409, 'That organization already has a map on this robot');

  const ip = robot.ipAddress;
  if (ip) {
    const sharedAddress = await prisma.robot.findFirst({
      where: { orgId: robot.orgId, ipAddress: ip, id: { not: robotId } },
      select: { id: true },
    });
    if (sharedAddress) {
      throw new ServiceError(409, 'Another robot in this organization uses the same address');
    }
  }

  const address = ip
    ? await prisma.robotAddress.findUnique({ where: { orgId_ip: { orgId: robot.orgId, ip } } })
    : null;

  const moveToOrg = { data: { orgId: toOrgId } };
  await prisma.$transaction([
    prisma.robot.update({ where: { id: robotId }, ...moveToOrg }),
    prisma.robotMap.updateMany({ where: { robotId }, ...moveToOrg }),
    prisma.map.updateMany({ where: { id: { in: mapIds } }, ...moveToOrg }),
    prisma.missionRun.updateMany({ where: { robotId }, ...moveToOrg }),
    ...(address
      ? [
          prisma.robotAddress.deleteMany({ where: { orgId: toOrgId, ip: address.ip } }),
          prisma.robotAddress.update({ where: { id: address.id }, ...moveToOrg }),
        ]
      : []),
  ]);
};
