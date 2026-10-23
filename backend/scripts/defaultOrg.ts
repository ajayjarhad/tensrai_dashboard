import type { PrismaClient } from '@prisma/client';

// Holds everything that predates multi-tenancy, and the users and robots the seed scripts create.
export const ensureDefaultOrg = (prisma: PrismaClient) =>
  prisma.organization.upsert({
    where: { slug: 'default' },
    update: {},
    create: { slug: 'default', name: process.env['DEFAULT_ORG_NAME'] ?? 'Default' },
  });
