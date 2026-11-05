import { PrismaClient } from '@prisma/client';
import { ensureDefaultOrg } from './defaultOrg.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding robots...');
  const org = await ensureDefaultOrg(prisma);

  const robots = [
    {
      name: 'Tensrai1',
      status: 'MISSION',
      x: 10,
      y: 10,
      theta: 0,
      battery: 100,
    },
    {
      name: 'Tensrai2',
      status: 'MISSION',
      x: 15,
      y: 15,
      theta: 1.57,
      battery: 95,
    },
  ];

  for (const robot of robots) {
    const existingRobot = await prisma.robot.findUnique({
      where: { orgId_name: { orgId: org.id, name: robot.name } },
    });

    if (existingRobot) {
      console.log(`Robot already exists: ${robot.name}`);
    } else {
      await prisma.robot.create({
        data: { ...robot, orgId: org.id },
      });
      console.log(`Created robot: ${robot.name}`);
    }
  }

  console.log('Seeding finished.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
