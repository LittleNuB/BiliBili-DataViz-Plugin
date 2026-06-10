export interface AssistantPayloadAuditContract {
  name: string;
  allowedPaths: readonly string[];
}

export interface AssistantPayloadAuditViolation {
  path: string;
  reason: string;
  token?: string;
}

export interface AssistantPayloadAuditResult {
  passed: boolean;
  violations: AssistantPayloadAuditViolation[];
}

const SENSITIVE_KEY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^(watchHistory|historyItems|fullHistory|watchRecords)$/i, reason: 'Full watch history fields are not allowed.' },
  { pattern: /^(favorites|favoriteItems|favoriteFolders|fullFavorites|unmatchedFavorites)$/i, reason: 'Full favorites fields are not allowed.' },
  { pattern: /^(following|followings|followingList|followedCreators|fullFollowing)$/i, reason: 'Full following fields are not allowed.' },
  { pattern: /^(feedback|feedbackRecords|fullFeedback)$/i, reason: 'Full feedback fields are not allowed.' },
  { pattern: /cookie/i, reason: 'Cookie fields are not allowed.' },
  { pattern: /(browserProfile|profilePath|userDataDir|chromeProfile|firefoxProfile)/i, reason: 'Browser profile fields are not allowed.' },
  { pattern: /(loginState|sessdata|biliJct|dedeUserId)/i, reason: 'Bilibili login-state fields are not allowed.' },
  { pattern: /(keyPath|apiKeyPath|localKeyPath|keyFile)/i, reason: 'Local key path fields are not allowed.' },
  { pattern: /^(userMid|mid|uid|userProfile|profile)$/i, reason: 'User profile identifiers are not allowed.' },
  { pattern: /^authorMid$/i, reason: 'Creator relationship identifier authorMid is not allowed in assistant AI payloads.' },
];

const SENSITIVE_STRING_PATTERNS: Array<{ pattern: RegExp; token: string; reason: string }> = [
  {
    pattern: /C:\\Users\\LittleNub\\Desktop\\Key\.txt/i,
    token: 'C:\\Users\\LittleNub\\Desktop\\Key.txt',
    reason: 'Local key file path is not allowed.',
  },
  { pattern: /\bKey\.txt\b/i, token: 'Key.txt', reason: 'Local key file path is not allowed.' },
  { pattern: /\bCookie\b|SESSDATA|bili_jct|DedeUserID/i, token: 'Cookie/login token', reason: 'Cookie or Bilibili login-state token is not allowed.' },
  { pattern: /Chrome\\User Data|Firefox\\Profiles|browser profile/i, token: 'browser profile', reason: 'Browser profile token is not allowed.' },
  { pattern: /Bilibili login state|login-state|login state/i, token: 'Bilibili login state', reason: 'Bilibili login-state token is not allowed.' },
  { pattern: /user profile|userMid|user mid|\bmid\s*[:=]\s*\d+/i, token: 'user profile identifier', reason: 'User profile identifier token is not allowed.' },
  { pattern: /authorMid|author mid/i, token: 'authorMid', reason: 'Creator relationship identifier token is not allowed.' },
  { pattern: /watchHistory|full watch history|full history/i, token: 'watch history', reason: 'Full watch history token is not allowed.' },
  { pattern: /favoriteItems|full favorites|full favorite/i, token: 'favorites', reason: 'Full favorites token is not allowed.' },
  { pattern: /followingList|full following/i, token: 'following', reason: 'Full following token is not allowed.' },
  { pattern: /feedbackRecords|full feedback/i, token: 'feedback', reason: 'Full feedback token is not allowed.' },
];

export const currentVideoSummaryPayloadContract: AssistantPayloadAuditContract = {
  name: 'current-video-summary-v0',
  allowedPaths: [
    '$',
    '$.intent',
    '$.video',
    '$.video.bvid',
    '$.video.cid',
    '$.video.title',
    '$.video.authorName',
    '$.video.durationSeconds',
    '$.video.currentPart',
    '$.video.currentPart.page',
    '$.video.currentPart.title',
    '$.video.currentPart.total',
    '$.video.parts',
    '$.video.parts[]',
    '$.video.parts[].page',
    '$.video.parts[].cid',
    '$.video.parts[].title',
    '$.video.parts[].durationSeconds',
    '$.video.chapters',
    '$.video.chapters[]',
    '$.video.chapters[].title',
    '$.video.chapters[].startSeconds',
    '$.video.description',
    '$.video.description.availability',
    '$.video.description.text',
    '$.video.description.length',
    '$.availableSources',
    '$.availableSources.metadata',
    '$.availableSources.description',
    '$.availableSources.pages',
    '$.availableSources.chapters',
    '$.availableSources.transcript',
    '$.availableSources.contentText',
    '$.sourceTier',
    '$.warnings',
    '$.warnings[]',
    '$.safetyRules',
    '$.safetyRules[]',
  ],
};

export const smartFavoriteQaPayloadContract: AssistantPayloadAuditContract = {
  name: 'smart-favorites-qa-synthesis-v1',
  allowedPaths: [
    '$',
    '$.intent',
    '$.question',
    '$.syncCoverage',
    '$.syncCoverage.complete',
    '$.syncCoverage.diagnosticsCount',
    '$.syncCoverage.problemFolders',
    '$.syncCoverage.note',
    '$.indexCoverage',
    '$.indexCoverage.indexedItems',
    '$.indexCoverage.failedItems',
    '$.indexCoverage.pendingItems',
    '$.indexCoverage.staleItems',
    '$.indexCoverage.indexMissing',
    '$.indexCoverage.staleIndex',
    '$.availableSources',
    '$.availableSources.favoriteMetadata',
    '$.availableSources.smartIndex',
    '$.availableSources.transcript',
    '$.availableSources.contentText',
    '$.citedVideos',
    '$.citedVideos[]',
    '$.citedVideos[].bvid',
    '$.citedVideos[].avid',
    '$.citedVideos[].title',
    '$.citedVideos[].authorName',
    '$.citedVideos[].folderTitle',
    '$.citedVideos[].smartPath',
    '$.citedVideos[].smartPath[]',
    '$.citedVideos[].link',
    '$.citedVideos[].matchReasons',
    '$.citedVideos[].matchReasons[]',
    '$.citedVideos[].sourceFields',
    '$.citedVideos[].sourceFields[]',
    '$.citedVideos[].confidence',
    '$.citedVideos[].evidence',
    '$.citedVideos[].evidenceHits',
    '$.citedVideos[].evidenceHits[]',
    '$.citedVideos[].evidenceHits[].field',
    '$.citedVideos[].evidenceHits[].label',
    '$.citedVideos[].evidenceHits[].terms',
    '$.citedVideos[].evidenceHits[].terms[]',
    '$.citedVideos[].evidenceHits[].snippet',
    '$.citedVideos[].score',
    '$.safetyRules',
    '$.safetyRules[]',
  ],
};

export function auditAssistantPayload(
  payload: unknown,
  contract: AssistantPayloadAuditContract,
): AssistantPayloadAuditResult {
  const allowed = new Set(contract.allowedPaths);
  const violations: AssistantPayloadAuditViolation[] = [];
  visitPayload(payload, {
    path: '$',
    normalizedPath: '$',
    allowed,
    violations,
  });
  return {
    passed: violations.length === 0,
    violations,
  };
}

export function assertAssistantPayloadAudit(
  payload: unknown,
  contract: AssistantPayloadAuditContract,
): void {
  const result = auditAssistantPayload(payload, contract);
  if (result.passed) return;

  throw new Error([
    `Assistant payload privacy audit failed for ${contract.name}:`,
    ...result.violations.map(violation => {
      const token = violation.token ? ` token=${violation.token}` : '';
      return `- ${violation.path}: ${violation.reason}${token}`;
    }),
  ].join('\n'));
}

interface VisitState {
  path: string;
  normalizedPath: string;
  allowed: Set<string>;
  violations: AssistantPayloadAuditViolation[];
}

function visitPayload(value: unknown, state: VisitState): void {
  if (!state.allowed.has(state.normalizedPath)) {
    state.violations.push({
      path: state.path,
      reason: 'Field path is not approved for this assistant AI payload contract.',
    });
  }

  if (typeof value === 'string') {
    checkSensitiveString(value, state.path, state.violations);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitPayload(item, {
        ...state,
        path: `${state.path}[${index}]`,
        normalizedPath: `${state.normalizedPath}[]`,
      });
    });
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${state.path}.${key}`;
    checkSensitiveKey(key, childPath, state.violations);
    visitPayload(child, {
      ...state,
      path: childPath,
      normalizedPath: `${state.normalizedPath}.${key}`,
    });
  }
}

function checkSensitiveKey(
  key: string,
  path: string,
  violations: AssistantPayloadAuditViolation[],
): void {
  for (const { pattern, reason } of SENSITIVE_KEY_PATTERNS) {
    if (pattern.test(key)) {
      violations.push({ path, reason, token: key });
    }
  }
}

function checkSensitiveString(
  value: string,
  path: string,
  violations: AssistantPayloadAuditViolation[],
): void {
  for (const { pattern, token, reason } of SENSITIVE_STRING_PATTERNS) {
    if (pattern.test(value)) {
      violations.push({ path, reason, token });
    }
  }
}
