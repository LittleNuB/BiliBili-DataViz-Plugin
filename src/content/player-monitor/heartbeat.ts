import type { BiliVizContentMessage, PlayerHeartbeatPayload } from '../../shared/types/messages';
import type { VideoContext } from './event-capture';
import { HEARTBEAT_INTERVAL_MS } from '../../shared/constants';

export function startHeartbeat(
  video: HTMLVideoElement,
  ctx: VideoContext,
  send: (msg: BiliVizContentMessage) => void,
  interval = HEARTBEAT_INTERVAL_MS,
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
