import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Keep console logging in dev so diagnostics (MapLoad/MapImage, etc.) show up.
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  return {
    plugins: [react()],
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
