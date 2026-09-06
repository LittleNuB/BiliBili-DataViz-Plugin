import {
  openLab,
  readState,
  decodeBackup,
  encodeBackup,
  restore,
  clearKnowledge,
  search,
  logicalBytes,
  canonical,
} from "./learning-lab.mjs";
import { fixture } from "./fixtures.mjs";

let db;
let active;

async function execute(command, payload, job) {
  if (command === "init") {
    if (db) throw new Error("already_initialized");
    db = await openLab(payload.name);
    return { ready: true };
  }
  if (!db) throw new Error("not_initialized");
  if (command === "fixture") {
    // Synthetic lab input only; this worker is not a production entry point.
    return new Blob([await encodeBackup(fixture(payload.scenario))]);
  }
  if (command === "restore") {
    postMessage({ id: job.id, phase: "parsing" });
    const incoming = await decodeBackup(payload.file, {
      signal: job.controller.signal,
    });
    const rows = await restore(db, payload.epoch, incoming, {
      signal: job.controller.signal,
      beforeCommit: () =>
        new Promise((resolve) => {
          job.resume = resolve;
          postMessage({ id: job.id, phase: "prepared" });
        }),
      onPhase: (phase) => postMessage({ id: job.id, phase }),
    });
    return { count: rows.length };
  }
  if (command === "export") {
    const { assets } = await readState(db);
    return new Blob([await encodeBackup(assets)]);
  }
  if (command === "state") {
    const { assets, meta } = await readState(db);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical(assets)),
    );
    return {
      ...meta,
      count: assets.length,
      bytes: logicalBytes(assets),
      digest: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    };
  }
  if (command === "clear") {
    await clearKnowledge(db);
    return { cleared: true };
  }
  if (command === "search") return search(db, payload.query, payload.filters);
  throw new Error("unknown_command");
}

self.onmessage = async ({ data }) => {
  const { id, command, payload } = data;
  if (command === "cancel" || command === "resume") {
    if (active?.id === id) {
      if (command === "cancel") active.controller.abort();
      else {
        active.resume?.();
        active.resume = null;
      }
    }
    return;
  }
  if (active) {
    postMessage({ id, error: "busy" });
    return;
  }
  const job = { id, controller: new AbortController() };
  active = job;
  try {
    const result = await execute(command, payload ?? {}, job);
    postMessage({ id, result });
  } catch (error) {
    postMessage({ id, error: error.message });
  } finally {
    active = null;
  }
};
