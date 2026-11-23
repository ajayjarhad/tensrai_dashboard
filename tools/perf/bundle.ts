// Bundle harness for the eng perf ledger: builds the frontend for production and prints, per page,
// the gzipped JavaScript a first visit downloads (the entry chunk, plus the page's lazy chunk and
// their static imports). One JSON line per page: bun tools/perf/bundle.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

type ManifestChunk = {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
};

const FRONTEND = resolve(import.meta.dir, '../../frontend');
// A signed-in page also downloads the app shell (header, fleet E-stop) around it.
const SHELL = 'src/app/AppShell.tsx';
const PAGES: Record<string, string[]> = {
  '/auth/login': ['src/features/auth/components/login-form.tsx'],
  '/': [SHELL, 'src/features/robot-map/components/Dashboard.tsx'],
  '/admin/robots': [SHELL, 'src/features/admin/components/RobotManagement.tsx'],
  '/staff/organizations': [SHELL, 'src/features/staff/components/OrganizationsPage.tsx'],
  '/maps': [SHELL, 'src/features/maps/MapListPage.tsx'],
  '/maps/$mapId/edit': [SHELL, 'src/features/maps/editor/MapEditorPage.tsx'],
  '/maps/merge': [SHELL, 'src/features/maps/merge/MergePage.tsx'],
};

const outDir = mkdtempSync(join(tmpdir(), 'dashboard-bundle-'));
try {
  const build = Bun.spawnSync(
    ['../node_modules/.bin/vite', 'build', '--manifest', '--outDir', outDir, '--emptyOutDir'],
    // Bun sets NODE_ENV=development in its own process, which would make Vite bundle React's dev build.
    {
      cwd: FRONTEND,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    }
  );
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());

  const manifest: Record<string, ManifestChunk> = JSON.parse(
    readFileSync(join(outDir, '.vite/manifest.json'), 'utf8')
  );
  const gzipBytes = (file: string) => gzipSync(readFileSync(join(outDir, file))).length;
  const withStaticImports = (key: string, seen: Set<string>) => {
    if (seen.has(key)) return seen;
    seen.add(key);
    for (const next of manifest[key]?.imports ?? []) withStaticImports(next, seen);
    return seen;
  };
  // A page's chunk is keyed by its source, unless it also exports modules for chunks it imports
  // dynamically (the shell does, for every signed-in page): then by its file, so match it by name.
  const chunkKeyOf = (source: string) => {
    if (manifest[source]) return source;
    const name = source
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '');
    return Object.keys(manifest).find(
      key => manifest[key]?.isDynamicEntry && manifest[key]?.name === name
    );
  };
  const entryKey = Object.keys(manifest).find(key => manifest[key]?.isEntry);
  if (!entryKey) throw new Error('No entry chunk in the Vite manifest');

  for (const [page, sources] of Object.entries(PAGES)) {
    const chunks = withStaticImports(entryKey, new Set());
    // Before a page is split out, its module lives in the entry chunk and has no manifest key.
    for (const source of sources) {
      const key = chunkKeyOf(source);
      if (key) withStaticImports(key, chunks);
    }
    const value = [...chunks]
      .map(key => manifest[key]?.file)
      .filter((file): file is string => Boolean(file?.endsWith('.js')))
      .reduce((total, file) => total + gzipBytes(file), 0);
    console.log(
      JSON.stringify({ unit: `dashboard-ui:${page}`, metric: 'js_gzip_bytes', value, env: 'local' })
    );
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
