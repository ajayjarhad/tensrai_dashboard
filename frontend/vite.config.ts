import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type Rollup } from 'vite';

// A page's code otherwise only starts downloading once the entry has arrived and run, and for a
// signed-in page once the shell's chunk has too, since pages load through it (app/pages.ts). A hint
// per path starts all of it with the entry. Sign-in gets none, so it keeps the bandwidth.
const PAGE_MODULES: [path: string, module: RegExp][] = [
  ['^/$', /robot-map\/(components\/Dashboard\.tsx|queries\.ts)$/],
  ['^/admin/robots', /features\/admin\/components\/RobotManagement\.tsx$/],
  ['^/admin/users', /features\/admin\/components\/user-management\.tsx$/],
  ['^/admin/create-temporary-user', /features\/admin\/components\/user-creation\.tsx$/],
  ['^/staff', /features\/staff\/components\/OrganizationsPage\.tsx$/],
  ['^/maps/?$', /features\/maps\/MapListPage\.tsx$/],
  ['^/maps/merge', /features\/maps\/merge\/MergePage\.tsx$/],
  ['^/maps/[^/]+/edit', /features\/maps\/editor\/MapEditorPage\.tsx$/],
];

const preloadPages = (): Plugin => ({
  name: 'preload-pages',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (_html, { bundle = {} }) => {
      const chunks = Object.values(bundle).filter(
        (output): output is Rollup.OutputChunk => output.type === 'chunk'
      );
      const entry = chunks.find(chunk => chunk.isEntry);
      const linked = new Set([entry?.fileName, ...(entry?.imports ?? [])]);
      const add = (fileName: string, files: Set<string>) => {
        if (linked.has(fileName) || files.has(fileName)) return;
        files.add(fileName);
        for (const imported of (bundle[fileName] as Rollup.OutputChunk).imports)
          add(imported, files);
      };
      // By the modules a chunk holds: the shell's chunk also carries what pages share with it, so it
      // has no single facade module.
      const chunksHolding = (module: RegExp) =>
        chunks.filter(chunk => chunk.moduleIds.some(id => module.test(id)));
      const table: string[] = [];
      const routes = PAGE_MODULES.map(([path, module]) => {
        const files = new Set<string>();
        const found = chunksHolding(module);
        if (found.length === 0) throw new Error(`preload-pages: no chunk holds ${module}`);
        for (const chunk of [...chunksHolding(/app\/AppShell\.tsx$/), ...found])
          add(chunk.fileName, files);
        // Smallest first: a large chunk asked for early (the map renderer) takes bandwidth from the
        // entry, which every page waits on, and the page's first paint moves back with it.
        const size = (file: string) => (bundle[file] as Rollup.OutputChunk).code.length;
        const indexes = [...files]
          .sort((a, b) => size(a) - size(b))
          .map(file => {
            if (!table.includes(file)) table.push(file);
            return table.indexOf(file);
          });
        return [path, indexes];
      });
      return [
        {
          tag: 'script',
          // Ahead of the stylesheet, which an inline script would otherwise wait for.
          injectTo: 'head-prepend',
          children: `{const f=${JSON.stringify(table)};for(const[p,i]of ${JSON.stringify(routes)})if(new RegExp(p).test(location.pathname)){for(const n of i){const l=document.createElement('link');l.rel='modulepreload';l.href='/'+f[n];document.head.append(l)}break}}`,
        },
      ];
    },
  },
});

// Keep console logging in dev so diagnostics (MapLoad/MapImage, etc.) show up.
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    plugins: [react(), preloadPages()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@tensrai/shared': path.resolve(__dirname, '../shared/src'),
        '@shared': path.resolve(__dirname, '../shared/src'),
      },
    },
    server: {
      port: 5000,
      host: '0.0.0.0',
    },
    build: {
      modulePreload: {
        // The map pages' own chunks still preload; listing each of their many small shared chunks too
        // would grow the entry every page downloads. They load once the page's chunk has arrived.
        resolveDependencies: (filename: string, deps: string[]) =>
          /(MapEditorPage|MergePage|MapListPage)-/.test(filename) ? [] : deps,
      },
    },
    esbuild: isBuild
      ? {
          drop: ['console', 'debugger'],
        }
      : undefined,
  };
});
