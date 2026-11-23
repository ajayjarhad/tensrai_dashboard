import type { MapFeatures } from '@tensrai/shared';
import type { ConflictDetail } from './api';

// What differs between the dashboard's copy and a robot's, so the Conflict dialog can say what each
// choice keeps and loses. Two-way: the version both started from is not stored.

type Item = Record<string, unknown>;

const KINDS = [
  { key: 'zones', id: 'id', one: 'zone', many: 'zones' },
  { key: 'paths', id: 'id', one: 'path', many: 'paths' },
  { key: 'locationTags', id: 'id', one: 'location tag', many: 'location tags' },
  { key: 'missions', id: 'missionId', one: 'mission', many: 'missions' },
] as const;

const itemsOf = (features: MapFeatures | null, key: string) =>
  ((features?.[key] as Item[] | undefined) ?? []).filter(item => item && typeof item === 'object');

const labelOf = (item: Item, kind: (typeof KINDS)[number]) =>
  kind.key === 'missions'
    ? `${String(item['missionId'] ?? item['id'] ?? '')} ${String(item['name'] ?? '')}`.trim()
    : String(item['name'] ?? item[kind.id] ?? '');

const keyOf = (item: Item, kind: (typeof KINDS)[number]) =>
  String(item[kind.id] ?? item['id'] ?? '');

const phrase = (items: Item[], kind: (typeof KINDS)[number], where: string) => {
  const names = items.map(item => labelOf(item, kind)).filter(Boolean);
  const noun = items.length === 1 ? kind.one : kind.many;
  return `${items.length} ${noun} ${where}${names.length ? `: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : ''}`;
};

export interface ConflictSide {
  lines: string[];
  // Mission ids that exist only on this side: what the other choice would lose.
  onlyMissions: string[];
}

export const compareCopies = ({ ours, robot }: ConflictDetail) => {
  const mine: ConflictSide = { lines: [], onlyMissions: [] };
  const theirs: ConflictSide = { lines: [], onlyMissions: [] };
  const unchanged: string[] = [];
  if (ours.imageSha256 && robot.imageSha256 && ours.imageSha256 !== robot.imageSha256) {
    mine.lines.push('The image differs from the robot’s');
    theirs.lines.push('The image differs from ours');
  } else {
    unchanged.push('image');
  }
  for (const kind of KINDS) {
    const here = itemsOf(ours.features, kind.key);
    const there = itemsOf(robot.features, kind.key);
    const thereByKey = new Map(there.map(item => [keyOf(item, kind), item]));
    const hereByKey = new Map(here.map(item => [keyOf(item, kind), item]));
    const onlyHere = here.filter(item => !thereByKey.has(keyOf(item, kind)));
    const onlyThere = there.filter(item => !hereByKey.has(keyOf(item, kind)));
    const differ = here.filter(item => {
      const other = thereByKey.get(keyOf(item, kind));
      return other && JSON.stringify(other) !== JSON.stringify(item);
    });
    if (onlyHere.length) mine.lines.push(phrase(onlyHere, kind, 'only here'));
    if (onlyThere.length) theirs.lines.push(phrase(onlyThere, kind, 'only on the robot'));
    if (differ.length) mine.lines.push(phrase(differ, kind, 'set differently'));
    if (!onlyHere.length && !onlyThere.length && !differ.length) unchanged.push(kind.many);
    if (kind.key === 'missions') {
      mine.onlyMissions = onlyHere.map(item => keyOf(item, kind));
      theirs.onlyMissions = onlyThere.map(item => keyOf(item, kind));
    }
  }
  return { mine, theirs, unchanged };
};
