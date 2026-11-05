import { BlockList, isIP } from 'node:net';
import type { PrismaClient } from '@prisma/client';

// Robot bridges have no auth, so whatever the backend connects to obeys it. An organization may
// point a robot at any address, but the backend only connects once that address is APPROVED for
// that organization. Every path that opens a robot connection goes through this file.

// Loopback, link-local (including cloud metadata), Docker's bridge range, multicast.
const DEFAULT_BLOCKED_SUBNETS = [
  '0.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '224.0.0.0/4',
  '::/128',
  '::1/128',
  'fe80::/10',
];

const blockedSubnets = () => {
  const configured = process.env['ROBOT_BLOCKED_SUBNETS'];
  const subnets =
    configured === undefined
      ? DEFAULT_BLOCKED_SUBNETS
      : configured
          .split(',')
          .map(subnet => subnet.trim())
          .filter(Boolean);

  const list = new BlockList();
  for (const subnet of subnets) {
    const [network = '', prefix = ''] = subnet.split('/');
    list.addSubnet(network, Number(prefix), network.includes(':') ? 'ipv6' : 'ipv4');
  }
  return list;
};

// One spelling per host, so an address can't be requested twice under different text.
const normalizeIp = (raw: string): string | null => {
  const text = raw.trim();
  const version = isIP(text);
  if (version === 4) return text;
  if (version !== 6) return null;

  let host: string;
  try {
    host = new URL(`http://[${text}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }

  const mappedV4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!mappedV4) return host;
  const high = Number.parseInt(mappedV4[1] ?? '0', 16);
  const low = Number.parseInt(mappedV4[2] ?? '0', 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
};

export const parseRobotAddress = (raw: string): { ip: string } | { error: string } => {
  const ip = normalizeIp(raw);
  if (!ip) return { error: 'Enter the robot address as an IP address' };

  const family = isIP(ip) === 4 ? 'ipv4' : 'ipv6';
  if (blockedSubnets().check(ip, family))
    return { error: 'This address cannot be used for a robot' };
  return { ip };
};

export const heldByAnotherOrg = (prisma: PrismaClient, ip: string, orgId: string) =>
  prisma.robotAddress.findFirst({
    where: { ip, status: 'APPROVED', orgId: { not: orgId } },
    select: { id: true, orgId: true },
  });

// The caller gets the same result whether or not another organization holds this address, so it
// can't be used to find out which addresses are in use. Staff are trusted to skip the queue.
export const requestRobotAddress = async (
  prisma: PrismaClient,
  request: { orgId: string; ip: string; requestedById: string; isStaff: boolean }
) => {
  const { orgId, ip, requestedById, isStaff } = request;
  const address = await prisma.robotAddress.upsert({
    where: { orgId_ip: { orgId, ip } },
    update: {},
    create: { orgId, ip, requestedById },
  });

  if (!isStaff || address.status === 'APPROVED') return address.status;
  if (await heldByAnotherOrg(prisma, ip, orgId)) return address.status;

  const approved = await prisma.robotAddress.update({
    where: { id: address.id },
    data: { status: 'APPROVED', decidedById: requestedById, decidedAt: new Date() },
  });
  return approved.status;
};

type RobotTarget = { orgId: string; ipAddress?: string | null };

// Robots keep their configured address everywhere except on the way to a connection: a blank one
// is what the registries already treat as "not configured".
export const withApprovedAddress = async <T extends RobotTarget>(
  prisma: PrismaClient,
  robots: T[]
): Promise<T[]> => {
  const approved = await prisma.robotAddress.findMany({
    where: { status: 'APPROVED' },
    select: { orgId: true, ip: true },
  });
  const owned = new Set(approved.map(address => `${address.orgId}|${address.ip}`));
  return robots.map(robot =>
    robot.ipAddress && owned.has(`${robot.orgId}|${robot.ipAddress}`)
      ? robot
      : { ...robot, ipAddress: null }
  );
};

export const isAddressApproved = async (prisma: PrismaClient, robot: Partial<RobotTarget>) => {
  if (!robot.ipAddress || !robot.orgId) return false;
  const address = await prisma.robotAddress.findFirst({
    where: { orgId: robot.orgId, ip: robot.ipAddress, status: 'APPROVED' },
    select: { id: true },
  });
  return Boolean(address);
};

export const reloadRobotConnections = (server: any) => {
  server.rosRegistry?.reloadFromDb?.().catch(() => {});
  server.emergencyRegistry?.reloadFromDb?.().catch(() => {});
  server.missionRegistry?.reloadFromDb?.().catch(() => {});
};

export const maxRobotsPerOrg = () => {
  const configured = Number(process.env['MAX_ROBOTS_PER_ORG']);
  return Number.isFinite(configured) && configured > 0 ? configured : 50;
};
