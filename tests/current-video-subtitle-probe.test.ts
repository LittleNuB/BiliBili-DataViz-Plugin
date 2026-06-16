import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBilibiliSubtitleSourceState,
  probeCurrentVideoSubtitleSourceWithFetcher as probeCurrentVideoSubtitleSource,
  withSubtitleSourceState,
} from "../src/shared/current-video-subtitle-state.ts";
import {
  assertAssistantPayloadAudit,
  auditAssistantPayload,
  currentVideoSummaryPayloadContract,
} from "../src/shared/assistant-payload-audit.ts";
import { buildCurrentVideoSummaryAiPayload } from "../src/shared/current-video-summary.ts";
import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
} from "../src/shared/types/current-video-context.ts";

test("normalizes available Bilibili subtitle metadata without storing raw track URLs", () => {
  const probe = normalizeBilibiliSubtitleSourceState(
    {
      subtitle: {
        subtitles: [
          {
            id: 101,
            lan: "zh-CN",
            lan_doc: "中文（AI）",
            ai_status: 1,
            ai_type: 2,
            subtitle_url:
              "//aisubtitle.hdslb.com/bfs/ai_subtitle/mock-track.json?token=redacted",
          },
          {
            id: 102,
            lan: "en-US",
            lan_doc: "English",
            subtitle_url:
              "https://aisubtitle.hdslb.com/bfs/ai_subtitle/mock-track-en.json",
          },
        ],
      },
    },
    {
      target: { bvid: "BV1Subtitle99", cid: 9901, page: 1 },
      now: 1000,
      sourceType: "bilibili_player_wbi_v2",
      sourcePath: "/x/player/wbi/v2",
    },
  );

  assert.equal(probe.status, "available");
  assert.equal(probe.available, true);
  assert.equal(probe.trackCount, 2);
  assert.deepEqual(probe.languages, ["zh-CN", "en-US"]);
  assert.equal(probe.sourceDomain, "api.bilibili.com");
  assert.equal(probe.sourcePath, "/x/player/wbi/v2");
  assert.equal(probe.needLoginSubtitle, null);
  assert.equal(probe.tracks[0].urlHost, "aisubtitle.hdslb.com");
  assert.equal(probe.tracks[0].aiStatus, 1);
  assert.equal(probe.tracks[0].aiType, 2);
  assert.equal(probe.tracks[0].hasSubtitleUrl, true);
  assert.equal(probe.segmentCount, null);
  assert.equal(probe.coverageEndSeconds, null);
  assert.doesNotMatch(
    JSON.stringify(probe),
    /mock-track\.json|token=redacted|subtitle_url/,
  );
});

test("enriches current video context with available subtitle source state but no content text", async () => {
  const context = videoContext();
  const probe = await probeCurrentVideoSubtitleSource(
    context,
    async () => ({
      subtitle: {
        subtitles: [
          {
            id: 1,
            lan: "zh-Hans",
            lan_doc: "中文",
            subtitle_url: "//aisubtitle.hdslb.com/subtitle.json",
          },
        ],
      },
    }),
    2000,
  );
  const enriched = withSubtitleSourceState(context, probe);

  assert.equal(enriched.sources.transcript, "available");
  assert.equal(enriched.sources.contentText, "unavailable");
  assert.equal(enriched.subtitleProbe?.status, "available");
  assert.ok(enriched.warnings.includes("transcript_source_available"));
  assert.ok(enriched.warnings.includes("transcript_text_not_cached"));
});

test("reports unavailable when player subtitle track list is empty", async () => {
  const probe = await probeCurrentVideoSubtitleSource(
    videoContext(),
    async () => ({ subtitle: { subtitles: [] } }),
    3000,
  );

  assert.equal(probe.status, "unavailable");
  assert.equal(probe.available, false);
  assert.equal(probe.trackCount, 0);
  assert.match(probe.message, /手动开启中文 AI 字幕/);
});

test("falls back from WBI player endpoint to v2 when WBI returns no tracks", async () => {
  const calls: string[] = [];
  const probe = await probeCurrentVideoSubtitleSource(
    videoContext(),
    async (_target, options) => {
      calls.push(options.sourcePath);
      if (options.sourcePath === "/x/player/wbi/v2") {
        return { subtitle: { subtitles: [] } };
      }
      return {
        subtitle: {
          subtitles: [
            {
              lan: "zh-CN",
              lan_doc: "中文 AI",
              ai_status: 1,
              ai_type: 0,
              subtitle_url: "//aisubtitle.hdslb.com/bfs/ai_subtitle/zh.json",
            },
          ],
        },
      };
    },
    3500,
  );

  assert.deepEqual(calls, ["/x/player/wbi/v2", "/x/player/v2"]);
  assert.equal(probe.status, "available");
  assert.equal(probe.sourceType, "bilibili_player_v2");
  assert.equal(probe.tracks[0].languageLabel, "中文 AI");
  assert.equal(probe.tracks[0].aiStatus, 1);
  assert.equal(probe.tracks[0].aiType, 0);
  assert.equal(probe.tracks[0].hasSubtitleUrl, true);
});

test("reports endpoint failure after player subtitle endpoints fail", async () => {
  const probe = await probeCurrentVideoSubtitleSource(
    videoContext(),
    async () => {
      throw new Error("REQUEST_TIMEOUT");
    },
    4000,
  );

  assert.equal(probe.status, "endpoint_failed");
  assert.equal(probe.available, false);
  assert.equal(probe.reason, "REQUEST_TIMEOUT");
  assert.doesNotMatch(
    JSON.stringify(probe),
    /SESSDATA|bili_jct|Key\.txt|Chrome\\User Data/i,
  );
});

test("reports login required only when both player endpoints require session access", async () => {
  const probe = await probeCurrentVideoSubtitleSource(
    videoContext(),
    async () => {
      throw new Error("NOT_LOGGED_IN");
    },
    5000,
  );

  assert.equal(probe.status, "login_required");
  assert.equal(probe.available, false);
  assert.ok(probe.warnings.includes("subtitle_login_required"));
});

test("reports need-login subtitle diagnostic from player response", async () => {
  const probe = await probeCurrentVideoSubtitleSource(
    videoContext(),
    async () => ({ subtitle: { need_login_subtitle: true, subtitles: [] } }),
    5500,
  );

  assert.equal(probe.status, "login_required");
  assert.equal(probe.reason, "need_login_subtitle");
  assert.equal(probe.needLoginSubtitle, true);
  assert.ok(probe.warnings.includes("subtitle_login_required"));
});

test("reports malformed player subtitle response without treating it as transcript evidence", async () => {
  const probe = await probeCurrentVideoSubtitleSource(
    videoContext(),
    async () => ({ subtitle: { subtitles: { lan: "zh-CN" } } }),
    6000,
  );

  assert.equal(probe.status, "malformed");
  assert.equal(probe.available, false);
  assert.equal(probe.trackCount, 0);
  assert.match(probe.message, /结构异常/);
});

test("reports unsupported when there is no current video context", async () => {
  const context: CurrentVideoContextResult = {
    kind: "no_context",
    url: "https://www.bilibili.com/",
    collectedAt: 7000,
    reason: "non_video_page",
    pageType: "non_video",
  };
  const probe = await probeCurrentVideoSubtitleSource(
    context,
    async () => {
      throw new Error("SHOULD_NOT_FETCH_WITHOUT_CONTEXT");
    },
    7000,
  );

  assert.equal(probe.status, "unsupported");
  assert.equal(probe.available, false);
  assert.equal(probe.reason, "no_current_video_context");
});

test("does not call player subtitle endpoints when CID is missing", async () => {
  let called = false;
  const probe = await probeCurrentVideoSubtitleSource(
    { ...videoContext(), cid: null },
    async () => {
      called = true;
      return { subtitle: { subtitles: [] } };
    },
    7500,
  );

  assert.equal(called, false);
  assert.equal(probe.status, "unsupported");
  assert.equal(probe.reason, "missing_cid");
  assert.match(probe.message, /CID 未知/);
});

test("keeps subtitle source diagnostics out of current video AI payload", async () => {
  const probe = await probeCurrentVideoSubtitleSource(
    videoContext(),
    async () => ({
      subtitle: {
        subtitles: [
          {
            id: 1,
            lan: "zh-CN",
            lan_doc: "中文",
            subtitle_url: "//aisubtitle.hdslb.com/private-track.json",
          },
        ],
      },
    }),
    8000,
  );
  const enriched = withSubtitleSourceState(videoContext(), probe);
  const payload = buildCurrentVideoSummaryAiPayload(enriched);
  const audit = auditAssistantPayload(
    payload,
    currentVideoSummaryPayloadContract,
  );
  const rawPayload = JSON.stringify(payload);

  assert.equal(payload.availableSources.transcript, "available");
  assert.equal(payload.availableSources.contentText, "unavailable");
  assert.equal(audit.passed, true, JSON.stringify(audit.violations));
  assertAssistantPayloadAudit(payload, currentVideoSummaryPayloadContract);
  assert.doesNotMatch(
    rawPayload,
    /subtitleProbe|tracks|subtitle_url|aisubtitle|watchHistory|favorites|following|feedback|SESSDATA|Key\.txt/i,
  );
});

function videoContext(): CurrentVideoContext {
  return {
    kind: "video",
    url: "https://www.bilibili.com/video/BV1Subtitle99?p=1",
    collectedAt: 1000,
    bvid: "BV1Subtitle99",
    aid: 8800,
    cid: 9901,
    title: "Subtitle probe video",
    authorName: "Probe UP",
    authorMid: 42,
    durationSeconds: 600,
    currentPart: {
      page: 1,
      title: "Main",
      total: 1,
    },
    parts: [{ page: 1, cid: 9901, title: "Main", durationSeconds: 600 }],
    chapters: [],
    description: {
      availability: "available",
      text: "Visible description used as fallback.",
      length: 37,
    },
    sources: {
      metadata: "available",
      description: "available",
      pages: "available",
      chapters: "unknown",
      transcript: "unknown",
      contentText: "unavailable",
    },
    subtitleProbe: null,
    warnings: ["transcript_probe_pending"],
  };
}
