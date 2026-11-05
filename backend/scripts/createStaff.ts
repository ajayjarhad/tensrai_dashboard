import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createUserWithTempPassword, logAuditEvent } from '../src/services/user.service.js';
import { commandLineActorId, ensureDefaultOrg } from './defaultOrg.js';
import { askForPassword, DEFAULT_STAFF } from './defaultStaff.js';

const prisma = new PrismaClient();

const [username, email] = process.argv.slice(2);

// Replaces the password whenever it's run, which is also the way back in if it's lost or has expired.
const setDefaultStaff = async () => {
  const password = await askForPassword();
  const account = {
    role: 'STAFF' as const,
    isActive: true,
    passwordHash: await bcrypt.hash(password, 12),
    tempPasswordHash: null,
    tempPasswordExpiry: null,
    mustResetPassword: false,
  };

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: DEFAULT_STAFF.username }, { email: DEFAULT_STAFF.email }] },
  });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: account })
    : await prisma.user.create({
        data: { ...DEFAULT_STAFF, ...account, orgId: (await ensureDefaultOrg(prisma)).id },
      });
  await prisma.session.deleteMany({ where: { userId: user.id } });

  await logAuditEvent(prisma, {
    orgId: user.orgId,
    userId: commandLineActorId(),
    role: 'SYSTEM',
    action: existing ? 'STAFF_PASSWORD_REPLACED' : 'STAFF_CREATED',
    targetUserId: user.id,
    metadata: { targetUsername: user.username },
  });
  console.log(
    `${existing ? 'New password set' : 'Created staff user'}. Sign in as ${user.username}`
  );
};

// The only way to make a staff user: the API refuses to assign this role, by anyone.
async function main() {
  if (!username) {
    await setDefaultStaff();
    return;
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'STAFF' } });
    console.log(`${username} is now staff`);
    return;
  }
  if (!email) throw new Error(`No user named ${username}; pass an email to create one`);

  const org = await ensureDefaultOrg(prisma);
  const { tempPassword } = await createUserWithTempPassword(
    prisma,
    { username, email, role: 'STAFF' },
    commandLineActorId(),
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
