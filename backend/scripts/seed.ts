import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

type SeedConfig = {
  email: string;
  username: string;
  displayName: string;
  password: string;
  role: 'ADMIN' | 'USER';
};

const env = (key: string, fallback: string) => process.env[key] ?? fallback;

const seedUsers: SeedConfig[] = [
  {
    email: env('SEED_ADMIN_EMAIL', 'admin@tensrai.com'),
    username: env('SEED_ADMIN_USERNAME', 'admin'),
    displayName: env('SEED_ADMIN_DISPLAY_NAME', 'Admin'),
    password: env('SEED_ADMIN_PASSWORD', 'pass'),
    role: 'ADMIN',
  },
  {
    email: env('SEED_USER_EMAIL', 'operator@tensrai.com'),
    username: env('SEED_USER_USERNAME', 'operator'),
    displayName: env('SEED_USER_DISPLAY_NAME', 'Operator'),
    password: env('SEED_USER_PASSWORD', 'pass'),
    role: 'USER',
  },
];

async function upsertUser(config: SeedConfig) {
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
  for (const user of seedUsers) {
    const action = await upsertUser(user);
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
