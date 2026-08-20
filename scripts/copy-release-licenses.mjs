import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectPackageAttributionFiles,
  collectProductionPackages,
  getDeclaredLicense,
  getPackageLicenseDirectory,
  isLicenseFilePath,
} from './production-license-contract.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(repositoryRoot, 'dist');

await mkdir(distRoot, { recursive: true });
await copyCanonicalTextFile(
  path.join(repositoryRoot, 'LICENSE'),
  path.join(distRoot, 'LICENSE.txt'),
);
await copyCanonicalTextFile(
  path.join(repositoryRoot, 'THIRD_PARTY_NOTICES.txt'),
  path.join(distRoot, 'THIRD_PARTY_NOTICES.txt'),
);
await copyCanonicalTextDirectory(
  path.join(repositoryRoot, 'third_party', 'licenses'),
  path.join(distRoot, 'third_party_licenses'),
);

const packageLock = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
);

for (const packageRecord of collectProductionPackages(packageLock)) {
  const packageRoot = path.join(repositoryRoot, ...packageRecord.location.split('/'));
  const packageMetadata = JSON.parse(
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  if (
    packageMetadata.name !== packageRecord.name ||
    packageMetadata.version !== packageRecord.version
  ) {
    throw new Error(
      `Installed package does not match lockfile: ${packageRecord.name}@${packageRecord.version}`,
    );
  }
  const packageLabel = `${packageRecord.name}@${packageRecord.version} (${packageRecord.location})`;
  const declaredLicense = getDeclaredLicense(packageMetadata, packageLabel);
  if (packageRecord.license && packageRecord.license !== declaredLicense) {
    throw new Error(`Installed package license does not match lockfile: ${packageLabel}`);
  }

  const attributionFiles = await collectPackageAttributionFiles(packageRoot);
  if (!attributionFiles.some(isLicenseFilePath)) {
    throw new Error(`Production package has no license file: ${packageLabel}`);
  }

  const destination = path.join(distRoot, getPackageLicenseDirectory(packageRecord));
  await mkdir(destination, { recursive: true });
  await Promise.all(attributionFiles.map(async relativePath => {
    const target = path.join(destination, ...relativePath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(packageRoot, ...relativePath.split('/')), target);
  }));
}

async function copyCanonicalTextDirectory(sourceDirectory, targetDirectory) {
  await mkdir(targetDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const source = path.join(sourceDirectory, entry.name);
    const target = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyCanonicalTextDirectory(source, target);
    } else if (entry.isFile()) {
      await copyCanonicalTextFile(source, target);
    } else {
      throw new Error(`Unsupported repository attribution entry: ${entry.name}`);
    }
  }
}

async function copyCanonicalTextFile(source, target) {
  const contents = await readFile(source, 'utf8');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents.replace(/\r\n?/g, '\n'), 'utf8');
}
