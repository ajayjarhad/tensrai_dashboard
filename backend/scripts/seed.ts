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

const seedUsers: SeedConfig[] = [
  {
    email: 'admin@tensrai.com',
    username: 'admin',
    displayName: 'Admin',
    password: 'pass',
    role: 'ADMIN',
  },
  {
    email: 'operator@tensrai.com',
    username: 'operator',
    displayName: 'Operator',
    password: 'pass',
    role: 'USER',
  },
];

async function upsertUser(config: SeedConfig, orgId: string) {
  const passwordHash = await bcrypt.hash(config.password, 12);
  const existing = await prisma.user.findUnique({ where: { email: config.email } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        username: config.username,
        displayName: config.displayName,
        role: config.role,
        passwordHash,
        mustResetPassword: false,
        isActive: true,
        tempPasswordHash: null,
        tempPasswordExpiry: null,
      },
    });
    return 'updated';
  }

  await prisma.user.create({
    data: {
      orgId,
      email: config.email,
      username: config.username,
      displayName: config.displayName,
      role: config.role,
      passwordHash,
      mustResetPassword: false,
      isActive: true,
    },
  });
  return 'created';
}

async function main() {
  console.log('🌱 Seeding baseline users');
  const org = await ensureDefaultOrg(prisma);
  for (const user of seedUsers) {
    const action = await upsertUser(user, org.id);
    console.log(` → ${user.role} user ${action} (${user.email})`);
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
