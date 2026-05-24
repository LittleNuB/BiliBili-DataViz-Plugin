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
    alias: {
      '@shared': resolveRoot('src/shared'),
      '@background': resolveRoot('src/background'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        background: 'src/background/index.ts',
        'content/player-monitor': 'src/content/player-monitor/index.ts',
        'content/sidebar-card': 'src/content/sidebar-card/index.ts',
        popup: 'popup/index.html',
        dashboard: 'dashboard/index.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.endsWith('/src/shared/echarts/register.ts')) return 'echarts-register';
          if (normalized.endsWith('/src/shared/echarts/theme.ts')) return 'echarts-theme';
          if (normalized.endsWith('/src/shared/echarts/wordcloud.ts')) return 'echarts-wordcloud-entry';
          if (normalized.includes('/node_modules/echarts-wordcloud/')) return 'echarts-wordcloud';
          if (normalized.includes('/node_modules/zrender/')) return 'zrender';
          if (normalized.includes('/node_modules/echarts/')) return 'echarts';
          return undefined;
        },
      },
    },
  },
});
