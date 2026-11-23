import { expect, test } from 'bun:test';
import type { ConflictDetail } from '../src/features/maps/api';
import { compareCopies } from '../src/features/maps/conflict';
import { checkMetadata, checkPgm, checkYaml } from '../src/features/maps/uploadFiles';

test('an uploaded image is described by its size, in pixels and metres', () => {
  expect(checkPgm('P5\n601 649\n255\n', 390_000, 0.05)).toEqual({
    ok: true,
    text: '601 × 649 px · 30.1 × 32.5 m · 381 KB',
  });
  expect(checkPgm('P2\n1 1\n255\n', 10, null).ok).toBe(false);
  expect(checkPgm('P5\n2 2\n65535\n', 10, null)).toMatchObject({ ok: false });
});

test('an uploaded YAML is described, and a turned origin is refused', () => {
  const yaml = 'image: a.pgm\nmode: trinary\nresolution: 0.05\norigin: [-15.1, -16.7, 0]\n';
  expect(checkYaml(yaml)).toEqual({
    ok: true,
    text: 'resolution 0.05 · origin −15.1, −16.7, 0 · trinary',
  });
  expect(checkYaml(yaml.replace(', 0]', ', 0.3]'))).toMatchObject({ ok: false });
  expect(checkYaml('image: a.pgm\n')).toMatchObject({ ok: false });
});

test('metadata.json is described by its tags and missions', () => {
  expect(checkMetadata('{"locationTags":[{},{}],"missions":[{}]}').text).toBe(
    '2 location tags · 1 mission'
  );
  expect(checkMetadata('{nope').ok).toBe(false);
});

test('a conflict says what each side has that the other lacks', () => {
  const detail: ConflictDetail = {
    ours: {
      editedAt: null,
      editedBy: 'Priya',
      imageSha256: 'same',
      yaml: null,
      features: {
        zones: [
          {
            id: 'z1',
            type: 'no_go',
            name: 'Charger bay',
            polygon: [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          },
        ],
        locationTags: [{ id: 7, name: 'Bay 7', x: 1, y: 1 }],
        missions: [{ missionId: 1, name: 'Restock', locationTagId: [7] }],
      },
    },
    robot: {
      at: null,
      imageSha256: 'same',
      yaml: null,
      features: {
        locationTags: [{ id: 7, name: 'Bay 7', x: 2, y: 1 }],
        missions: [
          { missionId: 1, name: 'Restock', locationTagId: [7] },
          { missionId: 5, name: 'Night restock', locationTagId: [7] },
        ],
      },
    },
  };
  const { mine, theirs, unchanged } = compareCopies(detail);
  expect(mine.lines).toEqual([
    '1 zone only here: Charger bay',
    '1 location tag set differently: Bay 7',
  ]);
  expect(theirs.lines).toEqual(['1 mission only on the robot: 5 Night restock']);
  expect(theirs.onlyMissions).toEqual(['5']);
  expect(unchanged).toEqual(['image', 'paths']);
});

test('the YAML dialog points at the line that is wrong, and says why', async () => {
  const { checkYamlText } = await import('../src/features/maps/editor/YamlDialog');
  const good = 'image: m.pgm\nresolution: 0.05\norigin: [-15.1, -16.7, 0]\n';
  expect(checkYamlText(good).yaml?.resolution).toBe(0.05);
  const turned = checkYamlText(good.replace(', 0]', ', 0.12]'));
  expect(turned.error).toBe('Line 3: origin yaw must be 0.');
  expect(turned.why).toMatch(/Nav2 ignores yaw/);
  expect(checkYamlText('resolution: [').error).toMatch(/^Line \d+: The YAML doesn't parse\./);
});
