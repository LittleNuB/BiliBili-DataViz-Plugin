import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRequiredReleaseEntryFiles } from './release-entry-contract.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(repositoryRoot, 'dist');

const requiredFiles = [
  ['LICENSE.txt', /^MIT License/m],
  ['THIRD_PARTY_NOTICES.txt', /Apache ECharts 6\.1\.0/],
  ['third_party_licenses/Apache-2.0.txt', /Apache License\s+Version 2\.0/],
  ['third_party_licenses/BSD-3-Clause-d3.txt', /Copyright 2010-2016 Mike Bostock/],
  ['third_party_licenses/MIT-wordcloud2.txt', /Copyright \(c\) 2011- Timothy Guan-tin Chien/],
];
const MAX_MINIFIED_CHUNK_BYTES = 500_000;

const manifest = JSON.parse(await readFile(path.join(distRoot, 'manifest.json'), 'utf8'));
const requiredEntryFiles = getRequiredReleaseEntryFiles(manifest);

for (const [relativePath, expected] of requiredFiles) {
  const source = await readFile(path.join(distRoot, relativePath), 'utf8');
  assert.match(source, expected, `Release distribution notice is invalid: ${relativePath}`);
}

for (const relativePath of requiredEntryFiles) {
  const entry = await stat(path.join(distRoot, relativePath));
  assert.ok(entry.isFile(), `Release distribution entry point is missing: ${relativePath}`);
}

const chunkFiles = await collectJavaScriptFiles(distRoot);
for (const relativePath of chunkFiles) {
  const chunk = await stat(path.join(distRoot, relativePath));
  assert.ok(
    chunk.size <= MAX_MINIFIED_CHUNK_BYTES,
    `Minified chunk exceeds ${MAX_MINIFIED_CHUNK_BYTES} bytes: ${relativePath} (${chunk.size})`,
  );
}

console.log(
  `PASS release distribution: ${requiredFiles.length} licenses, ${requiredEntryFiles.length} entries, ${chunkFiles.length} chunks`,
);

async function collectJavaScriptFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return collectJavaScriptFiles(path.join(directory, entry.name), relativePath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [relativePath] : [];
  }));
  return files.flat();
}
