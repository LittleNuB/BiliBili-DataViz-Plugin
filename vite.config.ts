import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@background': resolve(__dirname, 'src/background'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        'content/player-monitor': resolve(__dirname, 'src/content/player-monitor/index.ts'),
        'content/sidebar-card': resolve(__dirname, 'src/content/sidebar-card/index.ts'),
        popup: resolve(__dirname, 'popup/index.html'),
        dashboard: resolve(__dirname, 'dashboard/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
