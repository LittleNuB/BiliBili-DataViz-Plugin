import type { AiConfig, UserConfig } from './types/config';
import type {
  SmartFavoriteQaCitedVideo,
  SmartFavoriteQaEvidenceHit,
  SmartFavoriteQaResponse,
} from './types/favorite';

export interface SmartFavoriteQaChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface SmartFavoriteQaSynthesisOptions {
  config: UserConfig;
  chat: (config: AiConfig, messages: SmartFavoriteQaChatMessage[]) => Promise<SmartFavoriteQaAiResponse>;
  auditPayload?: (payload: SmartFavoriteQaAiPayload) => void;
  now?: number;
}

export interface SmartFavoriteQaAiPayload {
  intent: 'smart_favorites_qa_synthesis';
  question: string;
  syncCoverage: SmartFavoriteQaAiSyncCoverage;
  indexCoverage: SmartFavoriteQaAiIndexCoverage;
  availableSources: {
    favoriteMetadata: true;
    smartIndex: boolean;
    transcript: false;
    contentText: false;
  };
  citedVideos: SmartFavoriteQaAiPayloadVideo[];
  safetyRules: string[];
}

export interface SmartFavoriteQaAiSyncCoverage {
  complete: boolean;
  diagnosticsCount: number;
  problemFolders: number;
  coverageStatus: 'complete' | 'incomplete';
}

export interface SmartFavoriteQaAiIndexCoverage {
  indexedItems: number;
  failedItems: number;
  pendingItems: number;
  staleItems: number;
  indexMissing: boolean;
  staleIndex: boolean;
}

export interface SmartFavoriteQaAiPayloadVideo {
  bvid: string;
  avid: number;
  title: string;
  authorName: string;
  folderTitle: string;
  smartPath: string[];
  link: string;
  matchReasons: string[];
  sourceFields: string[];
  confidence: SmartFavoriteQaCitedVideo['confidence'];
  evidence: string;
  evidenceHits: Array<Pick<SmartFavoriteQaEvidenceHit, 'field' | 'label' | 'terms' | 'snippet'>>;
  score: number;
}

export interface SmartFavoriteQaAiResponse {
  answer?: unknown;
  citedVideoRefs?: unknown;
  confidence?: unknown;
}

export interface SmartFavoriteQaGuardResult {
  ok: boolean;
  answer: string;
  citedVideoRefs: string[];
  reason?: string;
}

const MAX_PAYLOAD_VIDEOS = 8;
const MAX_TEXT = {
  question: 240,
  title: 160,
  authorName: 80,
  folderTitle: 100,
  smartPathPart: 80,
  matchReason: 80,
  sourceField: 60,
  evidence: 260,
  evidenceHitLabel: 60,
  evidenceHitTerm: 60,
  evidenceHitSnippet: 160,
  link: 180,
};

export function buildSmartFavoriteQaAiPayload(
  response: SmartFavoriteQaResponse,
  maxVideos = MAX_PAYLOAD_VIDEOS,
): SmartFavoriteQaAiPayload {
  const citedVideos = response.citedVideos
    .slice(0, Math.max(1, Math.min(Math.floor(maxVideos), MAX_PAYLOAD_VIDEOS)))
    .map(toPayloadVideo);
  const payload: SmartFavoriteQaAiPayload = {
    intent: 'smart_favorites_qa_synthesis',
    question: limitText(response.query, MAX_TEXT.question),
    syncCoverage: toAiSyncCoverage(response.status.syncCoverage),
    indexCoverage: toAiIndexCoverage(response.status.indexCoverage),
    availableSources: {
      favoriteMetadata: true,
      smartIndex: response.status.indexCoverage.indexedItems > 0,
      transcript: false,
      contentText: false,
    },
    citedVideos,
    safetyRules: [
      'Use only facts from citedVideos and coverage summaries.',
      'Do not mention, cite, infer, or add any video outside citedVideos.',
      'Do not claim transcript, comments, danmaku, audio, visual, or full video body evidence.',
      'If evidence is insufficient, say so and point only to the closest cited candidates.',
      'Return JSON only: answer string and citedVideoRefs string[].',
    ],
  };
  return payload;
}

function toAiSyncCoverage(
  coverage: SmartFavoriteQaResponse['status']['syncCoverage'],
): SmartFavoriteQaAiSyncCoverage {
  return {
    complete: coverage.complete,
    diagnosticsCount: coverage.diagnosticsCount,
    problemFolders: coverage.problemFolders,
    coverageStatus: coverage.complete ? 'complete' : 'incomplete',
  };
}

function toAiIndexCoverage(
  coverage: SmartFavoriteQaResponse['status']['indexCoverage'],
): SmartFavoriteQaAiIndexCoverage {
  return {
    indexedItems: coverage.indexedItems,
    failedItems: coverage.failedItems,
    pendingItems: coverage.pendingItems,
    staleItems: coverage.staleItems,
    indexMissing: coverage.indexMissing,
    staleIndex: coverage.staleIndex,
  };
}

export async function synthesizeSmartFavoriteQaAnswerFromLocal(
  local: SmartFavoriteQaResponse,
  options: SmartFavoriteQaSynthesisOptions,
): Promise<SmartFavoriteQaResponse> {
  const now = options.now ?? Date.now();
  const model = options.config.ai.chatModel;

  if (local.citedVideos.length === 0) {
    return {
      ...local,
      synthesis: {
        status: 'local_fallback',
        reason: 'AI synthesis was not requested because local retrieval returned no cited videos.',
        model,
        generatedAt: now,
      },
    };
  }

  if (!options.config.assistant.smartFavoritesQaAiEnabled) {
    return {
      ...local,
      synthesis: {
        status: 'disabled',
        reason: 'Smart Favorites Q&A AI synthesis is disabled; local cited retrieval evidence is shown.',
        model,
        generatedAt: now,
      },
    };
  }

  if (!options.config.ai.apiKey.trim()) {
    return {
      ...local,
      synthesis: {
        status: 'not_configured',
        reason: 'AI synthesis is enabled but no API key is configured; local cited retrieval evidence is shown.',
        model,
        generatedAt: now,
      },
    };
  }

  try {
    const payload = buildSmartFavoriteQaAiPayload(local);
    options.auditPayload?.(payload);
    const ai = await options.chat(options.config.ai, buildSmartFavoriteQaAiMessages(payload));
    const guarded = guardSmartFavoriteQaAiAnswer(ai, local.citedVideos);
    if (!guarded.ok) {
      return {
        ...local,
        synthesis: {
          status: 'rejected',
          reason: guarded.reason ?? 'AI output violated Smart Favorites citation boundaries.',
          model,
          generatedAt: now,
          citedVideoRefs: guarded.citedVideoRefs,
        },
      };
    }

    return {
      ...local,
      synthesis: {
        status: 'generated',
        answer: guarded.answer,
        reason: 'AI answer synthesized from the bounded top-N cited videos payload only.',
        model,
        generatedAt: now,
        citedVideoRefs: guarded.citedVideoRefs,
      },
    };
  } catch (error) {
    return {
      ...local,
      synthesis: {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        model,
        generatedAt: now,
      },
    };
  }
}

export function buildSmartFavoriteQaAiMessages(payload: SmartFavoriteQaAiPayload): SmartFavoriteQaChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are Bili-Bill Smart Favorites Q&A synthesis. Return JSON only.',
        'Local retrieval has already selected citedVideos. You must not search, add, infer, or mention videos outside citedVideos.',
        'Use only the question, citedVideos evidence, sourceFields, sync/index coverage, availableSources, and safetyRules payload.',
        'Do not claim transcript, comments, danmaku, audio, visual, or full video body evidence.',
        'Every main claim must point to provided cited videos. JSON fields: answer string, citedVideoRefs string[].',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];
}

export function guardSmartFavoriteQaAiAnswer(
  ai: SmartFavoriteQaAiResponse,
  citedVideos: SmartFavoriteQaCitedVideo[],
): SmartFavoriteQaGuardResult {
  const answer = normalizeAnswer(ai.answer);
  if (!answer) {
    return { ok: false, answer: '', citedVideoRefs: [], reason: 'AI_EMPTY_ANSWER' };
  }

  const refResult = normalizeCitedRefs(ai.citedVideoRefs, citedVideos);
  if (!refResult.ok) {
    return {
      ok: false,
      answer,
      citedVideoRefs: refResult.refs,
      reason: refResult.reason,
    };
  }

  const outsideId = findOutsideVideoId(answer, citedVideos);
  if (outsideId) {
    return {
      ok: false,
      answer,
      citedVideoRefs: refResult.refs,
      reason: `AI_OUTSIDE_VIDEO_REFERENCE:${outsideId}`,
    };
  }

  const outsideTitle = findOutsideBracketTitle(answer, citedVideos);
  if (outsideTitle) {
    return {
      ok: false,
      answer,
      citedVideoRefs: refResult.refs,
      reason: `AI_OUTSIDE_TITLE_REFERENCE:${outsideTitle}`,
    };
  }

  if (refResult.refs.length === 0) {
    return {
      ok: false,
      answer,
      citedVideoRefs: [],
      reason: 'AI_MISSING_CITED_VIDEO_REFS',
    };
  }

  return {
    ok: true,
    answer,
    citedVideoRefs: refResult.refs,
  };
}

function toPayloadVideo(video: SmartFavoriteQaCitedVideo): SmartFavoriteQaAiPayloadVideo {
  return {
    bvid: limitText(video.bvid, 40),
    avid: Number.isFinite(video.avid) ? Math.max(0, Math.floor(video.avid)) : 0,
    title: limitText(video.title, MAX_TEXT.title),
    authorName: limitText(video.authorName, MAX_TEXT.authorName),
    folderTitle: limitText(video.folderTitle, MAX_TEXT.folderTitle),
    smartPath: video.smartPath.slice(0, 8).map(part => limitText(part, MAX_TEXT.smartPathPart)),
    link: limitText(video.link, MAX_TEXT.link),
    matchReasons: video.matchReasons.slice(0, 6).map(reason => limitText(reason, MAX_TEXT.matchReason)),
    sourceFields: video.sourceFields.slice(0, 12).map(field => limitText(field, MAX_TEXT.sourceField)),
    confidence: video.confidence,
    evidence: limitText(video.evidence, MAX_TEXT.evidence),
    evidenceHits: video.evidenceHits.slice(0, 8).map(hit => ({
      field: limitText(hit.field, MAX_TEXT.sourceField),
      label: limitText(hit.label, MAX_TEXT.evidenceHitLabel),
      terms: hit.terms.slice(0, 6).map(term => limitText(term, MAX_TEXT.evidenceHitTerm)),
      snippet: limitText(hit.snippet, MAX_TEXT.evidenceHitSnippet),
    })),
    score: Math.round(video.score),
  };
}

function normalizeCitedRefs(
  value: unknown,
  citedVideos: SmartFavoriteQaCitedVideo[],
): { ok: boolean; refs: string[]; reason?: string } {
  if (!Array.isArray(value)) return { ok: true, refs: [] };

  const allowed = new Set(citedVideos.flatMap(video => [
    normalizeRef(video.bvid),
    normalizeRef(video.avid > 0 ? `av${video.avid}` : ''),
    normalizeTitle(video.title),
  ]).filter(Boolean));
  const refs: string[] = [];

  for (const item of value) {
    const raw = typeof item === 'string'
      ? item
      : item && typeof item === 'object'
        ? String((item as { bvid?: unknown; avid?: unknown; title?: unknown }).bvid
          ?? (item as { avid?: unknown }).avid
          ?? (item as { title?: unknown }).title
          ?? '')
        : '';
    const normalized = raw.toLocaleLowerCase().startsWith('av')
      ? normalizeRef(raw)
      : normalizeRef(raw) || normalizeTitle(raw);
    if (!normalized) continue;
    if (!allowed.has(normalized)) {
      return { ok: false, refs, reason: `AI_OUTSIDE_CITED_VIDEO_REF:${limitText(raw, 80)}` };
    }
    refs.push(limitText(raw, 120));
  }

  return { ok: true, refs: Array.from(new Set(refs)) };
}

function findOutsideVideoId(answer: string, citedVideos: SmartFavoriteQaCitedVideo[]): string | null {
  const allowedBvids = new Set(citedVideos.map(video => video.bvid.toLocaleLowerCase()).filter(Boolean));
  const allowedAvs = new Set(citedVideos.map(video => video.avid > 0 ? String(video.avid) : '').filter(Boolean));

  for (const match of answer.matchAll(/\bBV[0-9A-Za-z]{4,}\b/g)) {
    const bvid = match[0];
    if (!allowedBvids.has(bvid.toLocaleLowerCase())) return bvid;
  }

  for (const match of answer.matchAll(/\bav\s*([0-9]{1,20})\b/gi)) {
    const avid = match[1];
    if (!allowedAvs.has(avid)) return `av${avid}`;
  }

  return null;
}

function findOutsideBracketTitle(answer: string, citedVideos: SmartFavoriteQaCitedVideo[]): string | null {
  const allowedTitles = new Set(citedVideos.map(video => normalizeTitle(video.title)).filter(Boolean));
  const candidates = [
    ...Array.from(answer.matchAll(/\u300a([^\u300b]{2,160})\u300b/g), match => match[1]),
    ...Array.from(answer.matchAll(/\[([^\]]{2,160})\]\(\s*https?:\/\/(?:www\.)?bilibili\.com\/video\/[^)]+\)/gi), match => match[1]),
  ];

  for (const title of candidates) {
    if (!allowedTitles.has(normalizeTitle(title))) return limitText(title, 120);
  }
  return null;
}

function normalizeAnswer(value: unknown): string {
  return typeof value === 'string' ? limitText(value, 900) : '';
}

function normalizeRef(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase();
  if (!trimmed) return '';
  if (/^bv[0-9a-z]+$/i.test(trimmed)) return trimmed;
  const avid = trimmed.match(/^av\s*([0-9]+)$/i)?.[1];
  return avid ? `av${avid}` : '';
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s"'`\u300a\u300b\[\]\uff08\uff09()\u3010\u3011]+/g, '').trim();
}

function limitText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3)}...`;
}
