import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

// PAGES_BASE is set by the GitHub Pages workflow, e.g. "/lockation/app/".
export default defineConfig({
  base: process.env.PAGES_BASE ?? './',
  plugins: [preact()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        config: resolve(__dirname, 'config.html'),
        toys: resolve(__dirname, 'toys.html'),
      },
    },
  },
});
