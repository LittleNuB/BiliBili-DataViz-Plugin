import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBilibiliTranscriptEvidence } from '../src/shared/current-video-transcript-cache.ts';
import {
  clearTemporaryCurrentVideoTranscriptCache,
  getTemporaryCurrentVideoTranscriptSegments,
  putTemporaryCurrentVideoTranscriptEvidence,
} from '../src/background/current-video-temporary-transcript-cache.ts';
import { retainTemporaryTranscriptOwnerForContextSnapshot } from '../src/background/current-video-transcript-owner.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';

test('fixed popup tab owner keeps A context readable after active tab switches to B', () => {
  clearTemporaryCurrentVideoTranscriptCache();
  const contextA = handlerVideoContext('BV1HandlerA0', 8801);
  const tabA = 801;
  const tabB = 802;
  const ownerA = retainTemporaryTranscriptOwnerForContextSnapshot(contextA, tabA);
  assert.ok(ownerA);

  const evidenceA = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'A 标签页的临时字幕应该跟随初始 owner。' }] },
    {
      bvid: contextA.bvid,
      cid: contextA.cid as number,
      page: contextA.currentPart.page,
      language: 'zh-CN',
      sourceType: 'bilibili_player_wbi_v2',
      trackId: '7',
      trackUrlHost: 'aisubtitle.hdslb.com',
      fetchedAt: 11_000,
    },
  );
  assert.equal(putTemporaryCurrentVideoTranscriptEvidence(ownerA, evidenceA).status, 'stored');

  const activeTabAfterDelay = tabB;
  const ownerFromWrongActiveTab = retainTemporaryTranscriptOwnerForContextSnapshot(contextA, activeTabAfterDelay);
  assert.ok(ownerFromWrongActiveTab);
  const identity = {
    bvid: evidenceA.sourceRecord.bvid,
    cid: evidenceA.sourceRecord.cid,
    page: evidenceA.sourceRecord.page,
    language: evidenceA.sourceRecord.language,
    sourceIdentityKey: evidenceA.sourceRecord.sourceIdentityKey,
    sourceHash: evidenceA.sourceRecord.sourceHash,
  };

  assert.equal(getTemporaryCurrentVideoTranscriptSegments(ownerA, identity).length, 1);
  assert.equal(getTemporaryCurrentVideoTranscriptSegments(ownerFromWrongActiveTab, identity).length, 0);
});

function handlerVideoContext(bvid: string, cid: number): CurrentVideoContext {
  return {
    kind: 'video',
    url: `https://www.bilibili.com/video/${bvid}`,
    collectedAt: Date.now(),
    bvid,
    aid: cid,
    cid,
    title: `Handler video ${cid}`,
    authorName: 'Handler UP',
    authorMid: 42,
    durationSeconds: 120,
    currentPart: { page: 1, title: 'Main', total: 1 },
    parts: [{ page: 1, cid, title: 'Main', durationSeconds: 120 }],
    chapters: [],
    description: {
      availability: 'available',
      text: 'Handler context visible description.',
      length: 36,
    },
    sources: {
      metadata: 'available',
      description: 'available',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'available',
      contentText: 'unavailable',
    },
    subtitleProbe: null,
    transcriptEvidence: null,
    warnings: ['transcript_probe_pending'],
  };
}
