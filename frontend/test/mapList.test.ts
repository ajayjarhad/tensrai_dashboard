import { expect, test } from 'bun:test';
import type { MapRobot, MapSummary } from '../src/features/maps/api';
import {
  assignmentSummary,
  attentionSentence,
  filterMaps,
  formatWhen,
  lastChange,
  mapSize,
  mapsNeedingAttention,
  nextMapFilename,
  robotsBehind,
} from '../src/features/maps/mapList';

const robot = (robotId: string, state: MapRobot['state'], syncedAt: string | null = null) =>
  ({
    robotId,
    name: `Robot ${robotId}`,
    isActive: false,
    filename: null,
    syncedAt,
    state,
  }) as MapRobot;

const map = (id: string, robots: MapRobot[], extra: Partial<MapSummary> = {}): MapSummary => ({
  id,
  name: `Floor ${id}`,
  filename: `map${id}.yaml`,
  editedAt: null,
  revision: `rev-${id}`,
  contentHash: null,
  pixelWidth: 200,
  pixelHeight: 100,
  metadata: { resolution: 0.05 },
  robots,
  ...extra,
});

test('a map needs attention when a robot is behind, failed or changed it too', () => {
  const maps = [
    map('1', [robot('a', 'synced')]),
    map('2', [robot('a', 'needs_sync')]),
    map('3', [robot('b', 'syncing'), robot('c', 'unsupported')]),
    map('4', [robot('b', 'conflict')]),
    map('5', [robot('c', 'failed')]),
  ];
  expect(mapsNeedingAttention(maps).map(item => item.id)).toEqual(['2', '4', '5']);
});

test('syncing everything behind starts each robot once, and leaves conflicts alone', () => {
  const maps = [
    map('1', [robot('a', 'needs_sync'), robot('b', 'conflict')]),
    map('2', [robot('a', 'needs_sync'), robot('c', 'needs_sync')]),
  ];
  expect(robotsBehind(maps)).toEqual(['a', 'c']);
});

test('search matches the name or the file name; the robot filter keeps maps it holds', () => {
  const maps = [map('1', [robot('a', 'synced')]), map('12', [robot('b', 'synced')])];
  expect(filterMaps(maps, 'map12', '').map(item => item.id)).toEqual(['12']);
  expect(filterMaps(maps, 'floor', 'a').map(item => item.id)).toEqual(['1']);
});

test('the size reads in pixels and metres', () => {
  expect(mapSize(map('1', []))).toEqual({
    pixels: '200 × 100 px',
    metres: '10.0 × 5.0 m · 0.05 m/px',
  });
});

test('the last change is the edit here, or else the newest copy a robot sent', () => {
  const robots = [
    robot('a', 'synced', '2026-11-01T10:00:00Z'),
    robot('b', 'synced', '2026-11-03T10:00:00Z'),
  ];
  expect(lastChange(map('1', robots))).toEqual({
    at: '2026-11-03T10:00:00Z',
    by: 'Imported from Robot b',
  });
  expect(lastChange(map('1', robots, { editedAt: '2026-11-02T10:00:00Z' }))?.by).toBe(
    'Edited here'
  );
});

test('the banner names the first two problems, then counts the rest', () => {
  const maps = [
    map('1', [robot('a', 'needs_sync')], { name: 'Warehouse floor 1' }),
    map('2', [robot('b', 'conflict'), robot('c', 'failed')], { name: 'Cold store' }),
  ];
  expect(attentionSentence(maps)).toBe(
    'Robot a has an older Warehouse floor 1, and Cold store changed on Robot b, and 1 more.'
  );
});

test('dates read as today, yesterday or the day', () => {
  const now = new Date('2026-11-10T12:00:00');
  expect(formatWhen('2026-11-10T09:42:00', now)).toMatch(/^Today, /);
  expect(formatWhen('2026-11-09T17:05:00', now)).toMatch(/^Yesterday, /);
  expect(formatWhen('2026-11-06T14:20:00', now)).not.toMatch(/Today|Yesterday|2026/);
  expect(formatWhen('2025-11-06T14:20:00', now)).toMatch(/2025/);
});

test('a new map takes the first free map<N> name, as the server does', () => {
  expect(nextMapFilename([{ filename: 'map1.yaml' }, { filename: 'map3.yaml' }])).toBe('map2.yaml');
});

test('the Assign footer says what Apply will do', () => {
  expect(assignmentSummary(['Tensrai2'], [])).toBe('Adds Tensrai2. Nothing is removed.');
  expect(assignmentSummary(['A', 'B'], ['C'])).toBe('Adds A and B. Removes C.');
  expect(assignmentSummary([], [])).toBe('No changes yet.');
});
