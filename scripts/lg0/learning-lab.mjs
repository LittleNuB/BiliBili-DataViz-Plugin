import Dexie from "dexie";

export const MAX_ASSETS = 1_000;
export const MAX_BYTES = 10_485_760;
export const FORMAT = "bili-bill-learning";
const encoder = new TextEncoder();
const PREFIX = `{"assets":`;
const SUFFIX = `,"format":"${FORMAT}","version":1}`;
export const MAX_FILE_BYTES =
  MAX_BYTES + encoder.encode(PREFIX + SUFFIX).length;
const HASH = /^[a-f0-9]{64}$/;
const TYPES = ["note", "bookmark", "excerpt", "answer"];

function requireValue(ok, code) {
  if (!ok) throw new Error(code);
}
function keys(value, fields) {
  requireValue(
    value && typeof value === "object" && !Array.isArray(value),
    "fields",
  );
  requireValue(
    Object.keys(value).sort().join(",") === [...fields].sort().join(","),
    "fields",
  );
}
function string(value, max = MAX_BYTES) {
  requireValue(
    typeof value === "string" && value.length <= max && value.isWellFormed(),
    "string",
  );
}
function integer(value, min = 0) {
  requireValue(Number.isSafeInteger(value) && value >= min, "integer");
}
function hash(value) {
  requireValue(typeof value === "string" && HASH.test(value), "id");
}
function part(value) {
  keys(value, ["cid", "page"]);
  requireValue(
    typeof value.cid === "string" && /^[1-9][0-9]{0,19}$/.test(value.cid),
    "cid",
  );
  integer(value.page, 1);
}

// Canonical JSON: lexicographic object keys, caller-ordered arrays, no whitespace.
// Only call on the fixed-depth, whitelisted schema after validation at ingress.
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
function ordered(rows) {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function logicalBytes(rows) {
  return encoder.encode(canonical(ordered(rows))).length;
}

export function validateAsset(row) {
  keys(row, [
    "id",
    "kind",
    "createdAt",
    "updatedAt",
    "video",
    "part",
    "personal",
    "snapshot",
    "bookmarkMs",
    "importedFrom",
  ]);
  hash(row.id);
  requireValue(TYPES.includes(row.kind), "kind");
  integer(row.createdAt);
  integer(row.updatedAt, row.createdAt);
  keys(row.video, ["bvid", "title"]);
  requireValue(
    typeof row.video.bvid === "string" &&
      /^BV[a-zA-Z0-9]{10}$/.test(row.video.bvid),
    "bvid",
  );
  string(row.video.title, 4096);
  if (row.part !== null) part(row.part);
  keys(row.personal, ["title", "note", "tags"]);
  string(row.personal.title, 4096);
  string(row.personal.note);
  requireValue(
    Array.isArray(row.personal.tags) && row.personal.tags.length <= 64,
    "tags",
  );
  row.personal.tags.forEach((tag) => string(tag, 256));
  requireValue(
    new Set(row.personal.tags).size === row.personal.tags.length,
    "tags",
  );
  if (row.importedFrom !== null) {
    keys(row.importedFrom, ["id", "digest"]);
    hash(row.importedFrom.id);
    hash(row.importedFrom.digest);
  }
  if (row.kind === "bookmark") {
    requireValue(row.part !== null, "bookmark_part");
    integer(row.bookmarkMs);
  } else requireValue(row.bookmarkMs === null, "bookmark");
  if (row.kind === "note" || row.kind === "bookmark") {
    requireValue(row.snapshot === null, "snapshot");
    return;
  }
  requireValue(row.part !== null, "source_part");
  keys(row.snapshot, ["origin", "body", "source", "citations"]);
  const snapshot = row.snapshot;
  requireValue(
    (row.kind === "answer" && snapshot.origin === "answer") ||
      (row.kind === "excerpt" &&
        ["subtitle", "summary", "highlights"].includes(snapshot.origin)),
    "origin",
  );
  string(snapshot.body);
  requireValue(snapshot.body.length > 0, "body");
  keys(snapshot.source, ["kind", "hash"]);
  requireValue(["bilibili", "local"].includes(snapshot.source.kind), "source");
  hash(snapshot.source.hash);
  requireValue(
    Array.isArray(snapshot.citations) &&
      snapshot.citations.length > 0 &&
      snapshot.citations.length <= 4096,
    "citations",
  );
  for (const span of snapshot.citations) {
    keys(span, ["fromMs", "toMs", "text"]);
    requireValue(
      Number.isSafeInteger(span.fromMs) &&
        span.fromMs >= 0 &&
        Number.isSafeInteger(span.toMs) &&
        span.toMs > span.fromMs,
      "range",
    );
    string(span.text);
    requireValue(span.text.length > 0, "citation_text");
  }
}

export function validateAssets(rows) {
  requireValue(
    Array.isArray(rows) && rows.length <= MAX_ASSETS,
    "capacity_count",
  );
  const ids = new Set();
  for (const row of rows) {
    validateAsset(row);
    requireValue(!ids.has(row.id), "duplicate_id");
    ids.add(row.id);
  }
  const bytes = logicalBytes(rows);
  requireValue(bytes <= MAX_BYTES, "capacity_bytes");
  return bytes;
}

export function assertCapture(row, evidence) {
  validateAsset(row);
  if (row.kind === "note") return;
  requireValue(
    evidence &&
      row.video.bvid === evidence.bvid &&
      canonical(row.part) === canonical(evidence.part),
    "stale_capture",
  );
  if (row.kind === "bookmark") {
    requireValue(
      evidence.positionMs === row.bookmarkMs &&
        row.bookmarkMs <= evidence.durationMs,
      "bookmark_position",
    );
    return;
  }
  requireValue(
    canonical(row.snapshot.source) === canonical(evidence.source),
    "stale_capture",
  );
  requireValue(
    row.snapshot.citations.every((span) =>
      evidence.spans.some((current) => canonical(span) === canonical(current)),
    ),
    "citation",
  );
  if (row.snapshot.origin === "subtitle") {
    requireValue(
      row.snapshot.body ===
        row.snapshot.citations.map((span) => span.text).join("\n"),
      "excerpt_body",
    );
  } else {
    requireValue(
      evidence.validated &&
        canonical(evidence.validated) ===
          canonical({
            origin: row.snapshot.origin,
            body: row.snapshot.body,
            citations: row.snapshot.citations,
          }),
      "unvalidated_answer",
    );
  }
}

export function encodeBackup(rows) {
  validateAssets(rows);
  return PREFIX + canonical(ordered(rows)) + SUFFIX;
}
function cancelled(signal) {
  requireValue(!signal?.aborted, "cancelled");
}
export async function decodeBackup(file, { signal } = {}) {
  cancelled(signal);
  requireValue(
    Number.isSafeInteger(file.size) &&
      file.size >= 0 &&
      file.size <= MAX_FILE_BYTES,
    "file_size",
  );
  const bytes = await file.arrayBuffer();
  cancelled(signal);
  requireValue(bytes.byteLength === file.size, "file_size");
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const data = JSON.parse(text);
  keys(data, ["format", "version", "assets"]);
  requireValue(data.format === FORMAT && data.version === 1, "format");
  validateAssets(data.assets);
  // Exact encoding also rejects duplicate JSON keys, reordered assets and padded files.
  requireValue(encodeBackup(data.assets) === text, "noncanonical_backup");
  cancelled(signal);
  return data.assets;
}

async function sha256(text) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(text)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function mergeAssets(local, incoming) {
  validateAssets(local);
  validateAssets(incoming);
  const result = new Map(local.map((row) => [row.id, structuredClone(row)]));
  for (const row of ordered(incoming)) {
    const current = result.get(row.id);
    if (!current) {
      result.set(row.id, structuredClone(row));
      continue;
    }
    if (canonical(current) === canonical(row)) continue;
    const digest = await sha256(canonical(row));
    const id = await sha256("lg0-import:" + row.id + ":" + digest);
    const importedFrom = { id: row.id, digest };
    const existing = result.get(id);
    if (existing) {
      requireValue(
        canonical(existing.importedFrom) === canonical(importedFrom),
        "import_identity_collision",
      );
      continue;
    }
    result.set(id, { ...structuredClone(row), id, importedFrom });
  }
  const rows = ordered([...result.values()]);
  validateAssets(rows);
  return rows;
}

export async function saveCapture(db, epoch, row, evidence, options = {}) {
  // Capture is checked both before work and immediately before commit. Production
  // adapters must supply live evidence, never a backup snapshot as current proof.
  const captured = structuredClone(row);
  assertCapture(captured, evidence());
  return change(
    db,
    epoch,
    (rows) => {
      assertCapture(captured, evidence());
      const existing = rows.find((item) => item.id === captured.id);
      if (existing) {
        requireValue(
          canonical(existing) === canonical(captured),
          "save_identity_conflict",
        );
        return rows;
      }
      return [...rows, captured];
    },
    { ...options, beforeWrite: () => assertCapture(captured, evidence()) },
  );
}

export async function editPersonal(db, epoch, id, personal, updatedAt) {
  return change(db, epoch, (rows) => {
    requireValue(
      rows.some((row) => row.id === id),
      "not_found",
    );
    return rows.map((row) =>
      row.id === id
        ? { ...row, personal: structuredClone(personal), updatedAt }
        : row,
    );
  });
}

export async function openLab(
  name,
  legacyStores = {},
  { failUpgrade = false } = {},
) {
  requireValue(
    typeof name === "string" && /^lg0-[a-zA-Z0-9-]+$/.test(name),
    "lab_database_only",
  );
  const db = new Dexie(name);
  if (Object.keys(legacyStores).length) db.version(13).stores(legacyStores);
  db.version(14)
    .stores({ lgAssets: "id", lgMeta: "key" })
    .upgrade(() => {
      if (failUpgrade) throw new Error("injected_upgrade_failure");
    });
  await db.open();
  return db;
}
export async function readState(db) {
  return db.transaction("r", db.lgAssets, db.lgMeta, async () => ({
    assets: await db.lgAssets.toArray(),
    meta: (await db.lgMeta.get("state")) ?? {
      key: "state",
      epoch: 0,
      revision: 0,
    },
  }));
}

// Expensive validation/hash work stays outside IDB; revision CAS retries prevent
// lost updates and capacity races, while the caller's epoch fences cleared drafts.
export async function change(db, epoch, transform, options = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    cancelled(options.signal);
    const before = await readState(db);
    requireValue(before.meta.epoch === epoch, "stale_epoch");
    const rows = ordered(await transform(structuredClone(before.assets)));
    validateAssets(rows);
    cancelled(options.signal);
    options.onPhase?.("committing");
    cancelled(options.signal);
    const applied = await db.transaction(
      "rw",
      db.lgAssets,
      db.lgMeta,
      async () => {
        const current = (await db.lgMeta.get("state")) ?? {
          key: "state",
          epoch: 0,
          revision: 0,
        };
        requireValue(current.epoch === epoch, "stale_epoch");
        if (current.revision !== before.meta.revision) return false;
        options.beforeWrite?.();
        integer(current.revision + 1);
        await db.lgAssets.clear();
        await db.lgAssets.bulkPut(rows);
        if (options.fault === "abort") throw new Error("injected_abort");
        if (options.fault === "quota")
          throw new DOMException("injected_quota", "QuotaExceededError");
        await db.lgMeta.put({ ...current, revision: current.revision + 1 });
        return true;
      },
    );
    if (applied) {
      options.onPhase?.("committed");
      return rows;
    }
  }
  throw new Error("busy_retry");
}
export async function clearKnowledge(db) {
  await db.transaction("rw", db.lgAssets, db.lgMeta, async () => {
    const current = (await db.lgMeta.get("state")) ?? {
      key: "state",
      epoch: 0,
      revision: 0,
    };
    integer(current.epoch + 1);
    integer(current.revision + 1);
    await db.lgAssets.clear();
    await db.lgMeta.put({
      key: "state",
      epoch: current.epoch + 1,
      revision: current.revision + 1,
    });
  });
}

export async function search(db, query, filters = {}) {
  string(query, 256);
  const terms = query
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const { assets } = await readState(db);
  return assets
    .filter((row) => {
      if (filters.kind && row.kind !== filters.kind) return false;
      if (filters.bvid && row.video.bvid !== filters.bvid) return false;
      const fields = [
        row.personal.title,
        row.personal.note,
        ...row.personal.tags,
        row.video.title,
        row.snapshot?.body ?? "",
        ...(row.snapshot?.citations.map((span) => span.text) ?? []),
      ].map((text) => text.normalize("NFKC").toLowerCase());
      return terms.every((term) =>
        fields.some((field) => field.includes(term)),
      );
    })
    .map((row) => row.id)
    .sort();
}
