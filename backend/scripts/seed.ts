import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ensureDefaultOrg } from './defaultOrg.js';

const prisma = new PrismaClient();

type SeedConfig = {
  email: string;
  username: string;
  displayName: string;
  password: string;
  role: 'ADMIN' | 'USER';
};

const DEFAULT_PASSWORD = 'pass';

const seedConfig = (
  prefix: 'ADMIN' | 'USER',
  defaults: Omit<SeedConfig, 'password'>
): SeedConfig => ({
  email: process.env[`SEED_${prefix}_EMAIL`] ?? defaults.email,
  username: process.env[`SEED_${prefix}_USERNAME`] ?? defaults.username,
  displayName: process.env[`SEED_${prefix}_DISPLAY_NAME`] ?? defaults.displayName,
  password: process.env[`SEED_${prefix}_PASSWORD`] ?? DEFAULT_PASSWORD,
  role: defaults.role,
});

const seedUsers: SeedConfig[] = [
  seedConfig('ADMIN', {
    email: 'admin@tensrai.com',
    username: 'admin',
    displayName: 'Admin',
    role: 'ADMIN',
  }),
  seedConfig('USER', {
    email: 'operator@tensrai.com',
    username: 'operator',
    displayName: 'Operator',
    role: 'USER',
  }),
];

// Runs on every container start, so it must never touch an account that already exists:
// overwriting would silently reset a changed password back to the seed value.
async function createUserIfMissing(config: SeedConfig, orgId: string) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: config.email }, { username: config.username }] },
  });
  if (existing) return 'already exists, left unchanged';

  await prisma.user.create({
    data: {
      orgId,
      email: config.email,
      username: config.username,
      displayName: config.displayName,
      role: config.role,
      passwordHash: await bcrypt.hash(config.password, 12),
      mustResetPassword: false,
      isActive: true,
    },
  });
  return config.password === DEFAULT_PASSWORD
    ? `created with the default password; set SEED_${config.role === 'ADMIN' ? 'ADMIN' : 'USER'}_PASSWORD`
    : 'created';
}

async function main() {
  console.log('🌱 Seeding baseline users');
  const org = await ensureDefaultOrg(prisma);
  for (const user of seedUsers) {
    const outcome = await createUserIfMissing(user, org.id);
    console.log(` → ${user.role} ${user.email}: ${outcome}`);
  }
  console.log('✅ Seed complete');
}

main()
  .catch(error => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
