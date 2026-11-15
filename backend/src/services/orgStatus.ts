import type { PrismaClient } from '@prisma/client';

type OrgReader = Pick<PrismaClient, 'organization'>;

export const isOrgDeactivated = async (prisma: OrgReader, orgId: string | null | undefined) => {
  if (!orgId) return false;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { deactivatedAt: true },
  });
  return Boolean(org?.deactivatedAt);
};

// Staff keep access while an organization is switched off, so they can still support it.
export const isLockedOut = (prisma: OrgReader, user: { role: string; orgId?: string | null }) =>
  user.role === 'STAFF' ? Promise.resolve(false) : isOrgDeactivated(prisma, user.orgId);

// A few organizations at most, so reading them all beats a query on a field older documents lack.
export const deactivatedOrgIds = async (prisma: OrgReader) => {
  const orgs = await prisma.organization.findMany({ select: { id: true, deactivatedAt: true } });
  return new Set(orgs.filter(org => org.deactivatedAt).map(org => org.id));
};
