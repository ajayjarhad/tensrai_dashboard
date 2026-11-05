import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logAuditEvent, TEMP_PASSWORD_TTL_MS } from '../src/services/user.service.js';
import { commandLineActorId, ensureDefaultOrg } from './defaultOrg.js';
import { DEFAULT_STAFF, DEFAULT_STAFF_HASH_FILE } from './defaultStaff.js';

const prisma = new PrismaClient();

type SeedConfig = {
  email: string;
  username: string;
  displayName: string;
  password: string;
  role: 'ADMIN' | 'USER';
};

// Optional demo accounts. No password configured means no account: a built-in one would be the same
// known login on every deployment. The account everyone needs comes from `staff:create`.
const seedConfig = (
  prefix: 'ADMIN' | 'USER',
  defaults: Omit<SeedConfig, 'password'>
): SeedConfig | null => {
  const password = process.env[`SEED_${prefix}_PASSWORD`];
  if (!password) return null;
  return {
    email: process.env[`SEED_${prefix}_EMAIL`] ?? defaults.email,
    username: process.env[`SEED_${prefix}_USERNAME`] ?? defaults.username,
    displayName: process.env[`SEED_${prefix}_DISPLAY_NAME`] ?? defaults.displayName,
    password,
    role: defaults.role,
  };
};

const seedUsers = [
  seedConfig('ADMIN', {
    email: 'demo-admin@tensrai.com',
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
].filter((config): config is SeedConfig => config !== null);

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
  return 'created';
}

const readCommittedHash = () => {
  if (!existsSync(DEFAULT_STAFF_HASH_FILE)) return null;
  const hash = readFileSync(DEFAULT_STAFF_HASH_FILE, 'utf8').trim();
  if (!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(hash)) {
    throw new Error(`${DEFAULT_STAFF_HASH_FILE} is not a bcrypt hash`);
  }
  return hash;
};

// Everyone who can read the repo has this hash, so it only ever opens a deployment with no staff at
// all: temporary, expiring, and replaced at the first sign-in.
async function createDefaultStaffIfNoStaff(orgId: string) {
  const tempPasswordHash = readCommittedHash();
  if (!tempPasswordHash) return;

  const { username, email } = DEFAULT_STAFF;
  const existing = await prisma.user.findFirst({
    where: { OR: [{ role: 'STAFF' }, { username }, { email }] },
  });
  if (existing) return;

  const tempPasswordExpiry = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
  const user = await prisma.user.create({
    data: {
      ...DEFAULT_STAFF,
      orgId,
      passwordHash: '',
      tempPasswordHash,
      tempPasswordExpiry,
      mustResetPassword: true,
      isActive: true,
    },
  });
  await logAuditEvent(prisma, {
    orgId,
    userId: commandLineActorId(),
    role: 'SYSTEM',
    action: 'TEMP_PASSWORD_CREATED',
    targetUserId: user.id,
    metadata: { targetUsername: username, tempPasswordExpiry: tempPasswordExpiry.toISOString() },
  });
  console.log(` → STAFF ${email}: created. Sign in now, its first password expires in 72 hours`);
}

async function main() {
  console.log('🌱 Seeding baseline users');
  const org = await ensureDefaultOrg(prisma);
  for (const user of seedUsers) {
    const outcome = await createUserIfMissing(user, org.id);
    console.log(` → ${user.role} ${user.email}: ${outcome}`);
  }
  await createDefaultStaffIfNoStaff(org.id);
  if ((await prisma.user.count({ where: { role: 'STAFF' } })) === 0) {
    console.log(
      ' → No staff account yet. Run staff:create (see "Default staff account" in the README)'
    );
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
