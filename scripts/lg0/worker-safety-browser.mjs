import { LearningWorkerClient } from "./worker-client.mjs";
import { fixture } from "./fixtures.mjs";
import { encodeBackup } from "./learning-lab.mjs";

let client;
let name;
let incoming;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok, reason) => { if (!ok) throw new Error(reason); };

async function connect(databaseName) {
  client?.dispose();
  name = databaseName;
  client = new LearningWorkerClient("/worker.js", name);
  await client.ready;
}

globalThis.safety = {
  async setup(databaseName) {
    await connect(databaseName);
    const file = await client.request("fixture", { scenario: "typical" });
    await client.request("restore", { file, epoch: 0 });
    const changed = fixture("typical");
    changed.forEach(row => { row.personal.note += " changed incoming content"; });
    incoming = new Blob([await encodeBackup(changed)]);
    return client.request("state");
  },
  async reopen(databaseName) {
    await connect(databaseName);
    return client.request("state");
  },
  async cancel(command, phaseToCancel) {
    const before = await client.request("state");
    const file = await client.request("fixture", { scenario: "single-large" });
    const phases = [];
    const controller = new AbortController();
    let requested;
    let error;
    const start = performance.now();
    try {
      await client.request(command, { file, epoch: before.epoch }, {
        signal: controller.signal,
        onPhase: phase => {
          phases.push({ phase, elapsedMs: performance.now() - start });
          if (phase === phaseToCancel && requested === undefined) {
            requested = performance.now();
            controller.abort();
          }
        },
      });
    } catch (failure) { error = failure.message; }
    const acknowledged = performance.now();
    check(requested !== undefined && error === "cancelled", "cancel_not_observed");
    const after = await client.request("state");
    await delay(Math.max(0, requested + 2100 - performance.now()));
    const later = await client.request("state");
    check(same(before, after) && same(before, later), "cancel_late_write");
    return { command, phaseToCancel, phases, error,
      acknowledgementMs: acknowledged - requested,
      afterCheckMs: performance.now() - requested, stateUnchanged: true };
  },
  startInterruption(phaseToHold) {
    globalThis.interruptionPhase = null;
    globalThis.interruptionOutcome = null;
    void client.request("restore", { file: incoming, epoch: 0, holdAfterWrite: phaseToHold === "written" }, {
      onPhase: phase => {
        if (phase === phaseToHold) globalThis.interruptionPhase = phase;
      },
    }).then(result => { globalThis.interruptionOutcome = result; },
      error => { globalThis.interruptionOutcome = { error: error.message }; });
  },
  async quota() {
    const before = await client.request("state");
    const rows = fixture("single-large");
    rows[0].id = "f".repeat(64);
    // Deterministic, low-compression input for browser quota accounting.
    const bytes = new Uint8Array(9 * 1024 * 1024);
    let seed = 0x140927;
    for (let i = 0; i < bytes.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes[i] = 65 + (seed >>> 24) % 26;
    }
    rows[0].personal.note = new TextDecoder().decode(bytes);
    const file = new Blob([await encodeBackup(rows)]);
    let error;
    let errorName;
    try { await client.request("restore", { file, epoch: before.epoch }); }
    catch (failure) { error = failure.message; errorName = failure.name; }
    const after = await client.request("state");
    check(errorName === "QuotaExceededError" || /quota/i.test(error ?? ""), `browser_quota_not_enforced:${errorName ?? "none"}:${error ?? "write_succeeded"}`);
    check(same(before, after), "quota_partial_write");
    return { errorName, reason: error, fileBytes: file.size, stateUnchanged: true, before, after };
  },
  async recover() {
    const before = await client.request("state");
    const restored = await client.request("restore", { file: incoming, epoch: before.epoch });
    const after = await client.request("state");
    check(restored.count === 60 && after.count === 60, "post_fault_restore_failed");
    await client.request("restore", { file: incoming, epoch: before.epoch });
    check(same(after, await client.request("state")), "post_fault_not_idempotent");
    return { restoredCount: 60, idempotent: true, state: after };
  },
  async restoreInput(text) {
    const before = await client.request("state");
    const file = new Blob([text]);
    let error;
    const start = performance.now();
    try { await client.request("restore", { file, epoch: before.epoch }); }
    catch (failure) { error = failure.message; }
    const elapsedMs = performance.now() - start;
    check(Boolean(error) && same(before, await client.request("state")), "invalid_input_changed_state");
    return { error, elapsedMs, fileBytes: file.size, stateUnchanged: true };
  },
  dispose() { client?.dispose(); },
};
