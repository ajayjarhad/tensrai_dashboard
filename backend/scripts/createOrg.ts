import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createUserWithTempPassword } from '../src/services/user.service.js';

const prisma = new PrismaClient();

const [name, slug, adminUsername, adminEmail] = process.argv.slice(2);

async function main() {
  if (!name || !slug) {
    throw new Error('Usage: org:create <name> <slug> [adminUsername adminEmail]');
  }

  const org = await prisma.organization.create({ data: { name, slug } });
  console.log(`Created organization "${org.name}" (${org.id})`);

  if (adminUsername && adminEmail) {
    // The audit trail needs an actor id; this one marks the command line.
    const actorId = randomBytes(12).toString('hex');
    const { user, tempPassword } = await createUserWithTempPassword(
      prisma,
      { username: adminUsername, email: adminEmail, role: 'ADMIN' },
      actorId,
      'SYSTEM',
      org.id
    );
    console.log(`Created admin ${user.username}. Temporary password (72h): ${tempPassword}`);
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
