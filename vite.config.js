import { defineConfig } from 'vite';

// base './' so the build works from a GitHub Pages sub-path
export default defineConfig({
  base: './',
  server: { port: 5200, strictPort: true, host: true },
  preview: { port: 5200 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500, target: 'es2022' },
});
