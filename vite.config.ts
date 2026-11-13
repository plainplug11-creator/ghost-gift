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
    // ghost layers come in two sizes: never inline them into the JS (only the set actually shown gets fetched)
    assetsInlineLimit: (file: string) => (file.includes('/assets/ghost/') ? false : undefined),
  },
  server: { host: true },
}));
