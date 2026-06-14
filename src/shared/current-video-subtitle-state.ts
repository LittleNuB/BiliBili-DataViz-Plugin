import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
  CurrentVideoSubtitleSourceState,
  CurrentVideoSubtitleSourceStatus,
  CurrentVideoSubtitleSourceType,
  CurrentVideoSubtitleTrackDiagnostic,
} from "./types/current-video-context";

const BILIBILI_API_BASE = "https://api.bilibili.com";

interface SubtitleProbeTarget {
  bvid: string | null;
  cid: number | null;
  page: number | null;
}

export interface PlayerInfoFetchOptions {
  sourceType: CurrentVideoSubtitleSourceType;
  sourcePath: string;
}

export type CurrentVideoSubtitlePlayerInfoFetcher = (
  target: { bvid: string; cid: number; page: number | null },
  options: PlayerInfoFetchOptions,
) => Promise<unknown>;

export async function probeCurrentVideoSubtitleSourceWithFetcher(
  context: CurrentVideoContextResult,
  fetchPlayerInfo: CurrentVideoSubtitlePlayerInfoFetcher,
  now = Date.now(),
): Promise<CurrentVideoSubtitleSourceState> {
  if (context.kind !== "video") {
    return buildCurrentVideoSubtitleSourceState({
      status: "unsupported",
      target: { bvid: null, cid: null, page: null },
      now,
      reason: "no_current_video_context",
      message:
        "当前没有可探测的 B 站视频上下文；只能保留元数据/简介 fallback。",
      warnings: ["no_current_video_context"],
    });
  }

  const target = {
    bvid: context.bvid,
    cid: context.cid,
    page: context.currentPart.page,
  };

  if (!context.cid) {
    return buildCurrentVideoSubtitleSourceState({
      status: "unsupported",
      target,
      now,
      reason: "missing_cid",
      message:
        "当前视频缺少 CID，暂时无法探测 B 站字幕来源；只能保留元数据/简介 fallback。",
      warnings: ["cid_unknown"],
    });
  }

  let sawLoginRequired = false;
  let lastError: string | null = null;

  for (const attempt of [
    {
      sourceType: "bilibili_player_wbi_v2" as const,
      sourcePath: "/x/player/wbi/v2",
    },
    { sourceType: "bilibili_player_v2" as const, sourcePath: "/x/player/v2" },
  ]) {
    try {
      const data = await fetchPlayerInfo(
        {
          bvid: context.bvid,
          cid: context.cid,
          page: context.currentPart.page,
        },
        attempt,
      );
      return normalizeBilibiliSubtitleSourceState(data, {
        target,
        now,
        sourceType: attempt.sourceType,
        sourcePath: attempt.sourcePath,
      });
    } catch (error) {
      const message = errorMessage(error);
      lastError = message;
      if (isLoginRequiredError(message)) {
        sawLoginRequired = true;
        continue;
      }
      if (attempt.sourceType === "bilibili_player_wbi_v2") {
        continue;
      }
    }
  }

  if (sawLoginRequired) {
    return buildCurrentVideoSubtitleSourceState({
      status: "login_required",
      target,
      now,
      sourceType: "bilibili_player_v2",
      sourcePath: "/x/player/v2",
      reason: "login_required",
      message:
        "B 站字幕接口要求当前浏览器会话具备访问权限；当前只能保留元数据/简介 fallback。",
      warnings: ["subtitle_login_required"],
    });
  }

  return buildCurrentVideoSubtitleSourceState({
    status: "endpoint_failed",
    target,
    now,
    sourceType: "bilibili_player_v2",
    sourcePath: "/x/player/v2",
    reason: lastError ?? "endpoint_failed",
    message: "B 站字幕接口请求失败；当前只能保留元数据/简介 fallback。",
    warnings: ["subtitle_endpoint_failed"],
  });
}

export function withSubtitleSourceState(
  context: CurrentVideoContext,
  subtitleProbe: CurrentVideoSubtitleSourceState,
): CurrentVideoContext {
  const transcript = subtitleProbe.available ? "available" : "unavailable";
  const warnings = new Set(
    context.warnings.filter(
      (warning) => warning !== "transcript_probe_pending",
    ),
  );

  if (subtitleProbe.available) {
    warnings.add("transcript_source_available");
    warnings.add("transcript_text_not_cached");
  } else {
    warnings.add(`transcript_${subtitleProbe.status}`);
  }

  return {
    ...context,
    sources: {
      ...context.sources,
      transcript,
      contentText: "unavailable",
    },
    subtitleProbe,
    warnings: Array.from(warnings),
  };
}

export function normalizeBilibiliSubtitleSourceState(
  data: unknown,
  options: {
    target: SubtitleProbeTarget;
    now: number;
    sourceType: CurrentVideoSubtitleSourceType;
    sourcePath: string;
  },
): CurrentVideoSubtitleSourceState {
  const root = asRecord(data);
  const subtitle = asRecord(root?.subtitle);

  if (!subtitle) {
    return buildCurrentVideoSubtitleSourceState({
      status: "unsupported",
      target: options.target,
      now: options.now,
      sourceType: options.sourceType,
      sourcePath: options.sourcePath,
      reason: "subtitle_field_missing",
      message:
        "B 站播放器接口没有返回字幕字段；当前只能保留元数据/简介 fallback。",
      warnings: ["subtitle_field_missing"],
    });
  }

  const rawTracks = subtitle.subtitles;
  if (!Array.isArray(rawTracks)) {
    return buildCurrentVideoSubtitleSourceState({
      status: "malformed",
      target: options.target,
      now: options.now,
      sourceType: options.sourceType,
      sourcePath: options.sourcePath,
      reason: "subtitle_tracks_not_array",
      message: "B 站字幕接口返回结构异常；当前不会把它当作可用 transcript。",
      warnings: ["subtitle_malformed"],
    });
  }

  if (rawTracks.length === 0) {
    return buildCurrentVideoSubtitleSourceState({
      status: "unavailable",
      target: options.target,
      now: options.now,
      sourceType: options.sourceType,
      sourcePath: options.sourcePath,
      reason: "subtitle_tracks_empty",
      message:
        "当前视频没有可用字幕来源；只能基于元数据/简介，不能做完整视频总结。",
      warnings: ["transcript_unavailable"],
    });
  }

  const tracks = rawTracks
    .map((track) => normalizeSubtitleTrack(track, options.sourceType))
    .filter((track): track is CurrentVideoSubtitleTrackDiagnostic =>
      Boolean(track),
    );

  if (tracks.length === 0) {
    return buildCurrentVideoSubtitleSourceState({
      status: "malformed",
      target: options.target,
      now: options.now,
      sourceType: options.sourceType,
      sourcePath: options.sourcePath,
      reason: "subtitle_tracks_unusable",
      message:
        "B 站字幕接口返回了字幕列表，但没有可识别的语言或 track 信息；当前不会把它当作可用 transcript。",
      warnings: ["subtitle_malformed"],
    });
  }

  const segmentCounts = tracks
    .map((track) => track.segmentCount)
    .filter((value): value is number => typeof value === "number");
  const coverageStarts = tracks
    .map((track) => track.coverageStartSeconds)
    .filter((value): value is number => typeof value === "number");
  const coverageEnds = tracks
    .map((track) => track.coverageEndSeconds)
    .filter((value): value is number => typeof value === "number");
  const languages = Array.from(
    new Set(
      tracks
        .map((track) => track.language)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return buildCurrentVideoSubtitleSourceState({
    status: "available",
    target: options.target,
    now: options.now,
    sourceType: options.sourceType,
    sourcePath: options.sourcePath,
    reason: "subtitle_tracks_available",
    message: `已探测到 ${tracks.length} 条字幕 track；本版本只记录来源状态，不缓存字幕正文，也不会据此生成完整视频总结。`,
    warnings: ["transcript_source_available", "transcript_text_not_cached"],
    tracks,
    trackCount: tracks.length,
    segmentCount: sumOrNull(segmentCounts),
    coverageStartSeconds:
      coverageStarts.length > 0 ? Math.min(...coverageStarts) : null,
    coverageEndSeconds:
      coverageEnds.length > 0 ? Math.max(...coverageEnds) : null,
    languages,
  });
}

export function buildCurrentVideoSubtitleSourceState(input: {
  status: CurrentVideoSubtitleSourceStatus;
  target: SubtitleProbeTarget;
  now: number;
  sourceType?: CurrentVideoSubtitleSourceType;
  sourcePath?: string | null;
  reason: string;
  message: string;
  warnings: string[];
  tracks?: CurrentVideoSubtitleTrackDiagnostic[];
  trackCount?: number;
  segmentCount?: number | null;
  coverageStartSeconds?: number | null;
  coverageEndSeconds?: number | null;
  languages?: string[];
}): CurrentVideoSubtitleSourceState {
  const sourcePath = input.sourcePath ?? null;
  return {
    status: input.status,
    available: input.status === "available",
    checkedAt: input.now,
    bvid: input.target.bvid,
    cid: input.target.cid,
    page: input.target.page,
    sourceType: input.sourceType ?? "none",
    sourceDomain: sourcePath
      ? new URL(sourcePath, BILIBILI_API_BASE).hostname
      : null,
    sourcePath,
    trackCount: input.trackCount ?? input.tracks?.length ?? 0,
    segmentCount: input.segmentCount ?? null,
    coverageStartSeconds: input.coverageStartSeconds ?? null,
    coverageEndSeconds: input.coverageEndSeconds ?? null,
    languages: input.languages ?? [],
    tracks: input.tracks ?? [],
    reason: input.reason,
    message: input.message,
    warnings: input.warnings,
  };
}

function normalizeSubtitleTrack(
  value: unknown,
  sourceType: CurrentVideoSubtitleSourceType,
): CurrentVideoSubtitleTrackDiagnostic | null {
  const track = asRecord(value);
  if (!track) return null;

  const language = normalizeString(track.lan ?? track.lang ?? track.language);
  const languageLabel = normalizeString(
    track.lan_doc ?? track.language_label ?? track.label,
  );
  const id = normalizeString(track.id ?? track.ai_type ?? track.type);
  const urlHost = subtitleUrlHost(
    normalizeString(track.subtitle_url ?? track.url),
  );
  const segments = Array.isArray(track.body)
    ? track.body.map(asRecord).filter(Boolean)
    : [];
  const segmentTimes = segments
    .map((segment) => ({
      from: normalizeNonNegativeNumber(
        segment?.from ?? segment?.start ?? segment?.start_time,
      ),
      to: normalizeNonNegativeNumber(
        segment?.to ?? segment?.end ?? segment?.end_time,
      ),
    }))
    .filter((segment) => segment.from !== null || segment.to !== null);

  if (!language && !languageLabel && !id && !urlHost) return null;

  return {
    id,
    language,
    languageLabel,
    sourceType,
    urlHost,
    segmentCount: segments.length > 0 ? segments.length : null,
    coverageStartSeconds:
      segmentTimes.length > 0
        ? Math.min(
            ...segmentTimes.map((segment) => segment.from ?? segment.to ?? 0),
          )
        : null,
    coverageEndSeconds:
      segmentTimes.length > 0
        ? Math.max(
            ...segmentTimes.map((segment) => segment.to ?? segment.from ?? 0),
          )
        : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 1000) / 1000;
}

function subtitleUrlHost(value: string | null): string | null {
  if (!value) return null;
  try {
    const withProtocol = value.startsWith("//") ? `https:${value}` : value;
    return new URL(withProtocol).hostname;
  } catch {
    return null;
  }
}

function sumOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function isLoginRequiredError(message: string): boolean {
  return message === "NOT_LOGGED_IN" || /-101/.test(message);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
