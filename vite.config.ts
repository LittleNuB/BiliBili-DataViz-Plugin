import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveRoot = (...segments: string[]) => path.resolve(__dirname, ...segments);

export default defineConfig({
  root: __dirname,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: [
      { find: '@shared', replacement: resolveRoot('src/shared') },
      { find: '@background', replacement: resolveRoot('src/background') },
      // The ECharts 6 word-cloud package imports utilities from the full entry; bind that exact import to core.
      { find: /^echarts$/, replacement: 'echarts/core' },
    ],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: 'src/background/index.ts',
        'content/sidebar-card': 'src/content/sidebar-card/index.ts',
        popup: 'popup/index.html',
        dashboard: 'dashboard/index.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
