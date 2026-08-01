import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveRoot = (...segments: string[]) => path.resolve(__dirname, ...segments);

function buildVendorChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/');

  if (normalizedId.includes('/node_modules/@echarts-x/custom-word-cloud/')) {
    return 'echarts-word-cloud';
  }
  if (normalizedId.includes('/node_modules/zrender/')) {
    return 'echarts-renderer';
  }
  if (normalizedId.includes('/node_modules/echarts/')) {
    return 'echarts';
  }

  return undefined;
}

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
        // Keep shared chart dependencies cached independently while keeping every output below Vite's warning threshold.
        manualChunks: buildVendorChunk,
      },
    },
  },
});
