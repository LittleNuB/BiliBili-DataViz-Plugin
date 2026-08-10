import {
  runFixtureLifecycleAfterRestart,
  runFixtureLifecycleBeforeRestart,
  runFixtureSmoke,
} from "./storage-harness.js";

const SMOKE_DATABASE = "gate-014-b1-smoke-v1";

globalThis.runGate014B1Smoke = async () => {
  const heapBefore = readHeapUsedBytes();
  const storageBefore = await readStorageEstimate();
  const database = await openSmokeDatabase();
  let readbackVerified = false;
  try {
    await transactionComplete(database, "readwrite", (store) => {
      store.put({ id: "public-safe-smoke", value: "合成验证" });
    });
    const stored = await requestResult(
      database
        .transaction("rows", "readonly")
        .objectStore("rows")
        .get("public-safe-smoke"),
    );
    readbackVerified = stored?.value === "合成验证";
  } finally {
    database.close();
  }
  const storageAfter = await readStorageEstimate();
  await deleteDatabase(SMOKE_DATABASE);
  const storageCleanup = await readStorageEstimate();
  const heapAfter = readHeapUsedBytes();
  return {
    contract: "gate-014-b1-browser-smoke-v1",
    status: readbackVerified ? "pass" : "fail",
    extensionId: chrome.runtime.id,
    indexedDbAvailable: typeof indexedDB === "object",
    readbackVerified,
    storageEstimateAvailable:
      storageBefore !== null &&
      storageAfter !== null &&
      storageCleanup !== null,
    storageBefore,
    storageAfter,
    storageCleanup,
    heapMetricAvailable: heapBefore !== null && heapAfter !== null,
    heapBefore,
    heapAfter,
    storesSensitiveText: false,
  };
};

globalThis.runGate014B1FixtureSmoke = runFixtureSmoke;
globalThis.runGate014B1FixtureLifecycleBeforeRestart =
  runFixtureLifecycleBeforeRestart;
globalThis.runGate014B1FixtureLifecycleAfterRestart =
  runFixtureLifecycleAfterRestart;

globalThis.runGate014B1LoadedExtensionInventory = async () => {
  if (typeof chrome.management?.getAll !== "function") {
    throw new Error("fixture_extension_inventory_unavailable");
  }
  const extensions = await chrome.management.getAll();
  return extensions.map((extension) => ({
    id: extension.id,
    name: extension.name,
    version: extension.version,
    versionName: extension.versionName ?? null,
    enabled: extension.enabled,
    type: extension.type,
  }));
};

function openSmokeDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SMOKE_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("rows", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("smoke_database_open_failed"));
    request.onblocked = () => reject(new Error("smoke_database_open_blocked"));
  });
}

function transactionComplete(database, mode, enqueue) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("rows", mode);
    enqueue(transaction.objectStore("rows"));
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error("smoke_transaction_aborted"));
    transaction.onerror = () => reject(new Error("smoke_transaction_failed"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("smoke_readback_failed"));
  });
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("smoke_database_cleanup_failed"));
    request.onblocked = () =>
      reject(new Error("smoke_database_cleanup_blocked"));
  });
}

async function readStorageEstimate() {
  if (typeof navigator.storage?.estimate !== "function") {
    return null;
  }
  const estimate = await navigator.storage.estimate();
  if (!Number.isFinite(estimate.usage) || !Number.isFinite(estimate.quota)) {
    return null;
  }
  return {
    usageBytes: Math.round(estimate.usage),
    quotaBytes: Math.round(estimate.quota),
  };
}

function readHeapUsedBytes() {
  const value = performance.memory?.usedJSHeapSize;
  return Number.isFinite(value) ? Math.round(value) : null;
}
