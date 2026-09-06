import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  B1_ARTIFACT_PATHS,
  describeHistoricalB1Result,
  readB1HistoryInputs,
  removeB1HistoryWorkspace,
  verifyHistoricalB1,
} from "../scripts/verify-gate-014-b1-history.mjs";

const execFile = promisify(execFileCallback);
const run = (file, args, cwd) =>
  execFile(file, args, {
    cwd,
    windowsHide: true,
    encoding: "buffer",
  });
const git = async (root, ...args) =>
  (await run("git", args, root)).stdout.toString().trim();

async function fixture(t) {
  const parent = await realpath("release-artifacts");
  const root = await mkdtemp(path.join(parent, "b1-history-test-"));
  t.after(async () => {
    const actual = await realpath(root);
    assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith("b1-history-test-"));
    await rm(actual, { recursive: true, maxRetries: 3 });
  });
  await git(root, "init");
  await git(root, "config", "user.name", "B1 Test");
  await git(root, "config", "user.email", "b1@example.invalid");
  await git(root, "config", "commit.gpgsign", "false");
  await git(root, "config", "core.autocrlf", "false");
  await mkdir(path.join(root, "docs/benchmarks"), { recursive: true });
  await writeFile(path.join(root, B1_ARTIFACT_PATHS[3]), "older report\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "historical source");
  const historicalCommit = await git(root, "rev-parse", "HEAD");
  const environment = {
    contract: "gate-014-b1-environment-v1",
    repositoryCommitSha: historicalCommit,
  };
  for (const relative of B1_ARTIFACT_PATHS) {
    await writeFile(
      path.join(root, relative),
      relative === B1_ARTIFACT_PATHS[0]
        ? JSON.stringify(environment) + "\n"
        : "published report\n",
    );
  }
  await git(root, "add", ".");
  await git(root, "commit", "-m", "publish receipts");
  return { root, historicalCommit, environment };
}

function legacy(input, extra = {}) {
  return {
    status: "pass",
    currentArtifactBindingsVerified: true,
    gateStatus: "pass",
    operationCount: 4680,
    environmentReceiptSha256: input.environmentReceiptSha256,
    ...extra,
  };
}

async function controlledRun(root, input, onCommand = async () => {}) {
  const commands = [];
  const execute = async (file, args, cwd) => {
    if (file === "git") return run(file, args, cwd);
    commands.push(args);
    assert.notEqual(cwd, root);
    assert.equal(await git(cwd, "rev-parse", "HEAD"), input.historicalCommit);
    for (const [relative, bytes] of input.artifacts) {
      assert.deepEqual(await readFile(path.join(cwd, relative)), bytes);
    }
    await onCommand(args, cwd);
    return {
      stdout: Buffer.from(JSON.stringify(legacy(input))),
      stderr: Buffer.alloc(0),
    };
  };
  return { commands, execute };
}

await mkdir("release-artifacts", { recursive: true });

test("B1 history reads only committed receipts and resolves their ancestor", async (t) => {
  const { root, historicalCommit } = await fixture(t);
  const input = await readB1HistoryInputs(root);
  assert.equal(input.historicalCommit, historicalCommit);
  assert.equal(input.artifacts.size, 4);
  assert.notEqual(input.currentCommit, historicalCommit);
  assert.match(input.artifactBundleSha256, /^[a-f0-9]{64}$/);
  await writeFile(
    path.join(root, B1_ARTIFACT_PATHS[3]),
    "uncommitted tampering\n",
  );
  await assert.rejects(readB1HistoryInputs(root), /uncommitted B1 artifact/);
  await git(root, "add", ".");
  await assert.rejects(readB1HistoryInputs(root), /uncommitted B1 artifact/);
});

test("B1 history rejects invalid, missing and non-ancestor commits", async (t) => {
  const { root, environment } = await fixture(t);
  const originalHead = await git(root, "rev-parse", "HEAD");
  const tree = await git(root, "rev-parse", "HEAD^{tree}");
  const unrelated = await git(
    root,
    "commit-tree",
    tree,
    "-m",
    "unrelated root",
  );
  for (const revision of ["main", "--help", "f".repeat(40), unrelated]) {
    await writeFile(
      path.join(root, B1_ARTIFACT_PATHS[0]),
      JSON.stringify({ ...environment, repositoryCommitSha: revision }),
    );
    await git(root, "add", ".");
    await git(root, "commit", "-m", "invalid receipt target");
    await assert.rejects(readB1HistoryInputs(root));
  }
  assert.notEqual(await git(root, "rev-parse", "HEAD"), originalHead);
});

test("B1 history preserves a failing historical gate without claiming current performance", () => {
  const input = {
    historicalCommit: "a".repeat(40),
    currentCommit: "b".repeat(40),
    environmentReceiptSha256: "c".repeat(64),
  };
  for (const gateStatus of ["pass", "fail", "insufficient_evidence"]) {
    const result = describeHistoricalB1Result(
      legacy(input, { gateStatus }),
      input,
    );
    assert.equal(result.historicalGateStatus, gateStatus);
    assert.equal(result.currentPerformanceGateStatus, "not_evaluated");
    assert.equal(result.verificationScope, "historical_snapshot");
    assert.equal("currentArtifactBindingsVerified" in result, false);
  }
  for (const extra of [
    { status: "fail" },
    { currentArtifactBindingsVerified: false },
    { environmentReceiptSha256: "d".repeat(64) },
    { gateStatus: "unknown" },
    { operationCount: 0 },
  ]) {
    assert.throws(() =>
      describeHistoricalB1Result(legacy(input, extra), input),
    );
  }
});

test("B1 history rebuilds old checkout with current receipts and leaves caller untouched", async (t) => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, "ui.txt"), "unrelated current UI\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "change current UI");
  const input = await readB1HistoryInputs(root);
  const { execute, commands } = await controlledRun(root, input);
  const result = await verifyHistoricalB1({
    repositoryRoot: root,
    run: execute,
    resolveNpm: async () => ({
      executable: process.execPath,
      arguments: ["npm-cli.js"],
    }),
  });
  assert.deepEqual(commands, [
    ["npm-cli.js", "ci", "--no-audit", "--no-fund"],
    ["npm-cli.js", "run", "build"],
    ["scripts/gate-014-b1-matrix-runner.mjs", "--verify"],
  ]);
  assert.equal(result.temporaryWorkspaceRemoved, true);
  assert.equal(await git(root, "rev-parse", "HEAD"), input.currentCommit);
  assert.equal(
    await git(root, "status", "--porcelain", "--untracked-files=no"),
    "",
  );
  assert.deepEqual(await readdir(path.join(root, "release-artifacts")), []);
});

for (const failure of [
  "install",
  "build",
  "verify",
  "temporary-artifact",
  "current-artifact",
  "current-head",
]) {
  test(`B1 history fails closed and cleans only its checkout after ${failure}`, async (t) => {
    const { root } = await fixture(t);
    const input = await readB1HistoryInputs(root);
    const { execute } = await controlledRun(root, input, async (args, cwd) => {
      if (
        (failure === "install" && args[1] === "ci") ||
        (failure === "build" && args[2] === "build") ||
        (failure === "verify" && args[1] === "--verify")
      )
        throw new Error("controlled failure");
      if (args[1] !== "--verify") return;
      if (failure === "temporary-artifact")
        await writeFile(path.join(cwd, B1_ARTIFACT_PATHS[3]), "changed");
      if (failure === "current-artifact")
        await writeFile(path.join(root, B1_ARTIFACT_PATHS[3]), "changed");
      if (failure === "current-head")
        await git(root, "commit", "--allow-empty", "-m", "concurrent change");
    });
    await assert.rejects(
      verifyHistoricalB1({
        repositoryRoot: root,
        run: execute,
        resolveNpm: async () => ({
          executable: process.execPath,
          arguments: ["npm-cli.js"],
        }),
      }),
      /B1 historical/,
    );
    assert.deepEqual(await readdir(path.join(root, "release-artifacts")), []);
    assert.equal(
      await readFile(path.join(root, B1_ARTIFACT_PATHS[3]), "utf8"),
      failure === "current-artifact" ? "changed" : "published report\n",
    );
  });
}

test("B1 history refuses cleanup of the root or unrelated directories", async (t) => {
  const { root } = await fixture(t);
  const unrelated = path.join(root, "release-artifacts", "keep-me");
  const wrongParent = path.join(root, "b1-history-not-owned");
  await mkdir(unrelated, { recursive: true });
  await mkdir(wrongParent);
  for (const target of [root, path.dirname(root), unrelated, wrongParent]) {
    await assert.rejects(removeB1HistoryWorkspace(root, target));
    assert.equal(await realpath(target), target);
  }
});
