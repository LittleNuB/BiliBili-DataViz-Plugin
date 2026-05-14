import type { BiliVizContentMessage, PlayerHeartbeatPayload } from '../../shared/types/messages';
import type { VideoContext } from './event-capture';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

export function startHeartbeat(
  video: HTMLVideoElement,
  ctx: VideoContext,
  send: (msg: BiliVizContentMessage) => void,
  interval = DEFAULT_HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    if (!video.duration) return;

    send({
      action: 'PLAYER_HEARTBEAT',
      payload: {
        bvid: ctx.bvid,
        cid: ctx.cid,
        currentTime: video.currentTime,
        duration: video.duration,
        playbackRate: video.playbackRate,
      } as PlayerHeartbeatPayload,
    });
  }, interval);

  console.log(`[BiliViz] Heartbeat started (${interval}ms interval)`);

  return () => {
    clearInterval(timer);
    console.log('[BiliViz] Heartbeat stopped');
  };
}
