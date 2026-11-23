import { isRecord } from '@tensrai/shared';
import { normalizeFeatures } from './mapSyncPayload.js';

type Entry = Record<string, unknown>;

const entries = (value: unknown): Entry[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const integerOf = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isSafeInteger(number) ? number : null;
};

const missionIdOf = (mission: Entry) =>
  mission['id'] ?? mission['missionId'] ?? mission['missionID'];

// Dashboard features → the robot's metadata.json v2: integer tag and mission ids, missions as
// missionId + locationTagId as the robot's own tools write them, zones and paths as stored. Keys a
// robot added pass through untouched.
export const toRobotMetadata = (features: unknown): Record<string, unknown> => {
  const { locationTags, missions, ...rest } = isRecord(features) ? features : {};
  return {
    ...rest,
    locationTags: entries(locationTags).map(tag => ({
      ...tag,
      id: integerOf(tag['id']) ?? tag['id'],
    })),
    missions: entries(missions).map(mission => {
      const {
        id: _id,
        missionId: _missionId,
        missionID: _missionID,
        steps,
        locationTagId,
        ...other
      } = mission;
      const id = missionIdOf(mission);
      const tagIds = Array.isArray(steps)
        ? steps
        : Array.isArray(locationTagId)
          ? locationTagId
          : [];
      return {
        ...other,
        missionId: integerOf(id) ?? id,
        locationTagId: tagIds.map(tagId => integerOf(tagId) ?? tagId),
      };
    }),
  };
};

// The stored form of features. A pushed copy imports back to exactly this, so its revision matches.
export const canonicalFeatures = (features: unknown) =>
  normalizeFeatures(toRobotMetadata(features));

// Tag and mission ids the robot can't read: it expects integers.
export const nonIntegerIds = (features: unknown) => {
  const source = isRecord(features) ? features : {};
  return {
    tags: entries(source['locationTags'])
      .map(tag => tag['id'])
      .filter(id => integerOf(id) === null),
    missions: entries(source['missions'])
      .map(missionIdOf)
      .filter(id => integerOf(id) === null),
  };
};

export const missionIds = (features: unknown) =>
  entries(isRecord(features) ? features['missions'] : undefined)
    .map(mission => integerOf(missionIdOf(mission)))
    .filter((id): id is number => id !== null);

// A robot runs whichever mission it finds first across its metadata files, so a mission id may be
// used by one map per robot only.
export const missionIdConflicts = (features: unknown, otherMaps: unknown[]) => {
  const taken = new Set(otherMaps.flatMap(missionIds));
  return [...new Set(missionIds(features).filter(id => taken.has(id)))];
};

// Gives tags with non-integer ids, and missions whose ids are not integers or are taken, fresh
// integer ids; mission steps follow their tags. Used to save older maps and to clear mission clashes.
export const renumberIds = (features: unknown, takenMissionIds: Iterable<number> = []) => {
  const source = isRecord(features) ? features : {};
  const tags = entries(source['locationTags']);
  const usedTagIds = new Set(tags.map(tag => integerOf(tag['id'])).filter(id => id !== null));
  let nextTagId = Math.max(0, ...usedTagIds) + 1;
  const tagIdMap = new Map<string, number>();
  const renumberedTags = tags.map(tag => {
    if (integerOf(tag['id']) !== null) return tag;
    const id = nextTagId++;
    tagIdMap.set(String(tag['id']), id);
    return { ...tag, id };
  });
  const remapStep = (step: unknown) => tagIdMap.get(String(step)) ?? integerOf(step) ?? step;

  const taken = new Set(takenMissionIds);
  const missions = entries(source['missions']);
  for (const id of missionIds(source)) if (!taken.has(id)) taken.add(id);
  let nextMissionId = Math.max(0, ...taken) + 1;
  const kept = new Set<number>();
  const renumberedMissions = missions.map(mission => {
    const current = integerOf(missionIdOf(mission));
    const clash = current === null || [...takenMissionIds].includes(current) || kept.has(current);
    const id = clash ? nextMissionId++ : current;
    kept.add(id);
    const steps = Array.isArray(mission['steps'])
      ? mission['steps']
      : Array.isArray(mission['locationTagId'])
        ? mission['locationTagId']
        : [];
    return {
      ...mission,
      id,
      missionId: id,
      steps: steps.map(remapStep),
      locationTagId: steps.map(remapStep),
    };
  });

  return canonicalFeatures({
    ...source,
    locationTags: renumberedTags,
    missions: renumberedMissions,
  });
};
