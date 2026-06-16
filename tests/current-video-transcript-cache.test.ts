import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheCurrentVideoTranscriptEvidence } from '../src/background/current-video-transcript-cache.ts';
import {
  buildTranscriptEvidenceStateFromCache,
  normalizeBilibiliTranscriptEvidence,
  planTranscriptEvidenceUpsert,
  withTranscriptEvidenceState,
} from '../src/shared/current-video-transcript-cache.ts';
import {
  assertAssistantPayloadAudit,
  auditAssistantPayload,
  currentVideoSummaryPayloadContract,
} from '../src/shared/assistant-payload-audit.ts';
import {
  buildCurrentVideoSummaryAiPayload,
  buildLocalCurrentVideoSummary,
} from '../src/shared/current-video-summary.ts';
import { searchCurrentVideoSegments } from '../src/shared/current-video-segment-retrieval.ts';
import { buildVideoKnowledgeResult } from '../src/shared/video-knowledge.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceWrite,
  CurrentVideoTranscriptSegment,
  CurrentVideoTranscriptSourceRecord,
} from '../src/shared/types/current-video-transcript.ts';

test('normalizes Bilibili subtitle rows into stable transcript segments', () => {
  const evidence = normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 1.25, content: '  hello transcript  ' },
        { from: 1.25, to: 3, content: 'second line' },
        { from: 4, to: 3, content: 'bad time' },
        { from: 5, to: 6, content: '   ' },
      ],
    },
    baseNormalizeOptions(),
  );

  assert.equal(evidence.sourceRecord.status, 'cached');
  assert.equal(evidence.sourceRecord.segmentCount, 2);
  assert.equal(evidence.sourceRecord.coverageStartSeconds, 0);
  assert.equal(evidence.sourceRecord.coverageEndSeconds, 3);
  assert.deepEqual(evidence.sourceRecord.warnings, ['transcript_segments_filtered']);
  assert.equal(evidence.segments.length, 2);
  assert.equal(evidence.segments[0].text, 'hello transcript');
  assert.equal(evidence.segments[0].bvid, 'BV1Transcript00');
  assert.equal(evidence.segments[0].cid, 101);
  assert.equal(evidence.segments[0].page, 1);
  assert.equal(evidence.segments[0].language, 'zh-CN');
  assert.equal(evidence.segments[0].source, 'bilibili_subtitle');
  assert.equal(evidence.segments[0].sourceHash, evidence.sourceRecord.sourceHash);
  assert.match(evidence.segments[0].segmentId, /^transcript:BV1Transcript00:101:1:zh-cn:/);
});

test('upserts and reads transcript evidence without destructive unrelated changes', () => {
  const store = memoryStore();
  const evidence = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'cached line' }] },
    baseNormalizeOptions(),
  );
  const state = store.upsert(evidence);

  assert.equal(state.status, 'cached');
  assert.equal(state.active, true);
  assert.equal(state.segmentCount, 1);
  assert.equal(store.sources.length, 1);
  assert.equal(store.segments.length, 1);

  const read = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 101, page: 1 },
    store.sources,
    store.segments,
    2000,
  );
  assert.equal(read.status, 'cached');
  assert.equal(read.active, true);
  assert.equal(read.segmentCount, 1);
});

test('marks old same-identity segments stale when source hash changes', () => {
  const store = memoryStore();
  const first = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'first version' }] },
    baseNormalizeOptions({ fetchedAt: 1000 }),
  );
  const second = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'second version' }] },
    baseNormalizeOptions({ fetchedAt: 2000 }),
  );

  store.upsert(first);
  const state = store.upsert(second);

  assert.equal(state.status, 'cached');
  assert.equal(state.segmentCount, 1);
  assert.equal(state.staleSegmentCount, 1);
  assert.equal(store.segments.filter(segment => segment.stale).length, 1);
  assert.equal(store.segments.filter(segment => !segment.stale).length, 1);
  assert.notEqual(first.sourceRecord.sourceHash, second.sourceRecord.sourceHash);
});

test('keeps same BVID but different CID/page from becoming active evidence', () => {
  const store = memoryStore();
  store.upsert(normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'page one' }] },
    baseNormalizeOptions({ cid: 101, page: 1 }),
  ));

  const wrongPart = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 202, page: 2 },
    store.sources,
    store.segments,
    3000,
  );
  assert.equal(wrongPart.status, 'stale');
  assert.equal(wrongPart.active, false);

  store.upsert(normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 0, to: 2, content: 'page two' }] },
    baseNormalizeOptions({ cid: 202, page: 2 }),
  ));
  const pageOne = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 101, page: 1 },
    store.sources,
    store.segments,
    4000,
  );
  const pageTwo = buildTranscriptEvidenceStateFromCache(
    { bvid: 'BV1Transcript00', cid: 202, page: 2 },
    store.sources,
    store.segments,
    4000,
  );
  assert.equal(pageOne.status, 'cached');
  assert.equal(pageTwo.status, 'cached');
  assert.equal(pageOne.segmentCount, 1);
  assert.equal(pageTwo.segmentCount, 1);
});

test('records empty and malformed transcript states without active segments', () => {
  const empty = normalizeBilibiliTranscriptEvidence(
    { body: [] },
    baseNormalizeOptions(),
  );
  const malformed = normalizeBilibiliTranscriptEvidence(
    { body: [{ from: 'bad', to: 3, content: 'no start' }] },
    baseNormalizeOptions({ fetchedAt: 2000 }),
  );

  assert.equal(empty.sourceRecord.status, 'empty');
  assert.equal(empty.segments.length, 0);
  assert.equal(malformed.sourceRecord.status, 'malformed');
  assert.equal(malformed.segments.length, 0);

  const store = memoryStore();
  const emptyState = store.upsert(empty);
  assert.equal(emptyState.status, 'empty');
  assert.equal(emptyState.active, false);
});

test('background cache fetch keeps raw subtitle URL internal and reports language/track diagnostics', async () => {
  const store = memoryStore();
  let fetchedUrl = '';
  const fetchTargets: Array<{ bvid: string; aid?: number | null; cid: number; page: number | null }> = [];
  const state = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 5000,
    fetchPlayerInfo: async (target) => {
      fetchTargets.push(target);
      return {
        subtitle: {
          subtitles: [
            {
              id: 7,
              lan: 'zh-CN',
              lan_doc: 'Chinese',
              subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/private-track.json?token=secret',
            },
          ],
        },
      };
    },
    fetchSubtitleJson: async (url) => {
      fetchedUrl = url;
      return { body: [{ from: 0, to: 2, content: 'background fetched text' }] };
    },
    upsertEvidence: async evidence => store.upsert(evidence),
  });

  assert.equal(state.status, 'cached');
  assert.equal(state.language, 'zh-CN');
  assert.equal(state.segmentCount, 1);
  assert.deepEqual(fetchTargets[0], { bvid: 'BV1Transcript00', aid: 8800, cid: 101, page: 1 });
  assert.match(fetchedUrl, /^https:\/\/aisubtitle\.hdslb\.com\//);
  assert.doesNotMatch(JSON.stringify(state), /private-track|subtitle_url|token=secret|SESSDATA|Key\.txt/i);
});

test('background cache blocks unsupported subtitle hosts before fetching body', async () => {
  let fetched = false;
  const state = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 5100,
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            id: 7,
            lan: 'zh-CN',
            subtitle_url: 'https://evil.example.invalid/private-track.json?token=secret',
          },
        ],
      },
    }),
    fetchSubtitleJson: async () => {
      fetched = true;
      return { body: [{ from: 0, to: 2, content: 'should not fetch' }] };
    },
  });

  assert.equal(state.status, 'track_unavailable');
  assert.equal(state.reason, 'subtitle_host_unsupported');
  assert.equal(fetched, false);
  assert.doesNotMatch(JSON.stringify(state), /evil\.example|private-track|token=secret|subtitle_url/i);
});

test('background cache distinguishes fetch failure from subtitle access failure', async () => {
  const endpointFailed = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 5200,
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            lan: 'zh-CN',
            subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/zh.json',
          },
        ],
      },
    }),
    fetchSubtitleJson: async () => {
      throw new Error('NETWORK_DOWN');
    },
  });
  assert.equal(endpointFailed.status, 'endpoint_failed');
  assert.equal(endpointFailed.active, false);
  assert.ok(endpointFailed.warnings.includes('transcript_endpoint_failed'));

  const accessFailure = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 5300,
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            lan: 'zh-CN',
            subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/private.json',
          },
        ],
      },
    }),
    fetchSubtitleJson: async () => {
      throw new Error('SUBTITLE_HTTP_403');
    },
  });
  assert.equal(accessFailure.status, 'login_required');
  assert.equal(accessFailure.active, false);
  assert.ok(accessFailure.warnings.includes('transcript_login_required'));
});

test('background cache reports language mismatch and unavailable track states', async () => {
  const mismatch = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 6000,
    requestedLanguage: 'en-US',
    fetchPlayerInfo: async () => ({
      subtitle: {
        subtitles: [
          {
            lan: 'zh-CN',
            subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/zh.json',
          },
        ],
      },
    }),
  });
  assert.equal(mismatch.status, 'language_mismatch');
  assert.equal(mismatch.active, false);

  const unavailable = await cacheCurrentVideoTranscriptEvidence(videoContext(), {
    now: 7000,
    fetchPlayerInfo: async () => ({ subtitle: { subtitles: [{ lan: 'zh-CN' }] } }),
  });
  assert.equal(unavailable.status, 'track_unavailable');
  assert.equal(unavailable.active, false);
});

test('privacy audit keeps cached transcript text out of current video AI payload', () => {
  const store = memoryStore();
  const state = store.upsert(normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 2, content: 'SECRET TRANSCRIPT BODY SHOULD STAY LOCAL' },
      ],
    },
    baseNormalizeOptions(),
  ));
  const context = withTranscriptEvidenceState(videoContext(), state);
  context.sources.transcript = 'available';

  const payload = buildCurrentVideoSummaryAiPayload(context);
  const rawPayload = JSON.stringify(payload);
  const audit = auditAssistantPayload(payload, currentVideoSummaryPayloadContract);

  assert.equal(context.transcriptEvidence?.active, true);
  assert.equal(payload.availableSources.transcript, 'available');
  assert.equal(payload.availableSources.contentText, 'unavailable');
  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assertAssistantPayloadAudit(payload, currentVideoSummaryPayloadContract);
  assert.doesNotMatch(
    rawPayload,
    /SECRET TRANSCRIPT BODY|segmentId|sourceHash|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i,
  );
});

test('cached subtitle body becomes active evidence for summary, video knowledge, and segment search', () => {
  const store = memoryStore();
  const state = store.upsert(normalizeBilibiliTranscriptEvidence(
    {
      body: [
        { from: 0, to: 4, content: '模型架构从这里开始，介绍专家路由。' },
        { from: 4, to: 8, content: '这一段说明缓存后的字幕正文会作为本地证据。' },
      ],
    },
    baseNormalizeOptions(),
  ));
  const context = withTranscriptEvidenceState(videoContext(), state);
  context.sources.transcript = 'available';
  const summary = buildLocalCurrentVideoSummary(context, {
    transcriptSegments: store.segments,
    now: 8000,
  });
  const knowledge = buildVideoKnowledgeResult(context, {
    transcriptSegments: store.segments,
    now: 8000,
  });
  const search = searchCurrentVideoSegments(context, {
    query: '专家路由',
    transcriptSegments: store.segments,
    videoKnowledge: knowledge,
    now: 8000,
  });
  const raw = JSON.stringify({ summary, knowledge, search });

  assert.equal(context.transcriptEvidence?.active, true);
  assert.equal(summary.sourceTier, 'transcript_summary');
  assert.equal(knowledge.sourceState.transcriptEvidence, true);
  assert.ok(knowledge.nodes.some(node => node.source === 'transcript'));
  assert.equal(search.status, 'ready');
  assert.equal(search.candidates[0].binding.kind, 'transcript_segment');
  assert.doesNotMatch(raw, /subtitle_url|raw subtitle|watchHistory|favorites|following|feedback|Cookie|Key\.txt|Chrome\\User Data/i);
});

function baseNormalizeOptions(overrides: Partial<Parameters<typeof normalizeBilibiliTranscriptEvidence>[1]> = {}) {
  return {
    bvid: 'BV1Transcript00',
    cid: 101,
    page: 1,
    language: 'zh-CN',
    sourceType: 'bilibili_player_wbi_v2' as const,
    trackId: '7',
    trackUrlHost: 'aisubtitle.hdslb.com',
    fetchedAt: 1000,
    ...overrides,
  };
}

function memoryStore() {
  const sources: CurrentVideoTranscriptSourceRecord[] = [];
  const segments: CurrentVideoTranscriptSegment[] = [];
  return {
    sources,
    segments,
    upsert(evidence: CurrentVideoTranscriptEvidenceWrite): CurrentVideoTranscriptEvidenceState {
      const plan = planTranscriptEvidenceUpsert(sources, segments, evidence);
      putSources(sources, plan.sourcesToPut);
      putSegments(segments, plan.segmentsToPut);
      return plan.state;
    },
  };
}

function putSources(
  target: CurrentVideoTranscriptSourceRecord[],
  values: CurrentVideoTranscriptSourceRecord[],
): void {
  for (const value of values) {
    const index = target.findIndex(item => item.identityKey === value.identityKey);
    if (index >= 0) {
      target[index] = value;
    } else {
      target.push(value);
    }
  }
}

function putSegments(
  target: CurrentVideoTranscriptSegment[],
  values: CurrentVideoTranscriptSegment[],
): void {
  for (const value of values) {
    const index = target.findIndex(item => item.segmentId === value.segmentId);
    if (index >= 0) {
      target[index] = value;
    } else {
      target.push(value);
    }
  }
}

function videoContext(): CurrentVideoContext {
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Transcript00?p=1',
    collectedAt: 1000,
    bvid: 'BV1Transcript00',
    aid: 8800,
    cid: 101,
    title: 'Transcript cache video',
    authorName: 'Cache UP',
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: 'Main',
      total: 1,
    },
    parts: [{ page: 1, cid: 101, title: 'Main', durationSeconds: 600 }],
    chapters: [],
    description: {
      availability: 'available',
      text: 'Visible description remains the summary fallback.',
      length: 49,
    },
    sources: {
      metadata: 'available',
      description: 'available',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'unknown',
      contentText: 'unavailable',
    },
    subtitleProbe: null,
    transcriptEvidence: null,
    warnings: ['transcript_probe_pending'],
  };
}
