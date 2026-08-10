export const GATE_014_RECEIPT_HELPER_CONTRACT = 'gate-014-receipt-helper-v5';
export const INSUFFICIENT_EVIDENCE = 'insufficient_evidence';
export const PUBLIC_SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
export const MAX_PEAK_HEAP_GROWTH_BYTES = 256 * 1024 * 1024;
export const MAX_INDEX_TO_SOURCE_RATIO_PERMILLE = 1_500;
export const INDEXED_DB_EXPECTED_DIRECTIONS = deepFreeze(['increase', 'decrease']);
export const RECEIPT_REASON_CODES = deepFreeze([
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

export const REUSABLE_RECEIPT_HELPER_DESCRIPTORS = deepFreeze([
  helperDescriptor('createTimingReceipt', [
    'fixtureId',
    'operation',
    'metricAvailable',
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
    'peakHeapGrowthLimitBytes',
    'metricsConsistent',
    'withinGateLimit',
  ]),
  helperDescriptor('createIndexedDbUsageReceipt', [
    'fixtureId',
    'phase',
    'metricAvailable',
    'storageEstimateUsageBeforeBytes',
    'storageEstimateUsageAfterBytes',
    'storageEstimateQuotaBytes',
    'indexedDbDeltaBytes',
    'expectedDirection',
    'readbackVerified',
    'metricsConsistent',
  ]),
  helperDescriptor('createPersistedIndexSizeReceipt', [
    'fixtureId',
    'phase',
    'metricAvailable',
    'managedSourceBytes',
    'persistedIndexBytes',
    'indexToSourceRatioPermille',
    'maximumIndexToSourceRatioPermille',
    'metricsConsistent',
    'withinGateLimit',
  ]),
  helperDescriptor('createRestartReceipt', [
    'fixtureId',
    'scenario',
    'attempted',
    'completed',
    'preRestartCheckpoint',
    'postRestartCheckpoint',
    'replayedBatchCount',
    'checkpointNonDecreasing',
    'checkpointProgressionValid',
    'readbackVerified',
    'mixedGenerationVisible',
    'duplicatePostingsDetected',
    'fullRebuildStarted',
  ]),
  helperDescriptor('createFailureInjectionReceipt', [
    'fixtureId',
    'scenario',
    'injectionPoint',
    'attempted',
    'completed',
    'visibleRowsAfterFailure',
    'cleanupRequired',
    'cleanupCompleted',
    'cleanupSatisfied',
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
    'countsConsistent',
  ]),
]);

export function createTimingReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'operation',
    'metricAvailable',
    'startedAtEpochMs',
    'endedAtEpochMs',
    'sampleCount',
    'reasonCode',
  ], 'createTimingReceipt');

  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createTimingReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    operation: assertPublicSafeId(input.operation, 'operation'),
    metricAvailable: assertBoolean(input.metricAvailable, 'metricAvailable'),
    storesSensitiveText: false,
  };
  if (!base.metricAvailable) {
    if (['startedAtEpochMs', 'endedAtEpochMs', 'sampleCount'].some(field => Object.hasOwn(input, field))) {
      throw new Error('unavailable timing receipt must not include timing measurements');
    }
    return insufficientReceipt(base, input.reasonCode);
  }
  if (Object.hasOwn(input, 'reasonCode')) {
    throw new Error('available timing receipt must not include reasonCode');
  }

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
    ...base,
    status: 'pass',
    startedAtEpochMs,
    endedAtEpochMs,
    durationMs: endedAtEpochMs - startedAtEpochMs,
    sampleCount,
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
    assertFieldsAbsent(input, [
      'heapUsedBytes',
      'heapTotalBytes',
      'rssBytes',
      'peakHeapGrowthBytes',
    ], 'unavailable memory receipt must not include memory measurements');
    return insufficientReceipt(base, input.reasonCode);
  }
  assertFieldsAbsent(input, ['reasonCode'], 'available memory receipt must not include reasonCode');

  const heapUsedBytes = assertNonNegativeSafeInteger(input.heapUsedBytes, 'heapUsedBytes');
  const heapTotalBytes = assertNonNegativeSafeInteger(input.heapTotalBytes, 'heapTotalBytes');
  const rssBytes = assertNonNegativeSafeInteger(input.rssBytes, 'rssBytes');
  const peakHeapGrowthBytes = assertNonNegativeSafeInteger(
    input.peakHeapGrowthBytes,
    'peakHeapGrowthBytes',
  );
  const metricsConsistent = heapUsedBytes > 0
    && heapTotalBytes > 0
    && rssBytes > 0
    && peakHeapGrowthBytes > 0
    && heapUsedBytes <= heapTotalBytes
    && heapUsedBytes <= rssBytes;
  const withinGateLimit = peakHeapGrowthBytes <= MAX_PEAK_HEAP_GROWTH_BYTES;

  return freezeReceipt({
    ...base,
    status: metricsConsistent && withinGateLimit ? 'pass' : 'fail',
    heapUsedBytes,
    heapTotalBytes,
    rssBytes,
    peakHeapGrowthBytes,
    peakHeapGrowthLimitBytes: MAX_PEAK_HEAP_GROWTH_BYTES,
    metricsConsistent,
    withinGateLimit,
  });
}

export function createIndexedDbUsageReceipt(input) {
  assertAllowedFields(input, [
    'fixtureId',
    'phase',
    'metricAvailable',
    'storageEstimateUsageBeforeBytes',
    'storageEstimateUsageAfterBytes',
    'storageEstimateQuotaBytes',
    'indexedDbDeltaBytes',
    'expectedDirection',
    'readbackVerified',
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
    assertFieldsAbsent(input, [
      'storageEstimateUsageBeforeBytes',
      'storageEstimateUsageAfterBytes',
      'storageEstimateQuotaBytes',
      'indexedDbDeltaBytes',
      'expectedDirection',
      'readbackVerified',
    ], 'unavailable IndexedDB receipt must not include storage measurements');
    return insufficientReceipt(base, input.reasonCode);
  }
  assertFieldsAbsent(input, ['reasonCode'], 'available IndexedDB receipt must not include reasonCode');

  const storageEstimateUsageBeforeBytes = assertNonNegativeSafeInteger(
    input.storageEstimateUsageBeforeBytes,
    'storageEstimateUsageBeforeBytes',
  );
  const storageEstimateUsageAfterBytes = assertNonNegativeSafeInteger(
    input.storageEstimateUsageAfterBytes,
    'storageEstimateUsageAfterBytes',
  );
  const storageEstimateQuotaBytes = assertNonNegativeSafeInteger(
    input.storageEstimateQuotaBytes,
    'storageEstimateQuotaBytes',
  );
  const indexedDbDeltaBytes = assertSignedSafeInteger(
    input.indexedDbDeltaBytes,
    'indexedDbDeltaBytes',
  );
  const expectedDirection = assertIndexedDbExpectedDirection(input.expectedDirection);
  const readbackVerified = assertBoolean(input.readbackVerified, 'readbackVerified');
  const measuredDeltaBytes = storageEstimateUsageAfterBytes - storageEstimateUsageBeforeBytes;
  const directionMatches = expectedDirection === 'increase'
    ? indexedDbDeltaBytes > 0
    : indexedDbDeltaBytes < 0;
  const metricsConsistent = storageEstimateQuotaBytes > 0
    && storageEstimateUsageBeforeBytes <= storageEstimateQuotaBytes
    && storageEstimateUsageAfterBytes <= storageEstimateQuotaBytes
    && (storageEstimateUsageBeforeBytes > 0 || storageEstimateUsageAfterBytes > 0)
    && indexedDbDeltaBytes === measuredDeltaBytes
    && directionMatches
    && readbackVerified;

  return freezeReceipt({
    ...base,
    status: metricsConsistent ? 'pass' : 'fail',
    storageEstimateUsageBeforeBytes,
    storageEstimateUsageAfterBytes,
    storageEstimateQuotaBytes,
    indexedDbDeltaBytes,
    expectedDirection,
    readbackVerified,
    metricsConsistent,
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
    assertFieldsAbsent(input, [
      'managedSourceBytes',
      'persistedIndexBytes',
    ], 'unavailable persisted-index receipt must not include index measurements');
    return insufficientReceipt(base, input.reasonCode);
  }
  assertFieldsAbsent(input, ['reasonCode'], 'available persisted-index receipt must not include reasonCode');

  const managedSourceBytes = assertPositiveSafeInteger(input.managedSourceBytes, 'managedSourceBytes');
  const persistedIndexBytes = assertNonNegativeSafeInteger(input.persistedIndexBytes, 'persistedIndexBytes');
  const indexToSourceRatioPermille = Math.round((persistedIndexBytes / managedSourceBytes) * 1000);
  if (!Number.isSafeInteger(indexToSourceRatioPermille)) {
    throw new Error('indexToSourceRatioPermille must be a safe integer');
  }
  const metricsConsistent = persistedIndexBytes > 0;
  const withinGateLimit = BigInt(persistedIndexBytes) * 2n <= BigInt(managedSourceBytes) * 3n;
  return freezeReceipt({
    ...base,
    status: metricsConsistent && withinGateLimit ? 'pass' : 'fail',
    managedSourceBytes,
    persistedIndexBytes,
    indexToSourceRatioPermille,
    maximumIndexToSourceRatioPermille: MAX_INDEX_TO_SOURCE_RATIO_PERMILLE,
    metricsConsistent,
    withinGateLimit,
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
    'replayedBatchCount',
    'readbackVerified',
    'mixedGenerationVisible',
    'duplicatePostingsDetected',
    'fullRebuildStarted',
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
    assertFieldsAbsent(input, [
      'completed',
      'preRestartCheckpoint',
      'postRestartCheckpoint',
      'replayedBatchCount',
      'readbackVerified',
      'mixedGenerationVisible',
      'duplicatePostingsDetected',
      'fullRebuildStarted',
    ], 'unattempted restart receipt must not include restart results');
    return insufficientReceipt(base, input.reasonCode);
  }
  assertFieldsAbsent(input, ['reasonCode'], 'attempted restart receipt must not include reasonCode');

  const completed = assertBoolean(input.completed, 'completed');
  const preRestartCheckpoint = assertCheckpoint(input.preRestartCheckpoint, 'preRestartCheckpoint');
  const postRestartCheckpoint = assertCheckpoint(input.postRestartCheckpoint, 'postRestartCheckpoint');
  const replayedBatchCount = assertNonNegativeSafeInteger(
    input.replayedBatchCount,
    'replayedBatchCount',
  );
  const readbackVerified = assertBoolean(input.readbackVerified, 'readbackVerified');
  const mixedGenerationVisible = assertBoolean(
    input.mixedGenerationVisible,
    'mixedGenerationVisible',
  );
  const duplicatePostingsDetected = assertBoolean(
    input.duplicatePostingsDetected,
    'duplicatePostingsDetected',
  );
  const fullRebuildStarted = assertBoolean(input.fullRebuildStarted, 'fullRebuildStarted');
  const checkpointNonDecreasing = postRestartCheckpoint.batchOrdinal >= preRestartCheckpoint.batchOrdinal
    && postRestartCheckpoint.recordCount >= preRestartCheckpoint.recordCount
    && postRestartCheckpoint.canonicalBytes >= preRestartCheckpoint.canonicalBytes;
  const checkpointIdentityValid = postRestartCheckpoint.batchOrdinal !== preRestartCheckpoint.batchOrdinal
    || postRestartCheckpoint.checkpointId === preRestartCheckpoint.checkpointId;
  const operationStateValid = preRestartCheckpoint.operationOpen
    || !postRestartCheckpoint.operationOpen;
  const checkpointProgressionValid = checkpointNonDecreasing
    && checkpointIdentityValid
    && operationStateValid
    && replayedBatchCount <= 1;
  const passed = completed
    && checkpointProgressionValid
    && readbackVerified
    && !mixedGenerationVisible
    && !duplicatePostingsDetected
    && !fullRebuildStarted;

  return freezeReceipt({
    ...base,
    status: passed ? 'pass' : 'fail',
    completed,
    preRestartCheckpoint,
    postRestartCheckpoint,
    replayedBatchCount,
    checkpointNonDecreasing,
    checkpointProgressionValid,
    readbackVerified,
    mixedGenerationVisible,
    duplicatePostingsDetected,
    fullRebuildStarted,
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
    'cleanupCompleted',
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
    assertFieldsAbsent(input, [
      'completed',
      'visibleRowsAfterFailure',
      'cleanupRequired',
      'cleanupCompleted',
      'readbackVerified',
    ], 'unattempted failure-injection receipt must not include failure results');
    return insufficientReceipt(base, input.reasonCode);
  }
  assertFieldsAbsent(input, ['reasonCode'], 'attempted failure-injection receipt must not include reasonCode');

  const completed = assertBoolean(input.completed, 'completed');
  const visibleRowsAfterFailure = assertNonNegativeSafeInteger(
    input.visibleRowsAfterFailure,
    'visibleRowsAfterFailure',
  );
  const cleanupRequired = assertBoolean(input.cleanupRequired, 'cleanupRequired');
  const cleanupCompleted = assertBoolean(input.cleanupCompleted, 'cleanupCompleted');
  const readbackVerified = assertBoolean(input.readbackVerified, 'readbackVerified');
  const cleanupSatisfied = !cleanupRequired || cleanupCompleted;
  const passed = completed
    && visibleRowsAfterFailure === 0
    && readbackVerified
    && cleanupSatisfied;
  return freezeReceipt({
    ...base,
    status: passed ? 'pass' : 'fail',
    completed,
    visibleRowsAfterFailure,
    cleanupRequired,
    cleanupCompleted,
    cleanupSatisfied,
    readbackVerified,
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
  const beforeFileCount = assertNonNegativeSafeInteger(input.beforeFileCount, 'beforeFileCount');
  const removedFileCount = assertNonNegativeSafeInteger(input.removedFileCount, 'removedFileCount');
  const afterFileCount = assertNonNegativeSafeInteger(input.afterFileCount, 'afterFileCount');
  const countsConsistent = removedFileCount <= beforeFileCount
    && afterFileCount === beforeFileCount - removedFileCount
    && afterFileCount === tempFileCountAfterCleanup + finalFileCountAfterCleanup;
  const passed = countsConsistent
    && afterFileCount === 0
    && tempFileCountAfterCleanup === 0
    && finalFileCountAfterCleanup === 0
    && readbackVerified;

  return freezeReceipt({
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createCleanupReadbackReceipt',
    fixtureId: assertPublicSafeId(input.fixtureId, 'fixtureId'),
    operation: assertPublicSafeId(input.operation, 'operation'),
    status: passed ? 'pass' : 'fail',
    beforeFileCount,
    removedFileCount,
    afterFileCount,
    tempFileCountAfterCleanup,
    finalFileCountAfterCleanup,
    readbackVerified,
    countsConsistent,
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
  return deepFreeze({
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
  return deepFreeze(receipt);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function assertAllowedFields(input, allowedFields, helper) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${helper} input must be an object`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${helper} input must be a plain object`);
  }
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new Error(`${helper} received unsupported field: ${key}`);
    }
  }
}

function assertFieldsAbsent(input, fields, message) {
  if (fields.some(field => Object.hasOwn(input, field))) {
    throw new Error(message);
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

function assertSignedSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a signed safe integer`);
  }
  return value;
}

function assertIndexedDbExpectedDirection(value) {
  if (typeof value !== 'string' || !INDEXED_DB_EXPECTED_DIRECTIONS.includes(value)) {
    throw new Error('expectedDirection must use a closed IndexedDB direction');
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
