import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const B1_ARTIFACT_PATHS = Object.freeze([
  "docs/benchmarks/gate-014-b1-environment.json",
  "docs/benchmarks/gate-014-b1-raw-operations.jsonl",
  "docs/benchmarks/gate-014-b1-report.json",
  "docs/benchmarks/gate-014-b1-summary.md",
]);
const SHA = /^[a-f0-9]{40}$/;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function execute(file, args, cwd) {
  return execFile(file, args, {
    cwd,
    windowsHide: true,
    encoding: "buffer",
    maxBuffer: MAX_ARTIFACT_BYTES,
    timeout: 15 * 60 * 1000,
    env: { ...process.env, GATE_014_B1_DEBUG: "1" },
  });
}
const stdoutText = (result) => result.stdout.toString("utf8").trim();

function assertWithin(parent, target) {
  const relative = path.relative(parent, target);
  assert.ok(
    relative &&
      !path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep),
    "unsafe history workspace path",
  );
}

export async function readB1HistoryInputs(repositoryRoot, run = execute) {
  const root = await realpath(repositoryRoot);
  const currentCommit = stdoutText(
    await run("git", ["rev-parse", "HEAD"], root),
  );
  assert.match(currentCommit, SHA, "current commit unavailable");
  const artifacts = new Map();
  const bundleHash = createHash("sha256");
  for (const relative of B1_ARTIFACT_PATHS) {
    const file = path.join(root, relative);
    assertWithin(root, await realpath(file));
    const info = await lstat(file);
    assert.ok(
      info.isFile() && info.size <= MAX_ARTIFACT_BYTES,
      "invalid B1 artifact file",
    );
    const bytes = await readFile(file);
    const committed = await run(
      "git",
      ["show", `${currentCommit}:${relative}`],
      root,
    );
    assert.ok(
      bytes.equals(Buffer.from(committed.stdout)),
      `uncommitted B1 artifact: ${relative}`,
    );
    artifacts.set(relative, bytes);
    bundleHash
      .update(relative + "\0")
      .update(bytes)
      .update("\0");
  }
  const environment = JSON.parse(
    artifacts.get(B1_ARTIFACT_PATHS[0]).toString("utf8"),
  );
  assert.equal(environment.contract, "gate-014-b1-environment-v1");
  assert.match(
    environment.repositoryCommitSha,
    SHA,
    "invalid historical commit",
  );
  const historicalCommit = environment.repositoryCommitSha;
  const resolved = stdoutText(
    await run(
      "git",
      [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${historicalCommit}^{commit}`,
      ],
      root,
    ),
  );
  assert.equal(resolved, historicalCommit, "historical commit unavailable");
  await run(
    "git",
    ["merge-base", "--is-ancestor", historicalCommit, currentCommit],
    root,
  );
  return {
    root,
    currentCommit,
    historicalCommit,
    artifacts,
    artifactBundleSha256: bundleHash.digest("hex"),
    environmentReceiptSha256: sha256(artifacts.get(B1_ARTIFACT_PATHS[0])),
  };
}

export function describeHistoricalB1Result(result, input) {
  assert.equal(
    result.status,
    "pass",
    "historical artifact verification did not pass",
  );
  assert.equal(
    result.currentArtifactBindingsVerified,
    true,
    "historical snapshot bindings missing",
  );
  assert.ok(
    ["pass", "fail", "insufficient_evidence"].includes(result.gateStatus),
    "invalid historical gate status",
  );
  assert.ok(
    Number.isSafeInteger(result.operationCount) && result.operationCount > 0,
    "invalid operation count",
  );
  assert.equal(
    result.environmentReceiptSha256,
    input.environmentReceiptSha256,
    "verified a different environment receipt",
  );
  return {
    status: "pass",
    verificationScope: "historical_snapshot",
    historicalCommit: input.historicalCommit,
    currentCommit: input.currentCommit,
    historicalGateStatus: result.gateStatus,
    historicalArtifactBindingsVerified: true,
    currentPerformanceGateStatus: "not_evaluated",
    operationCount: result.operationCount,
    environmentReceiptSha256: result.environmentReceiptSha256,
    artifactBundleSha256: input.artifactBundleSha256,
  };
}

export async function removeB1HistoryWorkspace(root, workspace) {
  const actualRoot = await realpath(root);
  const actual = await realpath(workspace);
  assertWithin(actualRoot, actual);
  assert.equal(
    path.dirname(actual),
    path.join(actualRoot, "release-artifacts"),
  );
  assert.equal(
    actual,
    path.resolve(workspace),
    "history workspace must not be redirected",
  );
  assert.ok(
    path.basename(actual).startsWith("b1-history-"),
    "not an owned history workspace",
  );
  await rm(actual, { recursive: true, maxRetries: 3, retryDelay: 100 });
}

export async function verifyHistoricalB1({
  repositoryRoot = ROOT,
  run = execute,
  resolveNpm,
} = {}) {
  const input = await readB1HistoryInputs(repositoryRoot, run);
  const parent = path.join(input.root, "release-artifacts");
  await mkdir(parent, { recursive: true });
  assert.equal(
    await realpath(parent),
    parent,
    "history workspace parent must not be redirected",
  );
  const workspace = await mkdtemp(path.join(parent, "b1-history-"));
  const checkout = path.join(workspace, "checkout");
  let phase = "checkout";
  let result;
  try {
    // A local object-sharing clone avoids touching the caller's HEAD/index or
    // other worktrees. It never clones browser state or reads personal data.
    await run(
      "git",
      ["clone", "--shared", "--no-checkout", "--", input.root, checkout],
      input.root,
    );
    await run(
      "git",
      ["checkout", "--detach", input.historicalCommit],
      checkout,
    );
    assert.equal(
      stdoutText(await run("git", ["rev-parse", "HEAD"], checkout)),
      input.historicalCommit,
    );
    const artifactDirectory = await realpath(
      path.join(checkout, "docs", "benchmarks"),
    );
    assertWithin(checkout, artifactDirectory);
    // Always verify the PR's artifacts, including when the measured commit
    // predates their publication. Never silently fall back to older reports.
    for (const [relative, bytes] of input.artifacts) {
      const target = path.join(checkout, relative);
      const info = await lstat(target).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      assert.ok(
        !info || info.isFile(),
        "historical artifact target must be a regular file",
      );
      await writeFile(target, bytes);
    }
    const npm = resolveNpm
      ? await resolveNpm()
      : await (
          await import(
            pathToFileURL(
              path.join(input.root, "scripts/gate-014-b1-matrix-runner.mjs"),
            ).href
          )
        ).resolveNpmBuildInvocation();
    phase = "install";
    await run(
      npm.executable,
      [npm.arguments[0], "ci", "--no-audit", "--no-fund"],
      checkout,
    );
    phase = "build";
    await run(npm.executable, [npm.arguments[0], "run", "build"], checkout);
    phase = "verify";
    const verified = await run(
      process.execPath,
      ["scripts/gate-014-b1-matrix-runner.mjs", "--verify"],
      checkout,
    );
    result = describeHistoricalB1Result(
      JSON.parse(stdoutText(verified)),
      input,
    );
    const after = await readB1HistoryInputs(input.root, run);
    assert.equal(
      after.currentCommit,
      input.currentCommit,
      "current HEAD changed during verification",
    );
    assert.equal(
      after.artifactBundleSha256,
      input.artifactBundleSha256,
      "current B1 artifacts changed during verification",
    );
    for (const [relative, bytes] of input.artifacts) {
      assert.ok(
        bytes.equals(await readFile(path.join(checkout, relative))),
        "historical B1 artifacts changed during verification",
      );
    }
  } catch (error) {
    throw new Error(
      `B1 historical ${phase} failed: ${error.code ?? error.message}`,
      { cause: error },
    );
  } finally {
    await removeB1HistoryWorkspace(input.root, workspace);
  }
  return { ...result, temporaryWorkspaceRemoved: true };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyHistoricalB1()
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    })
    .catch((error) => {
      process.stderr.write(error.message + "\n");
      process.exitCode = 1;
    });
}
