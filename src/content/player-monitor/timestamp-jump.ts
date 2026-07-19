import type { CurrentVideoContextResult } from '../../shared/types/current-video-context';
import type {
  CurrentVideoTimestampJumpContentPayload,
  CurrentVideoTimestampReturnContentPayload,
  CurrentVideoTimestampJumpResponse,
  CurrentVideoTimestampReturnResponse,
} from '../../shared/types/current-video-segment-retrieval';
import {
  blockedTimestampReturnResponse,
  formatTimestampJumpFailureReason,
} from '../../shared/current-video-timestamp-jump.ts';

const RETURN_POINT_TTL_MS = 10 * 60 * 1000;

export interface TimestampJumpVideoLike {
  currentTime: number;
  duration: number;
  paused: boolean;
  pause: () => void;
  play: () => Promise<void> | void;
}

export interface CurrentVideoTimestampReturnPoint {
  candidateId: string;
  bvid: string;
  cid: number | null;
  page: number;
  url: string;
  seconds: number;
  targetSeconds: number;
  sourceIdentityKey: string;
  savedAt: number;
  wasPaused: boolean;
}

export async function performConfirmedTimestampJump(input: {
  payload: CurrentVideoTimestampJumpContentPayload;
  latestContext: CurrentVideoContextResult | null;
  video: TimestampJumpVideoLike | null;
  now?: number;
}): Promise<{
  response: CurrentVideoTimestampJumpResponse;
  returnPoint: CurrentVideoTimestampReturnPoint | null;
}> {
  const now = input.now ?? Date.now();
  const payload = input.payload;

  const blocked = validateTimestampJump(payload, input.latestContext, input.video);
  if (blocked) {
    return {
      response: {
        ok: false,
        message: blocked,
        candidateId: payload.candidateId,
        targetSeconds: null,
        targetTimeLabel: null,
        returnPointSeconds: null,
        sourceLabel: payload.sourceLabel,
        confidence: payload.confidence,
      },
      returnPoint: null,
    };
  }

  const context = input.latestContext;
  const video = input.video;
  if (context?.kind !== 'video' || !video) {
    return {
      response: {
        ok: false,
        message: formatTimestampJumpFailureReason('context_mismatch'),
        candidateId: payload.candidateId,
        targetSeconds: null,
        targetTimeLabel: null,
        returnPointSeconds: null,
        sourceLabel: payload.sourceLabel,
        confidence: payload.confidence,
      },
      returnPoint: null,
    };
  }

  const returnPointSeconds = Math.max(0, video.currentTime);
  const wasPaused = video.paused;
  await seekPreservingPlaybackIntent(video, payload.targetSeconds, wasPaused);

  return {
    response: {
      ok: true,
      message: `已跳到 ${payload.targetTimeLabel}，可返回 ${formatDuration(returnPointSeconds)}。`,
      candidateId: payload.candidateId,
      targetSeconds: payload.targetSeconds,
      targetTimeLabel: payload.targetTimeLabel,
      returnPointSeconds,
      sourceLabel: payload.sourceLabel,
      confidence: payload.confidence,
    },
    returnPoint: {
      candidateId: payload.candidateId,
      bvid: context.bvid,
      cid: context.cid,
      page: context.currentPart.page,
      url: context.url,
      seconds: returnPointSeconds,
      targetSeconds: payload.targetSeconds,
      sourceIdentityKey: payload.sourceIdentityKey,
      savedAt: now,
      wasPaused,
    },
  };
}

export async function performTimestampReturn(input: {
  payload: CurrentVideoTimestampReturnContentPayload | null;
  returnPoint: CurrentVideoTimestampReturnPoint | null;
  latestContext: CurrentVideoContextResult | null;
  video: TimestampJumpVideoLike | null;
  now?: number;
}): Promise<{
  response: CurrentVideoTimestampReturnResponse;
  clearReturnPoint: boolean;
}> {
  const now = input.now ?? Date.now();
  const returnPoint = input.returnPoint;
  if (!returnPoint) {
    return {
      response: blockedTimestampReturnResponse('没有可返回的播放位置。'),
      clearReturnPoint: false,
    };
  }

  if (now - returnPoint.savedAt > RETURN_POINT_TTL_MS) {
    return {
      response: blockedTimestampReturnResponse('返回位置已过期，请重新检索并跳转。'),
      clearReturnPoint: true,
    };
  }

  if (!returnRequestMatchesReturnPoint(input.payload, returnPoint)) {
    return {
      response: {
        ok: false,
        message: formatTimestampJumpFailureReason('context_mismatch'),
        candidateId: returnPoint.candidateId,
        returnPointSeconds: returnPoint.seconds,
        targetSeconds: returnPoint.targetSeconds,
      },
      clearReturnPoint: true,
    };
  }

  if (!contextMatchesReturnPoint(input.latestContext, returnPoint)) {
    return {
      response: {
        ok: false,
        message: formatTimestampJumpFailureReason('context_mismatch'),
        candidateId: returnPoint.candidateId,
        returnPointSeconds: returnPoint.seconds,
        targetSeconds: returnPoint.targetSeconds,
      },
      clearReturnPoint: true,
    };
  }

  const videoProblem = validateVideoElement(input.video, returnPoint.seconds);
  if (videoProblem) {
    return {
      response: {
        ok: false,
        message: videoProblem,
        candidateId: returnPoint.candidateId,
        returnPointSeconds: returnPoint.seconds,
        targetSeconds: returnPoint.targetSeconds,
      },
      clearReturnPoint: false,
    };
  }

  await seekPreservingPlaybackIntent(input.video!, returnPoint.seconds, returnPoint.wasPaused);
  return {
    response: {
      ok: true,
      message: `已返回 ${formatDuration(returnPoint.seconds)}。`,
      candidateId: returnPoint.candidateId,
      returnPointSeconds: returnPoint.seconds,
      targetSeconds: returnPoint.targetSeconds,
    },
    clearReturnPoint: true,
  };
}

function validateTimestampJump(
  payload: CurrentVideoTimestampJumpContentPayload,
  latestContext: CurrentVideoContextResult | null,
  video: TimestampJumpVideoLike | null,
): string | null {
  if (!payload.confirmed) {
    return formatTimestampJumpFailureReason('confirmation_required');
  }
  if (typeof payload.sourceIdentityKey !== 'string' || !payload.sourceIdentityKey.trim()) {
    return formatTimestampJumpFailureReason('context_mismatch');
  }

  if (!contextMatchesPayload(latestContext, payload)) {
    return formatTimestampJumpFailureReason('context_mismatch');
  }

  return validateVideoElement(video, payload.targetSeconds);
}

function contextMatchesPayload(
  context: CurrentVideoContextResult | null,
  payload: CurrentVideoTimestampJumpContentPayload,
): boolean {
  if (context?.kind !== 'video') return false;
  if (context.bvid !== payload.contextBvid) return false;
  if (context.currentPart.page !== payload.contextPage) return false;
  if (typeof payload.contextCid === 'number' && context.cid !== payload.contextCid) {
    return false;
  }
  return true;
}

function returnRequestMatchesReturnPoint(
  payload: CurrentVideoTimestampReturnContentPayload | null,
  returnPoint: CurrentVideoTimestampReturnPoint,
): boolean {
  if (!payload) return false;
  if (payload.contextBvid !== returnPoint.bvid) return false;
  if (payload.contextPage !== returnPoint.page) return false;
  if (typeof payload.sourceIdentityKey !== 'string') return false;
  if (typeof returnPoint.cid === 'number' && payload.contextCid !== returnPoint.cid) {
    return false;
  }
  if (payload.sourceIdentityKey !== returnPoint.sourceIdentityKey) {
    return false;
  }
  return true;
}

function contextMatchesReturnPoint(
  context: CurrentVideoContextResult | null,
  returnPoint: CurrentVideoTimestampReturnPoint,
): boolean {
  if (context?.kind !== 'video') return false;
  if (context.bvid !== returnPoint.bvid) return false;
  if (context.currentPart.page !== returnPoint.page) return false;
  if (typeof returnPoint.cid === 'number' && context.cid !== returnPoint.cid) {
    return false;
  }
  return true;
}

function validateVideoElement(video: TimestampJumpVideoLike | null, targetSeconds: number): string | null {
  if (!video) {
    return formatTimestampJumpFailureReason('player_unavailable');
  }
  if (!Number.isFinite(targetSeconds) || targetSeconds < 0) {
    return formatTimestampJumpFailureReason('invalid_timestamp');
  }
  if (video.duration === Infinity) {
    return formatTimestampJumpFailureReason('unsupported_player');
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return formatTimestampJumpFailureReason('player_unavailable');
  }
  if (targetSeconds > video.duration + 0.5) {
    return formatTimestampJumpFailureReason('invalid_timestamp');
  }
  return null;
}

async function seekPreservingPlaybackIntent(
  video: TimestampJumpVideoLike,
  targetSeconds: number,
  wasPaused: boolean,
): Promise<void> {
  video.currentTime = Math.max(0, Math.min(targetSeconds, video.duration));
  if (wasPaused) {
    video.pause();
    return;
  }

  try {
    await video.play();
  } catch {
    // Browser autoplay rules can reject play(); currentTime was still updated.
  }
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
