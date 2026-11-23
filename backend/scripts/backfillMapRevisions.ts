import { PrismaClient } from '@prisma/client';
import { backfillMapRevisions } from '../src/services/mapRevisionBackfill.js';

const prisma = new PrismaClient();

backfillMapRevisions(prisma)
  .then(({ maps, links }) =>
    console.log(`Map revisions: ${maps} maps and ${links} robot links filled`)
  )
  .catch(error => {
    console.error('Map revision backfill failed', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
