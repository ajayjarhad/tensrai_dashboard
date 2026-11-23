// Fills what revision-based map identity needs on maps and robot links stored before it: each map's
// image hash and revision, each link's filename on its robot, and a baseline for links whose map was
// never edited in the dashboard. Idempotent; runs on every start, and a failure is logged, not fatal.
import type { PrismaClient } from '@prisma/client';
import { pgmOf } from './mapImage.js';
import { mapRevision, sha256 } from './mapRevision.js';

export const backfillMapRevisions = async (client: PrismaClient) => {
  const maps = await client.map.findMany({
    where: { OR: [{ revision: { isSet: false } }, { revision: null }, { imageSha256: null }] },
    select: { id: true, image: true, metadata: true, features: true },
  });
  for (const map of maps) {
    const imageSha256 = sha256(pgmOf(map.image));
    const yaml = (map.metadata ?? {}) as Record<string, unknown>;
    await client.map.update({
      where: { id: map.id },
      data: { imageSha256, revision: mapRevision({ imageSha256, yaml, features: map.features }) },
    });
  }

  const links = await client.robotMap.findMany({
    where: { OR: [{ filename: { isSet: false } }, { filename: null }] },
    select: {
      robotId: true,
      mapId: true,
      pushedRevision: true,
      map: { select: { filename: true, revision: true, editedAt: true } },
    },
  });
  for (const link of links) {
    if (!link.map) continue;
    // A map never edited here holds what its robot sent, so that is the robot's baseline.
    const baseline =
      !link.pushedRevision && !link.map.editedAt && link.map.revision
        ? { pushedRevision: link.map.revision }
        : {};
    await client.robotMap.update({
      where: { robotId_mapId: { robotId: link.robotId, mapId: link.mapId } },
      data: { filename: link.map.filename, ...baseline },
    });
  }
  return { maps: maps.length, links: links.length };
};
