interface CurrentVideoSummaryHighlightsClearState {
  generation: number;
  clearing: boolean;
}

const state: CurrentVideoSummaryHighlightsClearState = {
  generation: 0,
  clearing: false,
};
let clearingDepth = 0;

export function getCurrentVideoSummaryHighlightsClearState(): CurrentVideoSummaryHighlightsClearState {
  return { ...state };
}

export function canUseCurrentVideoSummaryHighlightsClearGeneration(generation: number): boolean {
  return !state.clearing && state.generation === generation;
}

export async function runCurrentVideoSummaryHighlightsClearCoordinator<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const endClearWindow = beginCurrentVideoSummaryHighlightsClearWindow();
  try {
    return await operation();
  } finally {
    endClearWindow();
  }
}

export function beginCurrentVideoSummaryHighlightsClearWindow(): () => void {
  let ended = false;
  state.generation += 1;
  clearingDepth += 1;
  state.clearing = true;
  return () => {
    if (ended) return;
    ended = true;
    clearingDepth = Math.max(0, clearingDepth - 1);
    state.clearing = clearingDepth > 0;
    if (clearingDepth === 0) state.generation += 1;
  };
}
