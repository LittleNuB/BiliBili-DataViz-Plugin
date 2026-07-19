import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_LIMIT,
  CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_TTL_MS,
  clearCurrentVideoTimestampOperationLeases,
  clearCurrentVideoTimestampOperationLeasesForTab,
  consumeCurrentVideoTimestampOperationLease,
  issueCurrentVideoTimestampOperationLease,
} from '../src/background/current-video-timestamp-operation-lease.ts';

test('timestamp operation lease is exact-bound and one-time', () => {
  clearCurrentVideoTimestampOperationLeases();
  const leaseId = issueCurrentVideoTimestampOperationLease(binding(), 1_000);

  const consumed = consumeCurrentVideoTimestampOperationLease({
    leaseId,
    tabId: 71,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:one',
  }, 1_001);

  assert.equal(consumed?.selectionGeneration, 4);
  assert.equal(consumed?.transcriptClearGeneration, 8);
  assert.equal(consumeCurrentVideoTimestampOperationLease({
    leaseId,
    tabId: 71,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:one',
  }, 1_002), null);
});

test('wrong lease binding fails closed and consumes the attempted lease', () => {
  clearCurrentVideoTimestampOperationLeases();
  const leaseId = issueCurrentVideoTimestampOperationLease(binding(), 2_000);
  const wrongTab = consumeCurrentVideoTimestampOperationLease({
    leaseId,
    tabId: 72,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:one',
  }, 2_001);
  assert.equal(wrongTab, null);
  assert.equal(consumeCurrentVideoTimestampOperationLease({
    leaseId,
    tabId: 71,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:one',
  }, 2_002), null);
});

test('expired and removed-tab timestamp operation leases fail closed', () => {
  clearCurrentVideoTimestampOperationLeases();
  const expired = issueCurrentVideoTimestampOperationLease(binding(), 3_000);
  assert.equal(consumeCurrentVideoTimestampOperationLease({
    leaseId: expired,
    tabId: 71,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:one',
  }, 3_000 + CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_TTL_MS), null);

  const removed = issueCurrentVideoTimestampOperationLease(binding(), 4_000);
  clearCurrentVideoTimestampOperationLeasesForTab(71);
  assert.equal(consumeCurrentVideoTimestampOperationLease({
    leaseId: removed,
    tabId: 71,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:one',
  }, 4_001), null);
});

test('timestamp operation lease registry evicts the oldest entry at its bound', () => {
  clearCurrentVideoTimestampOperationLeases();
  const leaseIds: string[] = [];
  for (let index = 0; index <= CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_LIMIT; index += 1) {
    leaseIds.push(issueCurrentVideoTimestampOperationLease({
      ...binding(),
      sourceIdentityKey: `source:lease:${index}`,
    }, 5_000 + index));
  }

  assert.equal(consumeCurrentVideoTimestampOperationLease({
    leaseId: leaseIds[0],
    tabId: 71,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:0',
  }, 6_000), null);
  assert.ok(consumeCurrentVideoTimestampOperationLease({
    leaseId: leaseIds.at(-1) as string,
    tabId: 71,
    operationKind: 'jump',
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: `source:lease:${CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_LIMIT}`,
  }, 6_001));
});

function binding() {
  return {
    tabId: 71,
    operationKind: 'jump' as const,
    bvid: 'BV1Lease000',
    cid: 701,
    page: 1,
    sourceIdentityKey: 'source:lease:one',
    selectionGeneration: 4,
    transcriptClearGeneration: 8,
  };
}
