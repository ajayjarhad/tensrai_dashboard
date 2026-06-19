import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient() as any;

async function main() {
  console.log('Backfilling RobotMap rows from Robot.mapId...');

  const robots = await prisma.robot.findMany({ where: { mapId: { not: null } } });
  let upserted = 0;

  for (const robot of robots) {
    await prisma.robotMap.upsert({
      where: { robotId_mapId: { robotId: robot.id, mapId: robot.mapId } },
      // Idempotent: only seed the active row on first creation; never clobber an
      // existing assignment's isActive/isPinned if the feature is already live.
      update: {},
      create: { robotId: robot.id, mapId: robot.mapId, isActive: true, isPinned: false },
    });
    upserted += 1;
  }

  console.log(`Backfill complete. Ensured ${upserted} RobotMap row(s) from legacy mapId.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
