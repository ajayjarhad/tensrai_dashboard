import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
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
  esbuild: {
    drop: ['console', 'debugger'],
  },
});
