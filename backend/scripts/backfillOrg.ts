import { PrismaClient } from '@prisma/client';
import { ensureDefaultOrg } from './defaultOrg.js';

const prisma = new PrismaClient();

const TENANT_COLLECTIONS = ['User', 'Robot', 'Map', 'RobotMap', 'MissionRun'];

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

  await approveExistingRobotAddresses();
}

// Robots from before address ownership keep connecting. A robot added since then always has a
// record by the time it is saved, so nothing waiting for approval is approved here.
async function approveExistingRobotAddresses() {
  const robots = await prisma.robot.findMany({
    where: { ipAddress: { not: null } },
    select: { orgId: true, ipAddress: true },
  });

  let approved = 0;
  for (const { orgId, ipAddress: ip } of robots) {
    if (!ip) continue;
    const recorded = await prisma.robotAddress.findUnique({ where: { orgId_ip: { orgId, ip } } });
    if (recorded) continue;

    const heldElsewhere = await prisma.robotAddress.findFirst({
      where: { ip, status: 'APPROVED', orgId: { not: orgId } },
      select: { id: true },
    });
    await prisma.robotAddress.create({
      data: { orgId, ip, status: heldElsewhere ? 'PENDING' : 'APPROVED' },
    });
    if (!heldElsewhere) approved += 1;
  }
  console.log(` → RobotAddress: ${approved} approved`);
}

main()
  .catch(error => {
    console.error('Organization backfill failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
