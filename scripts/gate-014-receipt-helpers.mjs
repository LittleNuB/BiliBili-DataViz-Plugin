export const GATE_014_RECEIPT_HELPER_CONTRACT = 'gate-014-receipt-helper-v1';
export const INSUFFICIENT_EVIDENCE = 'insufficient_evidence';
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
  ]),
]);

export function createTimingReceipt(input) {
  const startedAtEpochMs = assertSafeInteger(input.startedAtEpochMs, 'startedAtEpochMs');
  const endedAtEpochMs = assertSafeInteger(input.endedAtEpochMs, 'endedAtEpochMs');
  if (endedAtEpochMs < startedAtEpochMs) {
    throw new Error('endedAtEpochMs must be greater than or equal to startedAtEpochMs');
  }
  const sampleCount = input.sampleCount === undefined
    ? 1
    : assertSafeInteger(input.sampleCount, 'sampleCount');
  if (sampleCount < 1) {
    throw new Error('sampleCount must be at least 1');
  }

  return freezeReceipt({
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createTimingReceipt',
    fixtureId: assertNonEmptyString(input.fixtureId, 'fixtureId'),
    operation: assertNonEmptyString(input.operation, 'operation'),
    status: 'pass',
    startedAtEpochMs,
    endedAtEpochMs,
    durationMs: endedAtEpochMs - startedAtEpochMs,
    sampleCount,
    storesSensitiveText: false,
    notes: sanitizeNotes(input.notes),
  });
}

export function createMemoryReceipt(input) {
  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createMemoryReceipt',
    fixtureId: assertNonEmptyString(input.fixtureId, 'fixtureId'),
    phase: assertNonEmptyString(input.phase, 'phase'),
    metricAvailable: Boolean(input.metricAvailable),
    storesSensitiveText: false,
  };

  if (!input.metricAvailable) {
    return freezeReceipt({
      ...base,
      status: INSUFFICIENT_EVIDENCE,
      unavailableReason: assertNonEmptyString(input.unavailableReason, 'unavailableReason'),
    });
  }

  return freezeReceipt({
    ...base,
    status: 'pass',
    heapUsedBytes: assertOptionalNonNegativeInteger(input.heapUsedBytes, 'heapUsedBytes'),
    heapTotalBytes: assertOptionalNonNegativeInteger(input.heapTotalBytes, 'heapTotalBytes'),
    rssBytes: assertOptionalNonNegativeInteger(input.rssBytes, 'rssBytes'),
    peakHeapGrowthBytes: assertOptionalNonNegativeInteger(
      input.peakHeapGrowthBytes,
      'peakHeapGrowthBytes',
    ),
    notes: sanitizeNotes(input.notes),
  });
}

export function createIndexedDbUsageReceipt(input) {
  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createIndexedDbUsageReceipt',
    fixtureId: assertNonEmptyString(input.fixtureId, 'fixtureId'),
    phase: assertNonEmptyString(input.phase, 'phase'),
    metricAvailable: Boolean(input.metricAvailable),
    storesSensitiveText: false,
  };

  if (!input.metricAvailable) {
    return freezeReceipt({
      ...base,
      status: INSUFFICIENT_EVIDENCE,
      unavailableReason: assertNonEmptyString(input.unavailableReason, 'unavailableReason'),
    });
  }

  return freezeReceipt({
    ...base,
    status: 'pass',
    storageEstimateUsageBytes: assertOptionalNonNegativeInteger(
      input.storageEstimateUsageBytes,
      'storageEstimateUsageBytes',
    ),
    storageEstimateQuotaBytes: assertOptionalNonNegativeInteger(
      input.storageEstimateQuotaBytes,
      'storageEstimateQuotaBytes',
    ),
    indexedDbDeltaBytes: assertOptionalNonNegativeInteger(
      input.indexedDbDeltaBytes,
      'indexedDbDeltaBytes',
    ),
    notes: sanitizeNotes(input.notes),
  });
}

export function createRestartReceipt(input) {
  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createRestartReceipt',
    fixtureId: assertNonEmptyString(input.fixtureId, 'fixtureId'),
    scenario: assertNonEmptyString(input.scenario, 'scenario'),
    attempted: Boolean(input.attempted),
    storesSensitiveText: false,
  };

  if (!input.attempted) {
    return freezeReceipt({
      ...base,
      status: INSUFFICIENT_EVIDENCE,
      unavailableReason: assertNonEmptyString(input.unavailableReason, 'unavailableReason'),
    });
  }

  return freezeReceipt({
    ...base,
    status: input.completed ? 'pass' : 'fail',
    completed: Boolean(input.completed),
    preRestartCheckpoint: sanitizeRecord(input.preRestartCheckpoint),
    postRestartCheckpoint: sanitizeRecord(input.postRestartCheckpoint),
    notes: sanitizeNotes(input.notes),
  });
}

export function createFailureInjectionReceipt(input) {
  const base = {
    contract: GATE_014_RECEIPT_HELPER_CONTRACT,
    helper: 'createFailureInjectionReceipt',
    fixtureId: assertNonEmptyString(input.fixtureId, 'fixtureId'),
    scenario: assertNonEmptyString(input.scenario, 'scenario'),
    injectionPoint: assertNonEmptyString(input.injectionPoint, 'injectionPoint'),
    attempted: Boolean(input.attempted),
    storesSensitiveText: false,
  };

  if (!input.attempted) {
    return freezeReceipt({
      ...base,
      status: INSUFFICIENT_EVIDENCE,
      unavailableReason: assertNonEmptyString(input.unavailableReason, 'unavailableReason'),
    });
  }

  return freezeReceipt({
    ...base,
    status: input.completed ? 'pass' : 'fail',
    completed: Boolean(input.completed),
    visibleRowsAfterFailure: assertOptionalNonNegativeInteger(
      input.visibleRowsAfterFailure,
      'visibleRowsAfterFailure',
    ),
    cleanupRequired: Boolean(input.cleanupRequired),
    notes: sanitizeNotes(input.notes),
  });
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

function freezeReceipt(receipt) {
  assertNoSensitiveTokens(receipt);
  return Object.freeze(receipt);
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  assertNoSensitiveTokens(value);
  return value;
}

function assertSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function assertOptionalNonNegativeInteger(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  return assertSafeInteger(value, fieldName);
}

function sanitizeNotes(notes) {
  if (notes === undefined || notes === null) {
    return [];
  }
  if (!Array.isArray(notes)) {
    throw new Error('notes must be an array when supplied');
  }
  return notes.map((note, index) => assertNonEmptyString(note, `notes[${index}]`));
}

function sanitizeRecord(record) {
  if (record === undefined || record === null) {
    return null;
  }
  const serialized = JSON.stringify(record);
  assertNoSensitiveTokens(serialized);
  return JSON.parse(serialized);
}

function assertNoSensitiveTokens(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (SENSITIVE_RECEIPT_TOKEN_PATTERN.test(serialized)) {
    throw new Error('receipt helper input contains a forbidden privacy-sensitive token');
  }
}
