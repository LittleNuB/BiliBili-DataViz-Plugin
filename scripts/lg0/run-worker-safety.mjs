import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const runId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8);
const directory = path.join(root, "release-artifacts", "lg0-safety", runId);
await mkdir(directory, { recursive: true });
const report = { kind: "worker-safety", runId, commit: git("rev-parse", "HEAD"),
  sourceRevisionState: git("status", "--porcelain") ? "working-tree-snapshot" : "clean",
  sourceEncoding: "utf8-lf", sources: {}, bundles: {}, cancellations: [],
  formalGateStatus: "not_evaluated", lg1Unlocked: false,
  disclosure: "Isolated synthetic profile; controlled browser quota and renderer crash, not physical disk exhaustion or extension service-worker death.",
};
for (const input of ["learning-lab.mjs", "fixtures.mjs", "learning-worker.mjs", "worker-client.mjs", "worker-safety-browser.mjs", "run-worker-safety.mjs"]) {
  const file = "scripts/lg0/" + input;
  report.sources[file] = sha((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n"));
}
report.sources["package-lock.json"] = sha((await readFile(path.join(root, "package-lock.json"), "utf8")).replace(/\r\n/g, "\n"));
const bundles = {};
for (const [url, entry] of [["/safety.js", "worker-safety-browser.mjs"], ["/worker.js", "learning-worker.mjs"]]) {
  bundles[url] = (await build({ absWorkingDir: root, entryPoints: ["scripts/lg0/" + entry], bundle: true,
    write: false, format: "esm", platform: "browser", target: "chrome152" })).outputFiles[0].contents;
  report.bundles[url] = sha(bundles[url]);
}
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/" ? "text/html" : "text/javascript");
  if (request.url === "/") response.end('<!doctype html><meta charset="utf-8"><title>LG-0 synthetic safety</title><script type="module" src="/safety.js"></script>');
  else if (bundles[request.url]) response.end(bundles[request.url]);
  else { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = path.join(directory, "synthetic-profile");
let context;
let page;
let stage = "launch";
try {
  assert.ok(process.env.LG0_PLAYWRIGHT_MODULE && process.env.LG0_CHROME_EXECUTABLE, "explicit test runtime required");
  const { chromium } = await import(pathToFileURL(process.env.LG0_PLAYWRIGHT_MODULE).href);
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.LG0_CHROME_EXECUTABLE,
    headless: true, args: ["--disable-background-networking", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  await context.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  const open = async () => {
    page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => globalThis.safety);
    return context.newCDPSession(page);
  };
  let cdp = await open();
  report.browser = await cdp.send("Browser.getVersion");
  const databaseName = "lg0-safety-" + randomUUID();
  stage = "setup";
  const before = await page.evaluate(name => safety.setup(name), databaseName);
  stage = "cancellation";
  for (const [command, phase] of [["restore", "parsing"], ["export", "encoding"]]) {
    const result = await page.evaluate(([command, phase]) => safety.cancel(command, phase), [command, phase]);
    report.cancellations.push(result);
    assert.ok(result.acknowledgementMs <= 1000 && result.afterCheckMs >= 2000);
  }
  stage = "renderer-crash-after-write";
  await page.evaluate(() => safety.startInterruption("written"));
  await page.waitForFunction(() => globalThis.interruptionPhase === "written");
  const crashed = page.waitForEvent("crash", { timeout: 15000 });
  void cdp.send("Page.crash").catch(() => {});
  await crashed;
  await page.close();
  cdp = await open();
  const afterCrash = await page.evaluate(name => safety.reopen(name), databaseName);
  assert.deepEqual(afterCrash, before, "renderer crash must rollback writes and preserve full digest");
  report.rendererCrash = { phase: "after-bulkPut-before-meta", eventObserved: true, before, after: afterCrash, completeStateUnchanged: true };
  // Recreate only the public incoming fixture; the existing state must stay put.
  await page.evaluate(name => safety.setup(name), databaseName);
  stage = "browser-quota";
  const usage = await cdp.send("Storage.getUsageAndQuota", { origin });
  const quotaSize = Math.ceil(usage.usage) + 1;
  await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize });
  try {
    // Chromium can approve writes from its 30-second bucket-space cache.
    // This wait belongs to fault setup, not any measured user operation.
    await new Promise(resolve => setTimeout(resolve, 31000));
    const quota = await cdp.send("Storage.getUsageAndQuota", { origin });
    assert.equal(quota.overrideActive, true);
    report.quota = { method: "Storage.overrideQuotaForOrigin", cacheExpiryWaitMs: 31000,
      quotaSize, usageBytes: quota.usage, reportedQuota: quota.quota };
    Object.assign(report.quota, await page.evaluate(() => safety.quota()));
  } finally { await cdp.send("Storage.overrideQuotaForOrigin", { origin }); }
  stage = "recovery";
  report.recovery = await page.evaluate(() => safety.recover());
  await page.close();
  await open();
  const persisted = await page.evaluate(name => safety.reopen(name), databaseName);
  assert.deepEqual(persisted, report.recovery.state);
  report.reopenedFullDigestMatches = true;
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.failureStage = stage;
  report.error = error.message.split("\n")[0];
  process.exitCode = 1;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  const actual = await realpath(profile).catch(() => null);
  if (actual) {
    assert.equal(path.dirname(actual), await realpath(directory));
    assert.equal(path.basename(actual), "synthetic-profile");
    assert.ok(path.relative(root, actual).startsWith(`release-artifacts${path.sep}lg0-safety${path.sep}`));
    await rm(actual, { recursive: true, maxRetries: 8, retryDelay: 250 });
  }
  report.profileRemoved = true;
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ directory, ...report }, null, 2));
}
