import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("release metadata, permissions, and license stay coherent", async () => {
  const [packageSource, manifestSource, licenseSource, prdSource] =
    await Promise.all([
      readRepositoryFile("package.json"),
      readRepositoryFile("public/manifest.json"),
      readRepositoryFile("LICENSE"),
      readRepositoryFile("docs/PRD.md"),
    ]);
  const packageJson = JSON.parse(packageSource) as {
    name: string;
    version: string;
    license?: string;
    dependencies: Record<string, string>;
  };
  const manifest = JSON.parse(manifestSource) as {
    version: string;
    version_name: string;
    permissions: string[];
  };

  assert.equal(packageJson.name, "bili-bill");
  assert.equal(packageJson.version, manifest.version_name);
  assert.equal(manifest.version, packageJson.version.replace(/-alpha$/, ""));
  assert.equal(packageJson.license, "MIT");
  assert.match(licenseSource, /^MIT License/m);
  assert.match(licenseSource, /Bili-Bill contributors/);
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.match(prdSource, /不申请 `cookies` 权限/);
});

test("the supported ECharts 6 word-cloud integration is registered", async () => {
  const [packageSource, registrySource, preferenceSource] = await Promise.all([
    readRepositoryFile("package.json"),
    readRepositoryFile("src/shared/echarts/register.ts"),
    readRepositoryFile("dashboard/modules/preference/PreferencePage.tsx"),
  ]);
  const packageJson = JSON.parse(packageSource) as {
    dependencies: Record<string, string>;
  };

  assert.match(packageJson.dependencies.echarts, /^\^6\.1\./);
  assert.equal(
    packageJson.dependencies["@echarts-x/custom-word-cloud"],
    "^1.0.1",
  );
  assert.equal(packageJson.dependencies["echarts-wordcloud"], undefined);
  assert.match(registrySource, /@echarts-x\/custom-word-cloud/);
  assert.match(registrySource, /CustomChart/);
  assert.match(preferenceSource, /type: 'custom'/);
  assert.match(preferenceSource, /renderItem: 'wordCloud'/);
  assert.ok(!preferenceSource.includes("type: 'wordCloud'"));
});
