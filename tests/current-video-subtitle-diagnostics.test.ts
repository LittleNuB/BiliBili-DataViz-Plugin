import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCurrentVideoSubtitleDiagnostics } from '../src/shared/current-video-subtitle-diagnostics.ts';
import type {
  CurrentVideoContext,
  CurrentVideoSubtitleSourceState,
  CurrentVideoSubtitleSourceStatus,
} from '../src/shared/types/current-video-context.ts';
import type {
  CurrentVideoTranscriptEvidenceState,
  CurrentVideoTranscriptEvidenceStatus,
} from '../src/shared/types/current-video-transcript.ts';

test('explains metadata-only state and asks user to enable Chinese AI subtitles', () => {
  const state = buildCurrentVideoSubtitleDiagnostics(videoContext({
    subtitleProbe: null,
    transcriptEvidence: null,
  }));

  assert.equal(state.status, 'enable_ai_subtitle');
  assert.equal(state.evidenceAvailable, false);
  assert.match(visibleText(state), /手动开启.?中文 AI.?字幕/);
  assert.match(visibleText(state), /不是 DeepSeek 或模型失败/);
  assertFeatureGatesUnavailable(state);
  assertNoRawUiLeak(state);
});

test('reports missing CID before subtitle detection or body caching', () => {
  const state = buildCurrentVideoSubtitleDiagnostics(videoContext({ cid: null }));

  assert.equal(state.status, 'missing_cid');
  assert.match(visibleText(state), /缺少 CID/);
  assert.match(visibleText(state), /重新检测字幕/);
  assertFeatureGatesUnavailable(state);
  assertNoRawUiLeak(state);
});

test('reports detected subtitle tracks before subtitle body is cached', () => {
  const state = buildCurrentVideoSubtitleDiagnostics(videoContext({
    subtitleProbe: subtitleProbe('available', {
      trackCount: 1,
      languages: ['zh-CN'],
    }),
    transcriptEvidence: evidence('missing'),
  }));

  assert.equal(state.status, 'track_found');
  assert.match(visibleText(state), /已发现字幕轨道/);
  assert.match(visibleText(state), /读取并缓存字幕正文/);
  assertFeatureGatesUnavailable(state);
  assertNoRawUiLeak(state);
});

test('reports active cached subtitle body as enabling downstream current-video tools', () => {
  const state = buildCurrentVideoSubtitleDiagnostics(videoContext({
    subtitleProbe: subtitleProbe('available'),
    transcriptEvidence: evidence('cached', {
      active: true,
      segmentCount: 12,
      coverageStartSeconds: 0,
      coverageEndSeconds: 96,
      sourceHash: 'hash-should-not-be-visible',
    }),
  }));

  assert.equal(state.status, 'cached');
  assert.equal(state.evidenceAvailable, true);
  assert.match(visibleText(state), /已缓存字幕正文/);
  assert.match(visibleText(state), /摘要、知识节点、片段检索和手动跳转/);
  assert.ok(state.featureGates.every(item => item.available));
  assertNoRawUiLeak(state);
});

test('maps subtitle body cache failures to user-actionable diagnostics', () => {
  const cases: Array<{
    evidence: CurrentVideoTranscriptEvidenceState;
    expected: string;
    text: RegExp;
  }> = [
    { evidence: evidence('endpoint_failed'), expected: 'fetch_failed', text: /字幕正文拉取失败/ },
    { evidence: evidence('empty'), expected: 'empty', text: /字幕正文为空/ },
    { evidence: evidence('malformed'), expected: 'malformed', text: /字幕正文结构异常/ },
    { evidence: evidence('language_mismatch'), expected: 'language_mismatch', text: /字幕语言不匹配/ },
    { evidence: evidence('login_required'), expected: 'login_required', text: /登录或访问权限/ },
    { evidence: evidence('stale'), expected: 'stale', text: /不匹配/ },
    {
      evidence: evidence('track_unavailable', { reason: 'subtitle_host_unsupported' }),
      expected: 'unsupported_host',
      text: /不受支持/,
    },
  ];

  for (const item of cases) {
    const state = buildCurrentVideoSubtitleDiagnostics(videoContext({
      subtitleProbe: subtitleProbe('available'),
      transcriptEvidence: item.evidence,
    }));
    assert.equal(state.status, item.expected);
    assert.match(visibleText(state), item.text);
    assertFeatureGatesUnavailable(state);
    assertNoRawUiLeak(state);
  }
});

test('maps source-probe errors to Chinese user states without exposing internals', () => {
  const cases: Array<{
    probe: CurrentVideoSubtitleSourceState;
    expected: string;
    text: RegExp;
  }> = [
    { probe: subtitleProbe('unavailable'), expected: 'no_track', text: /没有返回字幕轨道/ },
    { probe: subtitleProbe('login_required'), expected: 'login_required', text: /登录或访问权限/ },
    { probe: subtitleProbe('endpoint_failed'), expected: 'fetch_failed', text: /字幕来源检测失败/ },
    { probe: subtitleProbe('malformed'), expected: 'malformed', text: /字幕来源结构异常/ },
  ];

  for (const item of cases) {
    const state = buildCurrentVideoSubtitleDiagnostics(videoContext({
      subtitleProbe: item.probe,
      transcriptEvidence: evidence('missing'),
    }));
    assert.equal(state.status, item.expected);
    assert.match(visibleText(state), item.text);
    assertFeatureGatesUnavailable(state);
    assertNoRawUiLeak(state);
  }
});

test('shows explicit reading state during re-detection', () => {
  const state = buildCurrentVideoSubtitleDiagnostics(videoContext(), { refreshing: true });

  assert.equal(state.status, 'reading_body');
  assert.equal(state.canRetry, false);
  assert.match(visibleText(state), /正在读取字幕正文/);
  assert.match(visibleText(state), /重新检测字幕来源/);
  assertNoRawUiLeak(state);
});

function assertFeatureGatesUnavailable(state: ReturnType<typeof buildCurrentVideoSubtitleDiagnostics>): void {
  assert.ok(state.featureGates.every(item => !item.available));
  assert.match(visibleText(state), /不能完整总结|不能定位具体片段|不会提供跳转目标/);
}

function assertNoRawUiLeak(state: ReturnType<typeof buildCurrentVideoSubtitleDiagnostics>): void {
  assert.doesNotMatch(
    visibleText(state),
    /sourceHash|segmentId|subtitle_url|endpoint path|\/x\/player|token|Cookie|profile|登录态|Key\.txt|本地 key|Chrome\\User Data/i,
  );
}

function visibleText(state: ReturnType<typeof buildCurrentVideoSubtitleDiagnostics>): string {
  return [
    state.title,
    state.message,
    state.action,
    ...state.detailLines,
    ...state.featureGates.map(item => `${item.label}:${item.message}`),
  ].join('\n');
}

function videoContext(overrides: Partial<CurrentVideoContext> = {}): CurrentVideoContext {
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Diagnostic00?p=1',
    collectedAt: 1000,
    bvid: 'BV1Diagnostic00',
    aid: 8800,
    cid: 9901,
    title: 'Subtitle diagnostic video',
    authorName: 'Diagnostic UP',
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: 'Main',
      total: 1,
    },
    parts: [{ page: 1, cid: 9901, title: 'Main', durationSeconds: 600 }],
    chapters: [],
    description: {
      availability: 'available',
      text: 'Visible description used as bounded metadata evidence.',
      length: 54,
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
    ...overrides,
  };
}

function subtitleProbe(
  status: CurrentVideoSubtitleSourceStatus,
  overrides: Partial<CurrentVideoSubtitleSourceState> = {},
): CurrentVideoSubtitleSourceState {
  return {
    status,
    available: status === 'available',
    checkedAt: 2000,
    bvid: 'BV1Diagnostic00',
    cid: 9901,
    page: 1,
    sourceType: 'bilibili_player_wbi_v2',
    sourceDomain: 'api.bilibili.com',
    sourcePath: '/x/player/wbi/v2',
    needLoginSubtitle: null,
    trackCount: status === 'available' ? 1 : 0,
    segmentCount: null,
    coverageStartSeconds: null,
    coverageEndSeconds: null,
    languages: status === 'available' ? ['zh-CN'] : [],
    tracks: [],
    reason: status === 'available' ? 'subtitle_tracks_available' : `subtitle_${status}`,
    message: 'raw probe message should not be required for user diagnostics',
    warnings: [],
    ...overrides,
  };
}

function evidence(
  status: CurrentVideoTranscriptEvidenceStatus,
  overrides: Partial<CurrentVideoTranscriptEvidenceState> = {},
): CurrentVideoTranscriptEvidenceState {
  return {
    status,
    active: status === 'cached',
    checkedAt: 3000,
    bvid: 'BV1Diagnostic00',
    cid: 9901,
    page: 1,
    language: 'zh-CN',
    source: status === 'cached' ? 'bilibili_subtitle' : null,
    sourceType: 'bilibili_player_wbi_v2',
    sourceHash: status === 'cached' ? 'internal-hash' : null,
    segmentCount: status === 'cached' ? 6 : 0,
    staleSegmentCount: 0,
    coverageStartSeconds: status === 'cached' ? 0 : null,
    coverageEndSeconds: status === 'cached' ? 60 : null,
    fetchedAt: status === 'cached' ? 3000 : null,
    updatedAt: status === 'cached' ? 3000 : null,
    reason: `transcript_${status}`,
    message: 'raw evidence message should not be required for user diagnostics',
    warnings: [],
    ...overrides,
  };
}
