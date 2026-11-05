import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createOrgWithAdmin } from '../src/services/org.service.js';

const prisma = new PrismaClient();

const [name, slug, username, email] = process.argv.slice(2);

async function main() {
  if (!name || !slug || !username || !email) {
    throw new Error('Usage: org:create <name> <slug> <adminUsername> <adminEmail>');
  }

  // The audit trail needs an actor id; this one marks the command line.
  const actor = { id: randomBytes(12).toString('hex'), role: 'SYSTEM' };
  const { org, user, tempPassword } = await createOrgWithAdmin(
    prisma,
    { name, slug, username, email },
    actor
  );
  console.log(`Created organization "${org.name}" (${org.id})`);
  console.log(`Created admin ${user.username}. Temporary password (72h): ${tempPassword}`);
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
