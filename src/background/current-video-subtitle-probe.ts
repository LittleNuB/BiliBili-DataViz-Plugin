import type { CurrentVideoContextResult } from "../shared/types/current-video-context";
import { biliGet } from "./api/client";
import {
  probeCurrentVideoSubtitleSourceWithFetcher,
  type CurrentVideoSubtitlePlayerInfoFetcher,
} from "../shared/current-video-subtitle-state";

export { withSubtitleSourceState } from "../shared/current-video-subtitle-state";

export interface ProbeCurrentVideoSubtitleOptions {
  now?: number;
  fetchPlayerInfo?: CurrentVideoSubtitlePlayerInfoFetcher;
}

export async function probeCurrentVideoSubtitleSource(
  context: CurrentVideoContextResult,
  options: ProbeCurrentVideoSubtitleOptions = {},
) {
  return await probeCurrentVideoSubtitleSourceWithFetcher(
    context,
    options.fetchPlayerInfo ?? fetchBilibiliPlayerInfo,
    options.now,
  );
}

const fetchBilibiliPlayerInfo: CurrentVideoSubtitlePlayerInfoFetcher = async (
  target,
  options,
) => {
  const params: Record<string, string> = {
    bvid: target.bvid,
    cid: String(target.cid),
  };
  if (target.aid) {
    params.aid = String(target.aid);
  }

  return await biliGet<unknown>(
    options.sourcePath,
    params,
    2,
    options.sourceType === "bilibili_player_wbi_v2",
  );
};
