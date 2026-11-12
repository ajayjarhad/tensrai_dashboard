import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type Rollup } from 'vite';

// Most visits land on the dashboard, whose code and first queries otherwise only start downloading
// once the entry has arrived and run. The hint is limited to "/" so sign-in keeps the bandwidth.
const preloadDashboard = (): Plugin => ({
  name: 'preload-dashboard',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (_html, { bundle = {} }) => {
      const chunks = Object.values(bundle).filter(
        (output): output is Rollup.OutputChunk => output.type === 'chunk'
      );
      const entry = chunks.find(chunk => chunk.isEntry);
      const linked = new Set([entry?.fileName, ...(entry?.imports ?? [])]);
      const files = new Set<string>();
      const add = (fileName: string) => {
        if (linked.has(fileName) || files.has(fileName)) return;
        files.add(fileName);
        for (const imported of (bundle[fileName] as Rollup.OutputChunk).imports) add(imported);
      };
      for (const chunk of chunks) {
        if (
          /robot-map\/(components\/Dashboard\.tsx|queries\.ts)$/.test(chunk.facadeModuleId ?? '')
        ) {
          add(chunk.fileName);
        }
      }
      if (files.size === 0)
        throw new Error('preload-dashboard: no Dashboard or queries chunk found');
      const hrefs = JSON.stringify([...files].map(file => `/${file}`));
      return [
        {
          tag: 'script',
          // Ahead of the stylesheet, which an inline script would otherwise wait for.
          injectTo: 'head-prepend',
          children: `if(location.pathname==='/')for(const href of ${hrefs}){const l=document.createElement('link');l.rel='modulepreload';l.href=href;document.head.append(l)}`,
        },
      ];
    },
  },
});

// Keep console logging in dev so diagnostics (MapLoad/MapImage, etc.) show up.
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    plugins: [react(), preloadDashboard()],
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
    esbuild: isBuild
      ? {
          drop: ['console', 'debugger'],
        }
      : undefined,
  };
});
