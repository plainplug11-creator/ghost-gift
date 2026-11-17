import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const build = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();

export default defineConfig(({ command }) => ({
  // Production is hosted on GitHub Pages at /ghost-gift/.
  // The dev server keeps serving from the root.
  base: command === 'build' ? '/ghost-gift/' : './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(build) },
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
