import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(repositoryRoot, 'dist');

const requiredFiles = [
  ['LICENSE.txt', /^MIT License/m],
  ['THIRD_PARTY_NOTICES.txt', /Apache ECharts 6\.1\.0/],
  ['third_party_licenses/Apache-2.0.txt', /Apache License\s+Version 2\.0/],
  ['third_party_licenses/BSD-3-Clause-d3.txt', /Copyright 2010-2016 Mike Bostock/],
  ['third_party_licenses/MIT-wordcloud2.txt', /Copyright \(c\) 2011- Timothy Guan-tin Chien/],
];

for (const [relativePath, expected] of requiredFiles) {
  const source = await readFile(path.join(distRoot, relativePath), 'utf8');
  assert.match(source, expected, `Release distribution notice is invalid: ${relativePath}`);
}

console.log(`PASS release distribution licenses: ${requiredFiles.length} files`);
