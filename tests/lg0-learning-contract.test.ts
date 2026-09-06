import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ASSETS,
  MAX_BYTES,
  MAX_FILE_BYTES,
  canonical,
  logicalBytes,
  validateAssets,
  encodeBackup,
  decodeBackup,
  mergeAssets,
  assertCapture,
  openLab,
  readState,
  change,
  clearKnowledge,
  search,
  saveCapture,
  editPersonal,
} from "../scripts/lg0/learning-lab.mjs";
import { asset, fixture } from "../scripts/lg0/fixtures.mjs";
import { seedLegacy, legacySnapshot } from "../scripts/lg0/legacy-fixture.mjs";
import Dexie from "dexie";

test("LG-0 exact byte and count boundaries include inline sources and metadata", () => {
  const rows = fixture("byte-limit");
  assert.equal(logicalBytes(rows), MAX_BYTES);
  validateAssets(rows);
  rows[0].personal.note += "a";
  assert.throws(() => validateAssets(rows), /capacity_bytes/);
  const count = fixture("count-limit");
  assert.equal(count.length, MAX_ASSETS);
  validateAssets(count);
  count.push(asset(1001));
  assert.throws(() => validateAssets(count), /capacity_count/);
});

test("LG-0 UTF-8 counts CJK, astral characters, escapes and source snapshots", () => {
  const rows = [asset(1, { note: '\u4e2d\u6587\ud83d\ude80\n"\\' })];
  assert.equal(logicalBytes(rows), Buffer.byteLength(canonical(rows)));
  const refs = fixture("references");
  assert.ok(logicalBytes(refs) > logicalBytes([asset(1)]));
});

test("LG-0 backup round trip is canonical, bounded and format-separated", async () => {
  const rows = fixture("byte-limit");
  const text = encodeBackup(rows);
  assert.equal(Buffer.byteLength(text), MAX_FILE_BYTES);
  assert.deepEqual(await decodeBackup(new Blob([text])), rows);
  let touched = false;
  await assert.rejects(
    decodeBackup({
      size: MAX_FILE_BYTES + 1,
      arrayBuffer() {
        touched = true;
      },
    }),
    /file_size/,
  );
  assert.equal(touched, false);
  for (const text of [
    "{}",
    "PK zip",
    '{"format":"other"}',
    encodeBackup([]) + " ",
    encodeBackup([]).replace('"version":1', '"version":2'),
  ]) {
    await assert.rejects(decodeBackup(new Blob([text])));
  }
  await assert.rejects(decodeBackup(new Blob([new Uint8Array([0xff])])));
});

test("LG-0 rejects unknown fields, duplicate identities and invalid nested evidence", () => {
  const row = asset(1);
  assert.throws(
    () => validateAssets([{ ...row, provider: "unexpected" }]),
    /fields/,
  );
  assert.throws(() => validateAssets([row, row]), /duplicate_id/);
  const excerpt = fixture("references")[0];
  excerpt.snapshot.citations[0].toMs = -1;
  assert.throws(() => validateAssets([excerpt]), /range/);
  assert.throws(() => validateAssets([{ ...row, id: "__proto__" }]), /id/);
  assert.throws(
    () =>
      validateAssets([
        { ...row, personal: { ...row.personal, tags: ["a", "a"] } },
      ]),
    /tags/,
  );
});

test("LG-0 conflict copies preserve local edits and repeated import is idempotent", async () => {
  const local = asset(1, { note: "local" });
  const incoming = asset(1, { note: "incoming" });
  const first = await mergeAssets([local], [incoming]);
  assert.equal(first.length, 2);
  assert.deepEqual(
    first.find((x) => x.id === local.id),
    local,
  );
  const copy = first.find((x) => x.id !== local.id);
  copy.personal.note = "edited imported copy";
  const second = await mergeAssets(first, [incoming]);
  assert.deepEqual(second, first);
  assert.equal((await mergeAssets([local], [local])).length, 1);
  assert.deepEqual(await decodeBackup(new Blob([encodeBackup(first)])), first);
});

test("LG-0 capture requires exact current part, source and validated answer body", () => {
  const row = fixture("references")[0];
  const evidence = {
    bvid: row.video.bvid,
    part: row.part,
    source: row.snapshot.source,
    spans: row.snapshot.citations,
  };
  assertCapture(row, evidence);
  assert.throws(
    () => assertCapture(row, { ...evidence, part: { cid: "999", page: 2 } }),
    /stale_capture/,
  );
  assert.throws(
    () => assertCapture(row, { ...evidence, spans: [] }),
    /citation/,
  );
  const answer = structuredClone(row);
  answer.kind = "answer";
  answer.snapshot.origin = "answer";
  answer.snapshot.body = "validated whole answer";
  assert.throws(() => assertCapture(answer, evidence), /answer/);
  assertCapture(answer, {
    ...evidence,
    validated: {
      origin: "answer",
      body: answer.snapshot.body,
      citations: answer.snapshot.citations,
    },
  });
  assertCapture(asset(1), null);
});

test("LG-0 serialized CAS protects concurrent writes, capacity and stale clear epochs", async () => {
  const db = await openLab("lg0-test-concurrency");
  try {
    await Promise.all([
      change(db, 0, (rows) => [...rows, asset(1)]),
      change(db, 0, (rows) => [...rows, asset(2)]),
    ]);
    assert.equal((await readState(db)).assets.length, 2);
    await clearKnowledge(db);
    await assert.rejects(
      change(db, 0, () => [asset(3)]),
      /stale_epoch/,
    );
    const epoch = (await readState(db)).meta.epoch;
    await change(db, epoch, () => fixture("count-limit").slice(0, 999));
    const results = await Promise.allSettled([
      change(db, epoch, (rows) => [...rows, asset(1000)]),
      change(db, epoch, (rows) => [...rows, asset(1001)]),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await readState(db)).assets.length, MAX_ASSETS);
    await change(db, epoch, (rows) => rows.filter((x) => x.id !== asset(1).id));
    await change(db, epoch, (rows) => [...rows, asset(2000)]);
    assert.equal((await readState(db)).assets.length, MAX_ASSETS);
  } finally {
    await db.delete();
  }
});

test("LG-0 cancellation and injected abort/quota errors have zero partial writes", async () => {
  const db = await openLab("lg0-test-faults");
  try {
    await change(db, 0, () => [asset(1)]);
    const before = await readState(db);
    for (const fault of ["abort", "quota"]) {
      await assert.rejects(change(db, 0, () => [asset(2)], { fault }));
      assert.deepEqual(await readState(db), before);
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      change(db, 0, () => [asset(2)], { signal: controller.signal }),
      /cancelled/,
    );
    await assert.rejects(
      decodeBackup(new Blob([encodeBackup([asset(2)])]), {
        signal: controller.signal,
      }),
      /cancelled/,
    );
    assert.deepEqual(await readState(db), before);
    db.close();
    await db.open();
    assert.deepEqual(await readState(db), before);
  } finally {
    await db.delete();
  }
});

test("LG-0 search uses saved fields, AND terms, filters and current committed state", async () => {
  const db = await openLab("lg0-test-search");
  try {
    await change(db, 0, () => [
      asset(1, { note: "\u4e2d\u6587 Alpha" }),
      asset(2),
    ]);
    assert.equal((await search(db, "\u4e2d\u6587 alpha")).length, 1);
    assert.equal((await search(db, "not-present")).length, 0);
    assert.equal((await search(db, "alpha", { kind: "bookmark" })).length, 0);
    await change(db, 0, (rows) => rows.filter((x) => x.id !== asset(1).id));
    assert.equal((await search(db, "alpha")).length, 0);
  } finally {
    await db.delete();
  }
});

test("LG-0 actual v13 schema fixture survives additive upgrade and failed upgrade", async () => {
  const name = "lg0-test-upgrade";
  const legacy = await seedLegacy(name);
  await assert.rejects(
    openLab(name, legacy.stores, { failUpgrade: true }),
    /injected_upgrade_failure/,
  );
  const old = new Dexie(name);
  await old.open();
  assert.equal(old.verno, 13);
  assert.equal(
    await legacySnapshot(old, Object.keys(legacy.stores)),
    legacy.before,
  );
  old.close();
  const db = await openLab(name, legacy.stores);
  try {
    assert.equal(db.verno, 14);
    await change(db, 0, () => [asset(1)]);
    assert.equal(
      await legacySnapshot(db, Object.keys(legacy.stores)),
      legacy.before,
    );
  } finally {
    await db.delete();
  }
});

test("LG-0 user edits cannot replace immutable snapshot and duplicate saves reuse identity", async () => {
  const db = await openLab("lg0-test-capture");
  try {
    const row = fixture("references")[0];
    const proof = {
      bvid: row.video.bvid,
      part: row.part,
      source: row.snapshot.source,
      spans: row.snapshot.citations,
    };
    await saveCapture(db, 0, row, () => proof);
    await saveCapture(db, 0, row, () => proof);
    assert.equal((await readState(db)).assets.length, 1);
    await editPersonal(db, 0, row.id, { ...row.personal, note: "edited" }, 2);
    assert.deepEqual((await readState(db)).assets[0].snapshot, row.snapshot);
    const bad = { ...row.personal, snapshot: null };
    await assert.rejects(editPersonal(db, 0, row.id, bad, 3), /fields/);
    const fresh = { ...row, id: "b".repeat(64) };
    await assert.rejects(
      saveCapture(db, 0, fresh, () => proof, {
        onPhase() {
          proof.part = { cid: "444", page: 4 };
        },
      }),
      /stale_capture/,
    );
    assert.equal((await readState(db)).assets.length, 1);
  } finally {
    await db.delete();
  }
});
