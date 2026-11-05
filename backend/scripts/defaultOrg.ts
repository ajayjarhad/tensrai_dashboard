import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

// The audit trail needs an actor id; this one marks the command line.
export const commandLineActorId = () => randomBytes(12).toString('hex');

// Holds everything that predates multi-tenancy, and the users and robots the seed scripts create.
export const ensureDefaultOrg = (prisma: PrismaClient) =>
  prisma.organization.upsert({
    where: { slug: 'default' },
    update: {},
    create: { slug: 'default', name: process.env['DEFAULT_ORG_NAME'] ?? 'Default' },
  });
