import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Konva from 'konva/lib/Core';
import '@/lib/map/konva';

const SRC = join(import.meta.dir, '../src');

test('every map component the app imports is registered with Konva', () => {
  const used = new Set<string>();
  for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(file)) continue;
    const source = readFileSync(join(SRC, file), 'utf8');
    for (const [, names = ''] of source.matchAll(/import \{([^}]+)\} from '@\/lib\/map\/konva'/g)) {
      for (const name of names.split(',')) used.add(name.trim().split(/\s+as\s+/)[0] ?? '');
    }
  }

  expect(used.size).toBeGreaterThan(5);
  expect([...used].filter(name => !(name in Konva))).toEqual([]);
});
