// Renders the keepout masks the keepout check loads into Nav2, with the dashboard's own generator:
// one empty, one with a no-go square across the straight line from the start to the goal.
//   bun tools/e2e/nav2/keepout-masks.ts <out dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderKeepoutMask } from '../../../backend/src/services/keepoutMask.ts';

const out = process.argv[2] ?? '.';
const REPO = new URL('../../../', import.meta.url).pathname;
const pgm = readFileSync(join(REPO, 'dashboard_ros/maps/map.pgm'), 'latin1');
const [, width, height] = pgm.match(/^P5\s+(\d+)\s+(\d+)/) ?? [];
const grid = {
  width: Number(width),
  height: Number(height),
  resolution: 0.05,
  origin: [-15.1, -16.7, 0] as [number, number, number],
};

const start: [number, number] = [1.26, -3.18];
const goal: [number, number] = [-4.5, 0];
const centre = [(start[0] + goal[0]) / 2, (start[1] + goal[1]) / 2] as const;
const half = 0.8;
const polygon: [number, number][] = [
  [centre[0] - half, centre[1] - half],
  [centre[0] + half, centre[1] - half],
  [centre[0] + half, centre[1] + half],
  [centre[0] - half, centre[1] + half],
];

for (const [stem, features] of [
  ['empty', {}],
  ['zone', { zones: [{ id: 'z1', type: 'no_go', name: 'Check zone', polygon }] }],
] as const) {
  const mask = renderKeepoutMask(grid, features, stem);
  writeFileSync(join(out, `keepout_${stem}.yaml`), mask.yaml);
  writeFileSync(join(out, `keepout_${stem}.pgm`), mask.pgm);
}
writeFileSync(join(out, 'zone.json'), JSON.stringify({ start, goal, polygon, centre }));
