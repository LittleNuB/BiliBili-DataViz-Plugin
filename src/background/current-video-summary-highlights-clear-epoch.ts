interface CurrentVideoSummaryHighlightsClearState {
  generation: number;
  clearing: boolean;
}

const state: CurrentVideoSummaryHighlightsClearState = {
  generation: 0,
  clearing: false,
};

export function getCurrentVideoSummaryHighlightsClearState(): CurrentVideoSummaryHighlightsClearState {
  return { ...state };
}

export function canUseCurrentVideoSummaryHighlightsClearGeneration(generation: number): boolean {
  return !state.clearing && state.generation === generation;
}

export async function runCurrentVideoSummaryHighlightsClearCoordinator<T>(
  operation: () => Promise<T>,
): Promise<T> {
  state.generation += 1;
  state.clearing = true;
  try {
    return await operation();
  } finally {
    state.clearing = false;
    state.generation += 1;
  }
}
