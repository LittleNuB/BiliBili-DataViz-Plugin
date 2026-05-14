import type { BiliVizContentMessage, PlayerActionPayload, PlayerHeartbeatPayload } from '../../shared/types/messages';

export interface VideoContext {
  bvid: string;
  cid: number;
  title: string;
  duration: number;
  authorMid: number;
  authorName: string;
}

export function attachEventListeners(
  video: HTMLVideoElement,
  ctx: VideoContext,
  send: (msg: BiliVizContentMessage) => void,
): () => void {
  let lastPosition = 0;

  const onPlay = () => {
    send({
      action: 'PLAYER_ACTION',
      payload: {
        action: 'play',
        bvid: ctx.bvid,
        cid: ctx.cid,
        currentTime: video.currentTime,
        duration: video.duration || ctx.duration,
      } as PlayerActionPayload,
    });
  };

  const onPause = () => {
    // Skip duplicate pause at video end
    if (video.ended) return;
    send({
      action: 'PLAYER_ACTION',
      payload: {
        action: 'pause',
        bvid: ctx.bvid,
        cid: ctx.cid,
        currentTime: video.currentTime,
        duration: video.duration || ctx.duration,
      } as PlayerActionPayload,
    });
  };

  const onSeeked = () => {
    const seekTo = video.currentTime;
    if (Math.abs(seekTo - lastPosition) < 0.5) return;

    send({
      action: 'PLAYER_ACTION',
      payload: {
        action: 'seek',
        bvid: ctx.bvid,
        cid: ctx.cid,
        currentTime: seekTo,
        duration: video.duration || ctx.duration,
        seekFrom: lastPosition,
        seekTo,
      } as PlayerActionPayload,
    });
    lastPosition = seekTo;
  };

  const onEnded = () => {
    send({
      action: 'PLAYER_ACTION',
      payload: {
        action: 'complete',
        bvid: ctx.bvid,
        cid: ctx.cid,
        currentTime: video.currentTime,
        duration: video.duration || ctx.duration,
        playbackRate: video.playbackRate,
      } as PlayerActionPayload,
    });
  };

  const onTimeUpdate = () => {
    lastPosition = video.currentTime;
  };

  const onRateChange = () => {
    send({
      action: 'PLAYER_ACTION',
      payload: {
        action: 'ratechange',
        bvid: ctx.bvid,
        cid: ctx.cid,
        currentTime: video.currentTime,
        duration: video.duration || ctx.duration,
        playbackRate: video.playbackRate,
      } as PlayerActionPayload,
    });
  };

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('ended', onEnded);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('ratechange', onRateChange);

  console.log('[BiliViz] Event listeners attached to video element');

  return () => {
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('ended', onEnded);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('ratechange', onRateChange);
  };
}
