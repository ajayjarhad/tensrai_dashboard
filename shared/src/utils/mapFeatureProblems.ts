import { distanceToPolyline, type Point, pointInPolygon } from './geometry.js';
import { isRecord } from './isRecord.js';

// Rules a robot can't recover from, checked by the editor before a save and by the server on it.

export interface MapFeatureProblem {
  code: 'INVALID_FEATURES' | 'TAG_IN_NO_GO' | 'TAG_IN_USE';
  message: string;
  // Where to look, in world metres, when the problem has a place.
  at?: { x: number; y: number };
}

type Entry = Record<string, unknown>;

const records = (value: unknown): Entry[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const pointsOf = (value: unknown) => (Array.isArray(value) ? (value as Point[]) : []);
const nameOf = (entry: Entry) => String(entry['name'] ?? entry['id'] ?? '');

export const missionSteps = (mission: Entry): unknown[] => {
  if (Array.isArray(mission['steps'])) return mission['steps'];
  return Array.isArray(mission['locationTagId']) ? mission['locationTagId'] : [];
};

// Nav2 on Humble can't plan out of a keepout cell, so a goal there strands the robot.
const keepoutHolding = (tag: Entry, features: Entry) => {
  const point: Point = [Number(tag['x']), Number(tag['y'])];
  const zone = records(features['zones']).find(
    candidate =>
      candidate['type'] === 'no_go' && pointInPolygon(point, pointsOf(candidate['polygon']))
  );
  if (zone) return `Tag “${nameOf(tag)}” is inside the no-go zone “${nameOf(zone)}”.`;
  const wall = records(features['paths']).find(
    candidate =>
      candidate['type'] === 'virtual_wall' &&
      distanceToPolyline(point, pointsOf(candidate['points'])) <=
        Number(candidate['width'] ?? 0) / 2
  );
  return wall ? `Tag “${nameOf(tag)}” is on the virtual wall “${nameOf(wall)}”.` : null;
};

export const mapFeatureProblem = (features: Entry): MapFeatureProblem | null => {
  const tags = records(features['locationTags']);
  if (tags.filter(tag => tag['type'] === 'home').length > 1) {
    return { code: 'INVALID_FEATURES', message: 'A map can have one home tag.' };
  }
  for (const tag of tags) {
    const message = keepoutHolding(tag, features);
    if (message) {
      return { code: 'TAG_IN_NO_GO', message, at: { x: Number(tag['x']), y: Number(tag['y']) } };
    }
  }
  const tagIds = new Set(tags.map(tag => String(tag['id'])));
  for (const mission of records(features['missions'])) {
    const missing = missionSteps(mission).find(step => !tagIds.has(String(step)));
    if (missing !== undefined) {
      return {
        code: 'TAG_IN_USE',
        message: `Mission “${nameOf(mission)}” goes to tag ${String(missing)}, which is not on the map.`,
      };
    }
  }
  return null;
};
