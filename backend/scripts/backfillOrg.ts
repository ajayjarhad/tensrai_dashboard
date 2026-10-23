import { PrismaClient } from '@prisma/client';
import { ensureDefaultOrg } from './defaultOrg.js';

const prisma = new PrismaClient();

const TENANT_COLLECTIONS = ['User', 'Robot', 'Map', 'MissionRun'];

// Raw writes: documents without an orgId cannot be read through the typed client at all.
async function main() {
  const org = await ensureDefaultOrg(prisma);
  console.log(`Assigning rows without an organization to "${org.name}" (${org.id})`);

  for (const collection of TENANT_COLLECTIONS) {
    const result = (await prisma.$runCommandRaw({
      update: collection,
      updates: [
        { q: { orgId: { $exists: false } }, u: { $set: { orgId: { $oid: org.id } } }, multi: true },
      ],
    })) as { nModified?: number };
    console.log(` → ${collection}: ${result.nModified ?? 0} updated`);
  }
}

main()
  .catch(error => {
    console.error('Organization backfill failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
