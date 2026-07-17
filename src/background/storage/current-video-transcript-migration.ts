export interface CurrentVideoTranscriptCacheUpgradeTransaction {
  table: (name: 'currentVideoTranscriptSources' | 'currentVideoTranscriptSegments') => {
    clear: () => Promise<void>;
  };
}

export async function clearLegacyCurrentVideoTranscriptCache(
  tx: CurrentVideoTranscriptCacheUpgradeTransaction,
): Promise<void> {
  await tx.table('currentVideoTranscriptSegments').clear();
  await tx.table('currentVideoTranscriptSources').clear();
}
