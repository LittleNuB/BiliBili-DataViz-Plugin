import type {
  CurrentVideoTimestampOperationAuthorizationKind,
  CurrentVideoTimestampOperationKind,
} from '../shared/types/current-video-segment-retrieval.ts';

export interface CurrentVideoTimestampOperationLeaseBinding {
  tabId: number;
  operationKind: CurrentVideoTimestampOperationKind;
  authorizationKind?: CurrentVideoTimestampOperationAuthorizationKind;
  bvid: string;
  cid: number;
  page: number;
  sourceIdentityKey: string;
  selectionGeneration: number;
  transcriptClearGeneration: number;
}

export interface ConsumeCurrentVideoTimestampOperationLeaseInput {
  leaseId: string;
  tabId: number;
  operationKind: CurrentVideoTimestampOperationKind;
  bvid: string;
  cid: number;
  page: number;
  sourceIdentityKey: string;
}

interface StoredCurrentVideoTimestampOperationLease
  extends CurrentVideoTimestampOperationLeaseBinding {
  leaseId: string;
  expiresAt: number;
}

export const CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_TTL_MS = 15_000;
export const CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_LIMIT = 32;

const operationLeases = new Map<string, StoredCurrentVideoTimestampOperationLease>();
let leaseSequence = 0;

export function issueCurrentVideoTimestampOperationLease(
  binding: CurrentVideoTimestampOperationLeaseBinding,
  now = Date.now(),
): string {
  pruneExpiredCurrentVideoTimestampOperationLeases(now);
  while (operationLeases.size >= CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_LIMIT) {
    const oldestLeaseId = operationLeases.keys().next().value as string | undefined;
    if (!oldestLeaseId) break;
    operationLeases.delete(oldestLeaseId);
  }

  const leaseId = createLeaseId(now);
  operationLeases.set(leaseId, {
    ...binding,
    authorizationKind: binding.authorizationKind ?? 'primary_text',
    leaseId,
    expiresAt: now + CURRENT_VIDEO_TIMESTAMP_OPERATION_LEASE_TTL_MS,
  });
  return leaseId;
}

export function consumeCurrentVideoTimestampOperationLease(
  input: ConsumeCurrentVideoTimestampOperationLeaseInput,
  now = Date.now(),
): CurrentVideoTimestampOperationLeaseBinding | null {
  pruneExpiredCurrentVideoTimestampOperationLeases(now);
  const lease = operationLeases.get(input.leaseId);
  if (!lease) return null;

  operationLeases.delete(input.leaseId);
  if (
    lease.expiresAt <= now
    || lease.tabId !== input.tabId
    || lease.operationKind !== input.operationKind
    || lease.bvid !== input.bvid
    || lease.cid !== input.cid
    || lease.page !== input.page
    || lease.sourceIdentityKey !== input.sourceIdentityKey
  ) {
    return null;
  }

  return {
    tabId: lease.tabId,
    operationKind: lease.operationKind,
    bvid: lease.bvid,
    cid: lease.cid,
    page: lease.page,
    sourceIdentityKey: lease.sourceIdentityKey,
    authorizationKind: lease.authorizationKind ?? 'primary_text',
    selectionGeneration: lease.selectionGeneration,
    transcriptClearGeneration: lease.transcriptClearGeneration,
  };
}

export function retireCurrentVideoTimestampOperationLease(leaseId: string): void {
  operationLeases.delete(leaseId);
}

export function clearCurrentVideoTimestampOperationLeasesForTab(tabId: number): void {
  for (const [leaseId, lease] of operationLeases) {
    if (lease.tabId === tabId) operationLeases.delete(leaseId);
  }
}

export function clearCurrentVideoTimestampOperationLeases(): void {
  operationLeases.clear();
}

function pruneExpiredCurrentVideoTimestampOperationLeases(now: number): void {
  for (const [leaseId, lease] of operationLeases) {
    if (lease.expiresAt <= now) operationLeases.delete(leaseId);
  }
}

function createLeaseId(now: number): string {
  leaseSequence += 1;
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `cv-op-${now.toString(36)}-${leaseSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
