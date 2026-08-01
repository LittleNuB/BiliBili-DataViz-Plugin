import { cp, copyFile, mkdir, readFile } from 'node:fs/promises';
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
