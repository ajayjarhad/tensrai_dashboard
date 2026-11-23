import { expect, test } from 'bun:test';
import { checkMapYaml, MapYamlSchema } from '@tensrai/shared';

// The editor's light check and the server's schema must agree on every case.
const CASES: unknown[] = [
  { resolution: 0.05, origin: [-1, 2, 0] },
  {
    image: 'map4.pgm',
    mode: 'trinary',
    resolution: 0.05,
    origin: [0, 0, 0],
    negate: 0,
    occupied_thresh: 0.65,
    free_thresh: 0.25,
  },
  { resolution: 0.05, origin: [0, 0, 0], negate: true },
  { resolution: 0.05, origin: [0, 0, 0.3] },
  { resolution: 0, origin: [0, 0, 0] },
  { resolution: 11, origin: [0, 0, 0] },
  { resolution: 0.05, origin: [0, 0] },
  { resolution: 0.05, origin: [0, 'a', 0] },
  { resolution: 0.05, origin: [0, 0, 0], mode: 'fancy' },
  { resolution: 0.05, origin: [0, 0, 0], negate: 2 },
  { resolution: 0.05, origin: [0, 0, 0], free_thresh: 1.5 },
  { resolution: 0.05, origin: [0, 0, 0], extra: 1 },
  { resolution: 0.05, origin: [0, 0, 0], image: 'x'.repeat(256) },
  { origin: [0, 0, 0] },
  null,
  [1, 2],
];

test('the editor and the server accept and refuse the same map YAML', () => {
  for (const value of CASES) {
    expect([JSON.stringify(value), checkMapYaml(value).ok]).toEqual([
      JSON.stringify(value),
      MapYamlSchema.safeParse(value).success,
    ]);
  }
});
