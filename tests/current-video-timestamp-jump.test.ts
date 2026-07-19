import assert from 'node:assert/strict';
import test from 'node:test';
import {
  performConfirmedTimestampJump,
  performTimestampReturn,
  type CurrentVideoTimestampReturnPoint,
  type TimestampJumpVideoLike,
} from '../src/content/player-monitor/timestamp-jump.ts';
import type { CurrentVideoContext } from '../src/shared/types/current-video-context.ts';
import type { CurrentVideoTimestampJumpContentPayload } from '../src/shared/types/current-video-segment-retrieval.ts';

test('confirmed timestamp jump seeks the player and records a bound return point', async () => {
  const video = mockVideo({ currentTime: 12, duration: 180, paused: false });
  const result = await performConfirmedTimestampJump({
    payload: jumpPayload(),
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: true,
    now: 5000,
  });

  assert.equal(result.response.ok, true);
  assert.equal(video.currentTime, 42);
  assert.equal(video.playCalls, 1);
  assert.equal(result.response.returnPointSeconds, 12);
  assert.equal(result.returnPoint?.seconds, 12);
  assert.equal(result.returnPoint?.bvid, 'BV1Jump000');
  assert.equal(result.returnPoint?.page, 1);
  assert.equal(result.returnPoint?.sourceIdentityKey, sourceIdentityKey());
});

test('unconfirmed timestamp jump does not seek automatically', async () => {
  const video = mockVideo({ currentTime: 12, duration: 180, paused: true });
  const result = await performConfirmedTimestampJump({
    payload: { ...jumpPayload(), confirmed: false },
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: true,
  });

  assert.equal(result.response.ok, false);
  assert.equal(video.currentTime, 12);
  assert.equal(video.pauseCalls, 0);
  assert.equal(result.returnPoint, null);
  assert.ok(result.response.message.includes('确认'));
});

test('return action seeks back to the original position and clears the return point', async () => {
  const video = mockVideo({ currentTime: 42, duration: 180, paused: false });
  const returnPoint: CurrentVideoTimestampReturnPoint = {
    candidateId: 'candidate:segment:safe',
    bvid: 'BV1Jump000',
    cid: 101,
    page: 1,
    url: 'https://www.bilibili.com/video/BV1Jump000',
    seconds: 12,
    targetSeconds: 42,
    sourceIdentityKey: sourceIdentityKey(),
    savedAt: 5000,
    wasPaused: false,
  };

  const result = await performTimestampReturn({
    payload: returnPayload(),
    returnPoint,
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: true,
    now: 6000,
  });

  assert.equal(result.response.ok, true);
  assert.equal(video.currentTime, 12);
  assert.equal(video.playCalls, 1);
  assert.equal(result.clearReturnPoint, true);
});

test('player unavailable fails safely without changing state', async () => {
  const result = await performConfirmedTimestampJump({
    payload: jumpPayload(),
    latestContext: videoContext(),
    video: null,
    operationLeaseAuthorized: true,
  });

  assert.equal(result.response.ok, false);
  assert.equal(result.returnPoint, null);
  assert.ok(result.response.message.includes('没有找到可控制的视频播放器'));
});

test('wrong video context blocks cross-video jump', async () => {
  const video = mockVideo({ currentTime: 12, duration: 180, paused: true });
  const result = await performConfirmedTimestampJump({
    payload: jumpPayload(),
    latestContext: { ...videoContext(), bvid: 'BV1Other000' },
    video,
    operationLeaseAuthorized: true,
  });

  assert.equal(result.response.ok, false);
  assert.equal(video.currentTime, 12);
  assert.ok(result.response.message.includes('当前视频已经变化'));
});

test('cid mismatch blocks jump even when bvid still matches', async () => {
  const video = mockVideo({ currentTime: 12, duration: 180, paused: true });
  const result = await performConfirmedTimestampJump({
    payload: jumpPayload(),
    latestContext: { ...videoContext(), cid: 202 },
    video,
    operationLeaseAuthorized: true,
  });

  assert.equal(result.response.ok, false);
  assert.equal(video.currentTime, 12);
  assert.ok(result.response.message.includes('当前视频已经变化'));
});

test('missing exact source in jump payload is rejected without seeking', async () => {
  const video = mockVideo({ currentTime: 12, duration: 180, paused: true });
  const payload = { ...jumpPayload() } as Partial<CurrentVideoTimestampJumpContentPayload>;
  delete payload.sourceIdentityKey;
  const result = await performConfirmedTimestampJump({
    payload: payload as CurrentVideoTimestampJumpContentPayload,
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: true,
  });

  assert.equal(result.response.ok, false);
  assert.equal(video.currentTime, 12);
  assert.equal(result.returnPoint, null);
  assert.ok(result.response.message.includes('当前视频已经变化'));
});

test('denied operation lease blocks a delivered jump before seeking', async () => {
  const video = mockVideo({ currentTime: 12, duration: 180, paused: true });
  const result = await performConfirmedTimestampJump({
    payload: jumpPayload(),
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: false,
  });

  assert.equal(result.response.ok, false);
  assert.equal(video.currentTime, 12);
  assert.equal(video.playCalls, 0);
  assert.equal(video.pauseCalls, 0);
  assert.equal(result.returnPoint, null);
});

test('denied operation lease blocks a delivered return before seeking', async () => {
  const video = mockVideo({ currentTime: 42, duration: 180, paused: true });
  const result = await performTimestampReturn({
    payload: returnPayload(),
    returnPoint: {
      candidateId: 'candidate:segment:safe',
      bvid: 'BV1Jump000',
      cid: 101,
      page: 1,
      url: 'https://www.bilibili.com/video/BV1Jump000',
      seconds: 12,
      targetSeconds: 42,
      sourceIdentityKey: sourceIdentityKey(),
      savedAt: 5000,
      wasPaused: true,
    },
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: false,
    now: 6000,
  });

  assert.equal(result.response.ok, false);
  assert.equal(result.clearReturnPoint, true);
  assert.equal(video.currentTime, 42);
  assert.equal(video.playCalls, 0);
  assert.equal(video.pauseCalls, 0);
});

test('invalid timestamp and live player are blocked before seek', async () => {
  const video = mockVideo({ currentTime: 12, duration: 40, paused: true });
  const invalid = await performConfirmedTimestampJump({
    payload: { ...jumpPayload(), targetSeconds: 80 },
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: true,
  });
  assert.equal(invalid.response.ok, false);
  assert.equal(video.currentTime, 12);
  assert.ok(invalid.response.message.includes('候选时间点无效'));

  const live = await performConfirmedTimestampJump({
    payload: jumpPayload(),
    latestContext: videoContext(),
    video: mockVideo({ currentTime: 12, duration: Infinity, paused: true }),
    operationLeaseAuthorized: true,
  });
  assert.equal(live.response.ok, false);
  assert.ok(live.response.message.includes('直播或无时长视频'));
});

test('stale return point is not reused across old playback context', async () => {
  const video = mockVideo({ currentTime: 42, duration: 180, paused: true });
  const result = await performTimestampReturn({
    payload: returnPayload(),
    returnPoint: {
      candidateId: 'candidate:segment:safe',
      bvid: 'BV1Jump000',
      cid: 101,
      page: 1,
      url: 'https://www.bilibili.com/video/BV1Jump000',
      seconds: 12,
      targetSeconds: 42,
      sourceIdentityKey: sourceIdentityKey(),
      savedAt: 0,
      wasPaused: true,
    },
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: true,
    now: 10 * 60 * 1000 + 1,
  });

  assert.equal(result.response.ok, false);
  assert.equal(result.clearReturnPoint, true);
  assert.equal(video.currentTime, 42);
  assert.ok(result.response.message.includes('已过期'));
});

test('return action rejects a changed exact source before seeking', async () => {
  const video = mockVideo({ currentTime: 42, duration: 180, paused: true });
  const result = await performTimestampReturn({
    payload: { ...returnPayload(), sourceIdentityKey: `${sourceIdentityKey()}:new` },
    returnPoint: {
      candidateId: 'candidate:segment:safe',
      bvid: 'BV1Jump000',
      cid: 101,
      page: 1,
      url: 'https://www.bilibili.com/video/BV1Jump000',
      seconds: 12,
      targetSeconds: 42,
      sourceIdentityKey: sourceIdentityKey(),
      savedAt: 5000,
      wasPaused: true,
    },
    latestContext: videoContext(),
    video,
    operationLeaseAuthorized: true,
    now: 6000,
  });

  assert.equal(result.response.ok, false);
  assert.equal(result.clearReturnPoint, true);
  assert.equal(video.currentTime, 42);
  assert.equal(video.pauseCalls, 0);
});

function jumpPayload(): CurrentVideoTimestampJumpContentPayload {
  return {
    candidateId: 'candidate:segment:safe',
    confirmed: true,
    contextBvid: 'BV1Jump000',
    contextCid: 101,
    contextPage: 1,
    contextUrl: 'https://www.bilibili.com/video/BV1Jump000',
    contextCollectedAt: 1000,
    targetSeconds: 42,
    targetTimeLabel: '0:42',
    sourceLabel: '可定位字幕证据',
    confidence: 0.86,
    confidenceLabel: '高',
    evidencePreview: '讲到模型架构的字幕片段。',
    sourceIdentityKey: sourceIdentityKey(),
    operationLeaseId: 'lease:jump:test',
  };
}

function returnPayload() {
  return {
    contextBvid: 'BV1Jump000',
    contextCid: 101,
    contextPage: 1,
    sourceIdentityKey: sourceIdentityKey(),
    operationLeaseId: 'lease:return:test',
  };
}

function sourceIdentityKey(): string {
  return 'primary-text:bilibili_subtitle:BV1Jump000:101:1:zh-cn:jump-source';
}

function videoContext(): CurrentVideoContext {
  return {
    kind: 'video',
    url: 'https://www.bilibili.com/video/BV1Jump000',
    collectedAt: 1000,
    bvid: 'BV1Jump000',
    cid: 101,
    title: 'Jump test video',
    authorName: 'Mock UP',
    authorMid: 42,
    durationSeconds: 180,
    currentPart: {
      page: 1,
      title: '正片',
      total: 1,
    },
    parts: [{ page: 1, cid: 101, title: '正片', durationSeconds: 180 }],
    chapters: [],
    description: {
      availability: 'available',
      text: 'mock description',
      length: 16,
    },
    sources: {
      metadata: 'available',
      description: 'available',
      pages: 'available',
      chapters: 'unknown',
      transcript: 'available',
      contentText: 'unavailable',
    },
    warnings: [],
  };
}

function mockVideo(input: {
  currentTime: number;
  duration: number;
  paused: boolean;
}): TimestampJumpVideoLike & { playCalls: number; pauseCalls: number } {
  return {
    currentTime: input.currentTime,
    duration: input.duration,
    paused: input.paused,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls += 1;
      this.paused = false;
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
  };
}
