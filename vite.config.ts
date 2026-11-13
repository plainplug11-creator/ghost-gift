import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Production is hosted on GitHub Pages at /ghost-gift/.
  // The dev server keeps serving from the root.
  base: command === 'build' ? '/ghost-gift/' : './',
  build: {
    target: ['es2020', 'safari14', 'chrome87'],
    cssMinify: true,
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
  },
  server: { host: true },
}));
