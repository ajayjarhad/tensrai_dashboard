import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createUserWithTempPassword } from '../src/services/user.service.js';
import { ensureDefaultOrg } from './defaultOrg.js';

const prisma = new PrismaClient();

const [username, email] = process.argv.slice(2);

// The only way to make a staff user: the API refuses to assign this role, by anyone.
async function main() {
  if (!username) {
    throw new Error('Usage: staff:create <username> [email]   (email is required for a new user)');
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'STAFF' } });
    console.log(`${username} is now staff`);
    return;
  }
  if (!email) throw new Error(`No user named ${username}; pass an email to create one`);

  const org = await ensureDefaultOrg(prisma);
  // The audit trail needs an actor id; this one marks the command line.
  const actorId = randomBytes(12).toString('hex');
  const { tempPassword } = await createUserWithTempPassword(
    prisma,
    { username, email, role: 'STAFF' },
    actorId,
    'SYSTEM',
    org.id
  );
  console.log(`Created staff user ${username}. Temporary password (72h): ${tempPassword}`);
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
