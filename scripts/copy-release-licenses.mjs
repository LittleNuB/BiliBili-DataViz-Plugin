import { cp, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(repositoryRoot, 'dist');

await mkdir(distRoot, { recursive: true });
await copyFile(path.join(repositoryRoot, 'LICENSE'), path.join(distRoot, 'LICENSE.txt'));
await copyFile(
  path.join(repositoryRoot, 'THIRD_PARTY_NOTICES.txt'),
  path.join(distRoot, 'THIRD_PARTY_NOTICES.txt'),
);
await cp(
  path.join(repositoryRoot, 'third_party', 'licenses'),
  path.join(distRoot, 'third_party_licenses'),
  { recursive: true },
);
