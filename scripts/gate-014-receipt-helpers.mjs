export const GATE_014_RECEIPT_HELPER_CONTRACT = 'gate-014-receipt-helper-v1';
export const INSUFFICIENT_EVIDENCE = 'insufficient_evidence';
export const PUBLIC_SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
export const RECEIPT_REASON_CODES = Object.freeze([
  'browser_metric_unavailable',
  'browser_gate_not_run',
  'storage_candidate_not_selected',
  'cleanup_not_required',
  'measurement_interrupted',
  'candidate_not_selected',
]);
export const SENSITIVE_RECEIPT_TOKEN_PATTERN = new RegExp([
  '[A-Z]:\\\\Users\\\\[^\\\\]+',
  ['SESS', 'DATA'].join(''),
  ['bili', '_jct'].join(''),
  ['Dede', 'UserID'].join(''),
  ['Chrome', '\\\\User Data'].join(''),
  ['key', '\\x2e', 'txt'].join(''),
].join('|'), 'i');

export const REUSABLE_RECEIPT_HELPER_DESCRIPTORS = Object.freeze([
  helperDescriptor('createTimingReceipt', [
    'fixtureId',
    'operation',
    'startedAtEpochMs',
    'endedAtEpochMs',
    'durationMs',
    'sampleCount',
  ]),
  helperDescriptor('createMemoryReceipt', [
    'fixtureId',
    'phase',
    'metricAvailable',
    'heapUsedBytes',
    'heapTotalBytes',
    'rssBytes',
    'peakHeapGrowthBytes',
  ]),
  helperDescriptor('createIndexedDbUsageReceipt', [
    'fixtureId',
    'phase',
    'metricAvailable',
    'storageEstimateUsageBytes',
    'storageEstimateQuotaBytes',
    'indexedDbDeltaBytes',
  ]),
  helperDescriptor('createPersistedIndexSizeReceipt', [
    'fixtureId',
    'phase',
    'metricAvailable',
    'managedSourceBytes',
    'persistedIndexBytes',
    'indexToSourceRatioPermille',
  ]),
  helperDescriptor('createRestartReceipt', [
    'fixtureId',
    'scenario',
    'attempted',
    'completed',
    'preRestartCheckpoint',
    'postRestartCheckpoint',
  ]),
  helperDescriptor('createFailureInjectionReceipt', [
    'fixtureId',
    'scenario',
    'injectionPoint',
    'attempted',
    'completed',
    'visibleRowsAfterFailure',
    'cleanupRequired',
    'readbackVerified',
  ]),
  helperDescriptor('createCleanupReadbackReceipt', [
    'fixtureId',
    'operation',
    'beforeFileCount',
    'removedFileCount',
    'afterFileCount',
    'tempFileCountAfterCleanup',
    'finalFileCountAfterCleanup',
    'readbackVerified',
  ]),
]);

export function createTimingReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'operation',
    'startedAtEpochMs',
    'endedAtEpochMs',
    'sampleCount',
  ], 'createTimingReceipt');

  const startedAtEpochMs = assertNonNegativeSafeInteger(input.startedAtEpochMs, 'startedAtEpochMs');
  const endedAtEpochMs = assertNonNegativeSafeInteger(input.endedAtEpochMs, 'endedAtEpochMs');
  if (endedAtEpochMs < startedAtEpochMs) {
    throw new Error('endedAtEpochMs must be greater than or equal to startedAtEpochMs');
  }
  const sampleCount = input.sampleCount === undefined
    ? 1
    : assertNonNegativeSafeInteger(input.sampleCount, 'sampleCount');
  if (sampleCount < 1) {
    throw new Error('sampleCount must be at least 1');
  }

  return freezeReceipt({
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createTimingReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    operation: assertPublicSafeId(input.operation, 'operation'),
    status: 'pass',
    startedAtEpochMs,
    endedAtEpochMs,
    durationMs: endedAtEpochMs - startedAtEpochMs,
    sampleCount,
    storesSensitiveText: false,
  });
}

export function createMemoryReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'phase',
    'metricAvailable',
    'heapUsedBytes',
    'heapTotalBytes',
    'rssBytes',
    'peakHeapGrowthBytes',
    'reasonCode',
  ], 'createMemoryReceipt');

  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createMemoryReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    phase: assertPublicSafeId(input.phase, 'phase'),
    metricAvailable: assertBoolean(input.metricAvailable, 'metricAvailable'),
    storesSensitiveText: false,
  };

  if (!base.metricAvailable) {
    return insufficientReceipt(base, input.reasonCode);
  }

  return freezeReceipt({
    ...base,
    status: 'pass',
    heapUsedBytes: assertNonNegativeSafeInteger(input.heapUsedBytes, 'heapUsedBytes'),
    heapTotalBytes: assertNonNegativeSafeInteger(input.heapTotalBytes, 'heapTotalBytes'),
    rssBytes: assertNonNegativeSafeInteger(input.rssBytes, 'rssBytes'),
    peakHeapGrowthBytes: assertNonNegativeSafeInteger(input.peakHeapGrowthBytes, 'peakHeapGrowthBytes'),
  });
}

export function createIndexedDbUsageReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'phase',
    'metricAvailable',
    'storageEstimateUsageBytes',
    'storageEstimateQuotaBytes',
    'indexedDbDeltaBytes',
    'reasonCode',
  ], 'createIndexedDbUsageReceipt');

  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createIndexedDbUsageReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    phase: assertPublicSafeId(input.phase, 'phase'),
    metricAvailable: assertBoolean(input.metricAvailable, 'metricAvailable'),
    storesSensitiveText: false,
  };

  if (!base.metricAvailable) {
    return insufficientReceipt(base, input.reasonCode);
  }

  return freezeReceipt({
    ...base,
    status: 'pass',
    storageEstimateUsageBytes: assertNonNegativeSafeInteger(
      input.storageEstimateUsageBytes,
      'storageEstimateUsageBytes',
    ),
    storageEstimateQuotaBytes: assertNonNegativeSafeInteger(
      input.storageEstimateQuotaBytes,
      'storageEstimateQuotaBytes',
    ),
    indexedDbDeltaBytes: assertNonNegativeSafeInteger(input.indexedDbDeltaBytes, 'indexedDbDeltaBytes'),
  });
}

export function createPersistedIndexSizeReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'phase',
    'metricAvailable',
    'managedSourceBytes',
    'persistedIndexBytes',
    'reasonCode',
  ], 'createPersistedIndexSizeReceipt');

  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createPersistedIndexSizeReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    phase: assertPublicSafeId(input.phase, 'phase'),
    metricAvailable: assertBoolean(input.metricAvailable, 'metricAvailable'),
    storesSensitiveText: false,
  };

  if (!base.metricAvailable) {
    return insufficientReceipt(base, input.reasonCode);
  }

  const managedSourceBytes = assertPositiveSafeInteger(input.managedSourceBytes, 'managedSourceBytes');
  const persistedIndexBytes = assertNonNegativeSafeInteger(input.persistedIndexBytes, 'persistedIndexBytes');
  return freezeReceipt({
    ...base,
    status: 'pass',
    managedSourceBytes,
    persistedIndexBytes,
    indexToSourceRatioPermille: Math.round((persistedIndexBytes / managedSourceBytes) * 1000),
  });
}

export function createRestartReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'scenario',
    'attempted',
    'completed',
    'preRestartCheckpoint',
    'postRestartCheckpoint',
    'reasonCode',
  ], 'createRestartReceipt');

  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createRestartReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    scenario: assertPublicSafeId(input.scenario, 'scenario'),
    attempted: assertBoolean(input.attempted, 'attempted'),
    storesSensitiveText: false,
  };

  if (!base.attempted) {
    return insufficientReceipt(base, input.reasonCode);
  }

  const completed = assertBoolean(input.completed, 'completed');
  const preRestartCheckpoint = assertCheckpoint(input.preRestartCheckpoint, 'preRestartCheckpoint');
  const postRestartCheckpoint = assertCheckpoint(input.postRestartCheckpoint, 'postRestartCheckpoint');

  return freezeReceipt({
    ...base,
    status: completed ? 'pass' : 'fail',
    completed,
    preRestartCheckpoint,
    postRestartCheckpoint,
  });
}

export function createFailureInjectionReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'scenario',
    'injectionPoint',
    'attempted',
    'completed',
    'visibleRowsAfterFailure',
    'cleanupRequired',
    'readbackVerified',
    'reasonCode',
  ], 'createFailureInjectionReceipt');

  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createFailureInjectionReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    scenario: assertPublicSafeId(input.scenario, 'scenario'),
    injectionPoint: assertPublicSafeId(input.injectionPoint, 'injectionPoint'),
    attempted: assertBoolean(input.attempted, 'attempted'),
    storesSensitiveText: false,
  };

  if (!base.attempted) {
    return insufficientReceipt(base, input.reasonCode);
  }

  const completed = assertBoolean(input.completed, 'completed');
  return freezeReceipt({
    ...base,
    status: completed ? 'pass' : 'fail',
    completed,
    visibleRowsAfterFailure: assertNonNegativeSafeInteger(
      input.visibleRowsAfterFailure,
      'visibleRowsAfterFailure',
    ),
    cleanupRequired: assertBoolean(input.cleanupRequired, 'cleanupRequired'),
    readbackVerified: assertBoolean(input.readbackVerified, 'readbackVerified'),
  });
}

export function createCleanupReadbackReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'operation',
    'beforeFileCount',
    'removedFileCount',
    'afterFileCount',
    'tempFileCountAfterCleanup',
    'finalFileCountAfterCleanup',
    'readbackVerified',
  ], 'createCleanupReadbackReceipt');

  const readbackVerified = assertBoolean(input.readbackVerified, 'readbackVerified');
  const tempFileCountAfterCleanup = assertNonNegativeSafeInteger(
    input.tempFileCountAfterCleanup,
    'tempFileCountAfterCleanup',
  );
  const finalFileCountAfterCleanup = assertNonNegativeSafeInteger(
    input.finalFileCountAfterCleanup,
    'finalFileCountAfterCleanup',
  );

  return freezeReceipt({
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createCleanupReadbackReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    operation: assertPublicSafeId(input.operation, 'operation'),
    status: readbackVerified && tempFileCountAfterCleanup === 0 && finalFileCountAfterCleanup === 0
      ? 'pass'
      : 'fail',
    beforeFileCount: assertNonNegativeSafeInteger(input.beforeFileCount, 'beforeFileCount'),
    removedFileCount: assertNonNegativeSafeInteger(input.removedFileCount, 'removedFileCount'),
    afterFileCount: assertNonNegativeSafeInteger(input.afterFileCount, 'afterFileCount'),
    tempFileCountAfterCleanup,
    finalFileCountAfterCleanup,
    readbackVerified,
    storesSensitiveText: false,
  });
}

export function assertPublicSafeId(value, fieldName) {
  if (typeof value !== 'string' || !PUBLIC_SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a public-safe id`);
  }
  assertNoSensitiveTokens(value);
  return value;
}

function helperDescriptor(helper, requiredFields) {
  return Object.freeze({
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper,
    requiredFields,
    unavailableMetricStatus: INSUFFICIENT_EVIDENCE,
    storesSensitiveText: false,
  });
}

function insufficientReceipt(base, reasonCode) {
  return freezeReceipt({
    ...base,
    status: INSUFFICIENT_EVIDENCE,
    reasonCode: assertReasonCode(reasonCode),
  });
}

function freezeReceipt(receipt) {
  assertNoSensitiveTokens(receipt);
  return Object.freeze(receipt);
}

function assertAllowedFields(input, allowedFields, helper) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${helper} input must be an object`);
  }
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new Error(`${helper} received unsupported field: ${key}`);
    }
  }
}

function assertReasonCode(value) {
  if (typeof value !== 'string' || !RECEIPT_REASON_CODES.includes(value)) {
    throw new Error('reasonCode must use a closed reason code');
  }
  return value;
}

function assertBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function assertNonNegativeSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function assertPositiveSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function assertCheckpoint(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a checkpoint object`);
  }
  const allowed = new Set([
    'checkpointId',
    'phase',
    'batchOrdinal',
    'recordCount',
    'canonicalBytes',
    'operationOpen',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`unsupported checkpoint field: ${key}`);
    }
  }
  return {
    checkpointId: assertPublicSafeId(value.checkpointId, `${fieldName}.checkpointId`),
    phase: assertPublicSafeId(value.phase, `${fieldName}.phase`),
    batchOrdinal: assertNonNegativeSafeInteger(value.batchOrdinal, `${fieldName}.batchOrdinal`),
    recordCount: assertNonNegativeSafeInteger(value.recordCount, `${fieldName}.recordCount`),
    canonicalBytes: assertNonNegativeSafeInteger(value.canonicalBytes, `${fieldName}.canonicalBytes`),
    operationOpen: assertBoolean(value.operationOpen, `${fieldName}.operationOpen`),
  };
}

function assertNoSensitiveTokens(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (SENSITIVE_RECEIPT_TOKEN_PATTERN.test(serialized)) {
    throw new Error('receipt helper input contains a forbidden privacy-sensitive token');
  }
}
