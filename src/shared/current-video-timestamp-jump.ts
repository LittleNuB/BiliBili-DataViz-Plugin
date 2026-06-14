import type { CurrentVideoContextResult } from './types/current-video-context';
import type {
  CurrentVideoSegmentRetrievalCandidate,
  CurrentVideoTimestampJumpDisabledReason,
  CurrentVideoTimestampJumpPreview,
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from './types/current-video-segment-retrieval';

export const CURRENT_VIDEO_TIMESTAMP_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;
export const CURRENT_VIDEO_TIMESTAMP_JUMP_MIN_CONFIDENCE = 0.62;

export function buildCurrentVideoTimestampJumpPreview(
  context: CurrentVideoContextResult,
  candidate: Omit<CurrentVideoSegmentRetrievalCandidate, 'jumpPreview'>,
  options: {
    now?: number;
    contextMaxAgeMs?: number;
  } = {},
): CurrentVideoTimestampJumpPreview {
  const now = options.now ?? Date.now();
  const evidencePreview = limitText(candidate.evidenceText, 140);
  const base = {
    requiresConfirmation: true as const,
    targetSeconds: null,
    targetTimeLabel: null,
    sourceLabel: candidate.sourceLabel,
    confidence: candidate.confidence,
    confidenceLabel: candidate.confidenceLabel,
    evidencePreview,
  };

  if (context.kind !== 'video') {
    return disabledPreview(base, 'no_context', '当前没有可用的视频页，不能跳转。');
  }

  const contextMaxAgeMs = options.contextMaxAgeMs ?? CURRENT_VIDEO_TIMESTAMP_CONTEXT_MAX_AGE_MS;
  if (now - context.collectedAt > contextMaxAgeMs) {
    return disabledPreview(base, 'stale_context', '当前视频上下文已过期，请刷新视频页或重新打开弹窗后再跳转。');
  }

  if (candidate.binding.kind === 'metadata_hint' || candidate.source === 'metadata_hint' || candidate.source === 'description_hint') {
    return disabledPreview(base, 'metadata_only', '该候选只来自视频信息或简介，无法定位到具体播放时间。');
  }

  if (candidate.confidence < CURRENT_VIDEO_TIMESTAMP_JUMP_MIN_CONFIDENCE) {
    return disabledPreview(base, 'low_confidence', '匹配置信度较低，默认不允许直接跳转。请换更具体的关键词后再试。');
  }

  const targetSeconds = candidate.startSeconds;
  if (targetSeconds === null) {
    return disabledPreview(base, 'not_timed_candidate', '该候选没有可定位时间点，不能跳转。');
  }

  if (!Number.isFinite(targetSeconds) || targetSeconds < 0) {
    return disabledPreview(base, 'invalid_timestamp', '候选时间点无效，不能跳转。');
  }

  if (
    typeof context.durationSeconds === 'number'
    && Number.isFinite(context.durationSeconds)
    && context.durationSeconds > 0
    && targetSeconds > context.durationSeconds + 1
  ) {
    return disabledPreview(base, 'invalid_timestamp', '候选时间点超出当前视频时长，不能跳转。');
  }

  const targetTimeLabel = formatDuration(targetSeconds);
  return {
    ...base,
    canJump: true,
    disabledReason: null,
    targetSeconds,
    targetTimeLabel,
    message: `确认后会跳到 ${targetTimeLabel}，并记录当前播放位置用于返回。`,
  };
}

export function blockedTimestampJumpResponse(
  candidateId: string,
  reason: CurrentVideoTimestampJumpDisabledReason,
  message: string,
): CurrentVideoTimestampJumpResponse {
  return {
    ok: false,
    message,
    candidateId,
    targetSeconds: null,
    targetTimeLabel: null,
    returnPointSeconds: null,
    sourceLabel: null,
    confidence: null,
  };
}

export function blockedTimestampReturnResponse(message: string): CurrentVideoTimestampReturnResponse {
  return {
    ok: false,
    message,
    candidateId: null,
    returnPointSeconds: null,
    targetSeconds: null,
  };
}

export function formatTimestampJumpFailureReason(reason: CurrentVideoTimestampJumpDisabledReason): string {
  switch (reason) {
    case 'confirmation_required':
      return '需要先确认跳转。';
    case 'no_context':
      return '当前没有可用的视频页，不能跳转。';
    case 'stale_context':
      return '当前视频上下文已过期，请刷新视频页或重新打开弹窗后再跳转。';
    case 'not_timed_candidate':
      return '该候选没有可定位时间点，不能跳转。';
    case 'metadata_only':
      return '该候选只来自视频信息或简介，无法定位到具体播放时间。';
    case 'low_confidence':
      return '匹配置信度较低，默认不允许直接跳转。请换更具体的关键词后再试。';
    case 'invalid_timestamp':
      return '候选时间点无效，不能跳转。';
    case 'candidate_not_found':
      return '候选已变化，请重新检索后再跳转。';
    case 'context_mismatch':
      return '当前视频已经变化，为避免跳错视频，本次跳转已取消。';
    case 'player_unavailable':
      return '没有找到可控制的视频播放器，请保持 B 站视频页打开后再试。';
    case 'unsupported_player':
      return '当前播放器不支持精确跳转，直播或无时长视频不能使用此功能。';
    default:
      return '当前候选不能跳转。';
  }
}

function disabledPreview(
  base: Omit<CurrentVideoTimestampJumpPreview, 'canJump' | 'disabledReason' | 'message'>,
  disabledReason: CurrentVideoTimestampJumpDisabledReason,
  message: string,
): CurrentVideoTimestampJumpPreview {
  return {
    ...base,
    canJump: false,
    disabledReason,
    message,
  };
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function limitText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}
