import { PrismaClient } from '@prisma/client';
import { generateMapAssets } from '../src/services/mapAssets.js';

const prisma = new PrismaClient() as any;

async function main() {
  const maps = await prisma.map.findMany({
    select: {
      id: true,
      name: true,
      filename: true,
      image: true,
      metadata: true,
      contentHash: true,
      displayWebpSizeBytes: true,
      displayPngSizeBytes: true,
    },
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const map of maps) {
    try {
      const hasDisplayAsset = Boolean(map.displayWebpSizeBytes || map.displayPngSizeBytes);

      if (map.contentHash && hasDisplayAsset) {
        skipped += 1;
        continue;
      }

      const image = Buffer.from(map.image);
      const assets = await generateMapAssets(image, map.metadata ?? {});
      await prisma.map.update({
        where: { id: map.id },
        data: assets,
      });
      updated += 1;
      console.log(
        `[map-assets] updated ${map.filename ?? map.name} hash=${assets.contentHash.slice(0, 12)} webp=${assets.displayWebpSizeBytes ?? 0} png=${assets.displayPngSizeBytes ?? 0}`
      );
    } catch (error) {
      failed += 1;
      console.error(`[map-assets] failed ${map.filename ?? map.name}`, error);
    }
  }

  console.log(`[map-assets] complete updated=${updated} skipped=${skipped} failed=${failed}`);
}

main()
  .catch(error => {
    console.error('[map-assets] fatal', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
