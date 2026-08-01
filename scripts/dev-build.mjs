import { build } from 'vite';
import path from 'node:path';
import { access, readFile, rm, stat, utimes } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getRequiredReleaseEntryFiles } from './release-entry-contract.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFiles = [
  'vite.config.ts',
  'vite.sidebar-card.config.ts',
  'vite.player-monitor.config.ts',
];
const watch = !process.argv.includes('--once');
const smoke = process.argv.includes('--smoke');
const watchers = [];

try {
  if (watch) {
    await clearDevelopmentOutput();
  }
  for (const configFile of configFiles) {
    const configFilePath = path.join(repositoryRoot, configFile);
    const result = await build({
      configFile: configFilePath,
      mode: 'development',
      clearScreen: false,
      ...(watch ? { build: { watch: {}, emptyOutDir: false } } : {}),
    });
    if (watch) {
      if (!isWatcher(result)) {
        throw new Error(`Expected a Vite watcher for ${configFile}`);
      }
      watchers.push(result);
      await waitForInitialBuild(result, configFile);
    }
  }
} catch (error) {
  await closeWatchers();
  throw error;
}

if (watch && smoke) {
  await triggerIncrementalMainBuild(watchers[0]);
  await verifyDevelopmentEntries();
  await shutdown(0);
} else if (watch) {
  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));
}

function isWatcher(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.on === 'function'
    && typeof value.close === 'function';
}

function waitForInitialBuild(watcher, configFile) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Vite build: ${configFile}`));
    }, 30_000);
    watcher.on('event', event => {
      if (event.code === 'END') {
        clearTimeout(timeout);
        resolve();
      } else if (event.code === 'ERROR') {
        clearTimeout(timeout);
        reject(new Error(`Initial Vite build failed for ${configFile}`, { cause: event.error }));
      }
    });
  });
}

async function clearDevelopmentOutput() {
  const outputDirectory = path.join(repositoryRoot, 'dist');
  if (path.dirname(outputDirectory) !== repositoryRoot || path.basename(outputDirectory) !== 'dist') {
    throw new Error('Refusing to clear an unexpected development output directory');
  }
  await rm(outputDirectory, { recursive: true, force: true });
}

async function triggerIncrementalMainBuild(watcher) {
  const sourcePath = path.join(repositoryRoot, 'src', 'background', 'index.ts');
  const sourceStat = await stat(sourcePath);
  const rebuild = waitForInitialBuild(watcher, 'incremental main build');
  const nextModifiedTime = new Date(Math.max(Date.now(), sourceStat.mtimeMs + 2_000));
  await utimes(sourcePath, sourceStat.atime, nextModifiedTime);
  await rebuild;
}

async function verifyDevelopmentEntries() {
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'public', 'manifest.json'), 'utf8'),
  );
  for (const entry of getRequiredReleaseEntryFiles(manifest)) {
    await access(path.join(repositoryRoot, 'dist', entry));
  }
}

async function shutdown(exitCode) {
  await closeWatchers();
  process.exitCode = exitCode;
}

async function closeWatchers() {
  await Promise.allSettled(watchers.splice(0).map(watcher => watcher.close()));
}
