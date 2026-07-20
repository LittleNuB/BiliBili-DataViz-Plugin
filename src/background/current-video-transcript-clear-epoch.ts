let currentVideoTranscriptClearGeneration = 0;
let currentVideoTranscriptClearingDepth = 0;

export interface CurrentVideoTranscriptClearState {
  generation: number;
  clearing: boolean;
}

export function getCurrentVideoTranscriptClearState(): CurrentVideoTranscriptClearState {
  return {
    generation: currentVideoTranscriptClearGeneration,
    clearing: currentVideoTranscriptClearingDepth > 0,
  };
}

export function canUseCurrentVideoTranscriptClearGeneration(
  generation: number | null | undefined,
): boolean {
  return generation === currentVideoTranscriptClearGeneration
    && currentVideoTranscriptClearingDepth === 0;
}

export async function runCurrentVideoTranscriptClearCoordinator<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const endClearWindow = beginCurrentVideoTranscriptClearWindow();
  try {
    return await operation();
  } finally {
    endClearWindow();
  }
}

export function beginCurrentVideoTranscriptClearWindow(): () => void {
  let ended = false;
  currentVideoTranscriptClearGeneration += 1;
  currentVideoTranscriptClearingDepth += 1;
  return () => {
    if (ended) return;
    ended = true;
    currentVideoTranscriptClearingDepth = Math.max(0, currentVideoTranscriptClearingDepth - 1);
    if (currentVideoTranscriptClearingDepth === 0) {
      currentVideoTranscriptClearGeneration += 1;
    }
  };
}
