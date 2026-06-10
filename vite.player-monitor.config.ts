import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveRoot = (...segments: string[]) => path.resolve(__dirname, ...segments);

export default defineConfig({
  root: __dirname,
  publicDir: false,
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
    emptyOutDir: false,
    rollupOptions: {
      input: {
        'content/player-monitor': 'src/content/player-monitor/index.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        inlineDynamicImports: true,
      },
    },
  },
});
