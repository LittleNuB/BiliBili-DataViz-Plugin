(() => {
  const params = new URLSearchParams(location.search);
  const messages = [];
  const baseBvid = 'BV1PopupMock9';
  const baseCid = params.get('missingIdentity') === '1' ? null : 9201;
  let bvid = baseBvid;
  let cid = baseCid;
  let page = 1;
  let title = params.get('missingTitle') === '1' ? null : 'Popup 授权 Mock 视频';
  const storageKey = 'currentVideoPrimaryTextSelections';
  const userConfigKey = 'userConfig';
  const sourceV2 = `primary-text:bilibili_subtitle:${baseBvid}:9201:1:zh-cn:popup-source-v2`;
  const sourceV1 = `primary-text:bilibili_subtitle:${baseBvid}:9201:1:zh-cn:popup-source-v1`;
  const sourceB = `primary-text:bilibili_subtitle:${baseBvid}:9201:1:zh-cn:popup-source-b`;
  const storage = {};
  const storageChangeListeners = new Set();
  const deferredActionCounts = new Map();
  const pendingResponses = [];
  const actionSequence = new Map();
  const cancelledSummaryRequestIds = new Set();
  const cancelledFullTextQaRequestIds = new Set();
  let summaryCacheResult = null;
  let summaryCacheSourceIdentityKey = null;
  let summaryReplacementSequence = 100;
  let returnAvailable = false;
  let activeBaseSourceIdentityKey = sourceV2;

  if (params.get('savedV1') === '1') {
    storage[storageKey] = { [`${baseBvid}:9201:1`]: sourceV1 };
  }
  storage[userConfigKey] = userConfig({
    enabled: params.get('summaryDisabled') !== '1',
    configured: params.get('summaryUnconfigured') !== '1',
    chatModel: 'mock-model',
  });

  function currentSourceIdentityKey() {
    if (cid === null) return null;
    if (bvid === baseBvid && cid === 9201 && page === 1) return activeBaseSourceIdentityKey;
    return `primary-text:bilibili_subtitle:${bvid}:${cid}:${page}:zh-cn:popup-source-current`;
  }

  function currentPartKey() {
    return cid === null ? null : `${bvid}:${cid}:${page}`;
  }

  function nextActionSequence(action) {
    const next = (actionSequence.get(action) || 0) + 1;
    actionSequence.set(action, next);
    return next;
  }

  function maybeDeferResponse(action, response) {
    const remaining = deferredActionCounts.get(action) || 0;
    if (remaining <= 0) {
      return Promise.resolve(typeof response === 'function' ? response() : response);
    }
    deferredActionCounts.set(action, remaining - 1);
    return new Promise((resolve) => pendingResponses.push({ action, response, resolve }));
  }

  function emitStorageChange(key, oldValue, newValue) {
    const changes = { [key]: { oldValue, newValue } };
    for (const listener of storageChangeListeners) listener(changes, 'local');
  }

  function userConfig({ enabled, configured, chatModel }) {
    return {
      ai: {
        baseURL: configured ? 'https://example.invalid' : '',
        apiKey: configured ? 'mock-key' : '',
        chatModel,
      },
      assistant: {
        currentVideoAiAssistantEnabled: enabled,
        smartFavoritesQaAiEnabled: false,
      },
    };
  }

  function currentUserConfig() {
    return storage[userConfigKey] || userConfig({ enabled: false, configured: false, chatModel: 'mock-model' });
  }

  function currentChatModel() {
    const model = String(currentUserConfig().ai?.chatModel || '').trim();
    return model || 'mock-model';
  }

  function currentSummaryState() {
    const config = currentUserConfig();
    if (config.assistant?.currentVideoAiAssistantEnabled !== true) return 'disabled';
    if (!String(config.ai?.baseURL || '').trim() || !String(config.ai?.apiKey || '').trim() || !String(config.ai?.chatModel || '').trim()) {
      return 'unconfigured';
    }
    return params.get('summaryState') || 'ready';
  }

  function withLiveConfigCacheState(result) {
    const state = currentSummaryState();
    if (state === 'disabled') {
      return {
        ...result,
        priorGenerated: true,
        canGenerate: false,
        generationBlockedMessage: '要生成或刷新，请先在设置中开启“当前视频 AI 助手”。',
      };
    }
    if (state === 'unconfigured') {
      return {
        ...result,
        priorGenerated: true,
        canGenerate: false,
        generationBlockedMessage: '要生成或刷新，请先完成 AI 服务配置。',
      };
    }
    return result;
  }

  function transcriptEvidence() {
    const sourceIdentityKey = currentSourceIdentityKey();
    return {
      status: 'cached',
      active: cid !== null,
      checkedAt: Date.now(),
      bvid,
      cid,
      page,
      language: cid === null ? null : 'zh-CN',
      source: cid === null ? null : 'bilibili_subtitle',
      sourceType: 'bilibili_player_wbi_v2',
      sourceIdentityKey,
      sourceHash: cid === null ? null : `popup-source-${cid}-${page}`,
      bodyHash: cid === null ? null : `popup-body-${cid}-${page}`,
      timelineHash: cid === null ? null : `popup-timeline-${cid}-${page}`,
      segmentCount: cid === null ? 0 : 2,
      staleSegmentCount: 0,
      serializedBytes: cid === null ? 0 : 512,
      coverageStartSeconds: cid === null ? null : 0,
      coverageEndSeconds: cid === null ? null : 8,
      fetchedAt: Date.now(),
      updatedAt: Date.now(),
      reason: cid === null ? 'missing_cid' : 'transcript_segments_cached',
      message: cid === null ? '当前分 P 身份信息不完整。' : '已缓存字幕正文证据。',
      warnings: [],
    };
  }

  function currentContext() {
    return {
      kind: 'video',
      url: `https://www.bilibili.com/video/${bvid}`,
      collectedAt: Date.now(),
      bvid,
      aid: 119201,
      cid,
      title,
      authorName: 'Mock UP',
      authorMid: 42,
      durationSeconds: 600,
      currentPart: { page, title: page === 1 ? '主视频' : '切换后的分段', total: 2 },
      parts: [{ page, cid, title: page === 1 ? '主视频' : '切换后的分段', durationSeconds: 600 }],
      chapters: [],
      description: { availability: 'available', text: 'Popup 授权测试。', length: 10 },
      sources: {
        metadata: 'available',
        description: 'available',
        pages: 'available',
        chapters: 'unknown',
        transcript: cid === null ? 'unknown' : 'available',
        contentText: cid === null ? 'unavailable' : 'available',
      },
      subtitleProbe: cid === null ? null : {
        status: 'available',
        available: true,
        checkedAt: Date.now(),
        bvid,
        cid,
        page,
        sourceType: 'bilibili_player_wbi_v2',
        sourceDomain: 'api.bilibili.com',
        sourcePath: '/x/player/wbi/v2',
        needLoginSubtitle: null,
        trackCount: 1,
        segmentCount: 2,
        coverageStartSeconds: 0,
        coverageEndSeconds: 8,
        languages: ['zh-CN'],
        tracks: [],
        reason: 'subtitle_tracks_available',
        message: '已检测到字幕轨道。',
        warnings: [],
      },
      transcriptEvidence: transcriptEvidence(),
      warnings: cid === null ? ['cid_unknown'] : ['transcript_evidence_cached'],
    };
  }

  function summaryResult(authorized, sequence, options = {}) {
    const model = currentChatModel();
    const highlightCount = Math.max(4, Math.min(8, Number(params.get('highlightCount') || options.highlightCount || 4)));
    const highlights = Array.from({ length: highlightCount }, (_, index) => {
      const startSeconds = index * 8;
      const endSeconds = startSeconds + 6;
      return {
        id: `highlight-${index + 1}`,
        title: `亮点 ${index + 1}`,
        description: `这是第 ${index + 1} 个经过校验的亮点说明。`,
        startSeconds,
        endSeconds,
        timeRangeLabel: `0:${String(startSeconds).padStart(2, '0')}-0:${String(endSeconds).padStart(2, '0')}`,
        evidenceLineNumbers: [index + 1],
      };
    });
    const textSize = { lineCount: 12, charCount: 360, utf8Bytes: 720 };
    if (!authorized || options.status === 'no_text') {
      return {
        status: 'no_text',
        title: 'Popup 授权 Mock 视频',
        message: authorized ? '当前没有可用的主要正文，无法生成摘要与亮点。' : '此前保存的主要文本来源已经不可用。',
        sourceLabel: null,
        textSize: authorized ? { lineCount: 0, charCount: null, utf8Bytes: 0 } : textSize,
        summarySentences: [],
        keyPoints: [],
        highlights: [],
        limitations: [authorized ? '请先检测并选择主要文本来源。' : '请重新选择主要文本来源。'],
        ai: { status: 'not_requested', model: null, error: null, note: '本次没有请求 AI。' },
        generatedAt: Date.now(),
        model: null,
        cacheKey: null,
        cacheHit: false,
        current: true,
        requestId: null,
        canGenerate: true,
        priorGenerated: false,
        generationBlockedMessage: null,
      };
    }
    if (!options.cacheHit && options.status === 'disabled') {
      return {
        status: 'error',
        title: 'Popup 授权 Mock 视频',
        message: '当前视频 AI 助手未开启，本次没有发送正文。',
        sourceLabel: null,
        textSize,
        summarySentences: [],
        keyPoints: [],
        highlights: [],
        limitations: ['开启开关本身不会发送正文，仍需再次点击生成。'],
        ai: { status: 'disabled', model, error: null, note: '请在设置中开启“当前视频 AI 助手”后，再手动生成。' },
        generatedAt: Date.now(),
        model,
        cacheKey: null,
        cacheHit: false,
        current: true,
        requestId: null,
        canGenerate: false,
        priorGenerated: false,
        generationBlockedMessage: '要生成或刷新，请先在设置中开启“当前视频 AI 助手”。',
      };
    }
    if (!options.cacheHit && options.status === 'unconfigured') {
      return {
        status: 'error',
        title: 'Popup 授权 Mock 视频',
        message: 'AI 服务尚未配置完整，本次没有发送正文。',
        sourceLabel: null,
        textSize,
        summarySentences: [],
        keyPoints: [],
        highlights: [],
        limitations: ['配置完成后需要再次点击生成；不会自动补发。'],
        ai: { status: 'not_configured', model, error: null, note: '请先配置服务地址、模型和 API Key。' },
        generatedAt: Date.now(),
        model,
        cacheKey: null,
        cacheHit: false,
        current: true,
        requestId: null,
        canGenerate: false,
        priorGenerated: false,
        generationBlockedMessage: '要生成或刷新，请先完成 AI 服务配置。',
      };
    }
    if (!options.cacheHit && (options.status === 'invalid' || params.get('summaryInvalid') === '1')) {
      return {
        status: 'invalid_output',
        title: 'Popup 授权 Mock 视频',
        message: '模型返回的摘要与亮点没有通过校验，旧结果不会被替换。',
        sourceLabel: null,
        textSize,
        summarySentences: [],
        keyPoints: [],
        highlights: [],
        limitations: ['请稍后重试。'],
        ai: { status: 'invalid_output', model, error: 'invalid', note: '已拒绝本次结果。' },
        generatedAt: Date.now(),
        model,
        cacheKey: null,
        cacheHit: false,
        current: true,
        requestId: null,
        canGenerate: true,
        priorGenerated: false,
        generationBlockedMessage: null,
      };
    }
    if (!options.cacheHit && (options.status === 'error' || params.get('summaryError') === '1')) {
      return {
        status: 'error',
        title: 'Popup 授权 Mock 视频',
        message: '摘要与亮点生成失败，旧结果不会被替换。',
        sourceLabel: null,
        textSize,
        summarySentences: [],
        keyPoints: [],
        highlights: [],
        limitations: ['本次失败不会写入缓存，也不会生成推测时间戳。'],
        ai: { status: 'failed', model, error: 'mock-error', note: '请确认 AI 设置可用后再重试。' },
        generatedAt: Date.now(),
        model,
        cacheKey: null,
        cacheHit: false,
        current: true,
        requestId: null,
        canGenerate: true,
        priorGenerated: false,
        generationBlockedMessage: null,
      };
    }
    if (options.status === 'cancelled') {
      return {
        status: 'cancelled',
        title: 'Popup 授权 Mock 视频',
        message: '本次生成已取消，旧结果不会被替换。',
        sourceLabel: null,
        textSize,
        summarySentences: [],
        keyPoints: [],
        highlights: [],
        limitations: ['如需更新，请重新点击生成。'],
        ai: { status: 'cancelled', model, error: null, note: '本次生成已取消。' },
        generatedAt: Date.now(),
        model,
        cacheKey: null,
        cacheHit: false,
        current: true,
        requestId: options.requestId || null,
        canGenerate: true,
        priorGenerated: false,
        generationBlockedMessage: null,
      };
    }
    const priorGenerated = options.priorGenerated === true;
    return {
      status: 'ready',
      title: 'Popup 授权 Mock 视频',
      message: priorGenerated
        ? '已读取此前生成的摘要与亮点；关闭授权后仍可查看，但不能重新生成。'
        : options.cacheHit
          ? '已读取本地缓存的摘要与亮点。'
          : `已生成 3 条摘要、3 个要点和 ${highlightCount} 个亮点。`,
      sourceLabel: 'B站字幕',
      textSize,
      summarySentences: [
        { id: 'summary-1', text: sequence === 1 ? '手动生成已使用精确的当前正文来源。' : `较新的手动生成结果 ${sequence} 已采用当前正文。`, evidenceLineNumbers: [1, 2] },
        { id: 'summary-2', text: '摘要内容保持中文，不展示正文摘录。', evidenceLineNumbers: [3, 4] },
        { id: 'summary-3', text: '亮点时间来自已校验的正文行。', evidenceLineNumbers: [5, 6] },
      ],
      keyPoints: [
        { id: 'key-point-1', text: '先确认当前主要文本来源。', evidenceLineNumbers: [1] },
        { id: 'key-point-2', text: '再生成摘要和亮点。', evidenceLineNumbers: [2] },
        { id: 'key-point-3', text: '最后通过预览确认跳转。', evidenceLineNumbers: [3] },
      ],
      highlights,
      limitations: ['摘要区不展示正文摘录；亮点时间只来自已校验的当前正文行。'],
      ai: { status: 'generated', model, error: null, note: options.cacheHit ? '已从本地缓存读取。' : '已完成模型生成并通过本地校验。' },
      generatedAt: Date.now(),
      model,
      cacheKey: 'mock-summary-highlight-cache',
      cacheHit: options.cacheHit === true,
      current: true,
      requestId: options.requestId || `mock-request-${sequence}`,
      canGenerate: !priorGenerated,
      priorGenerated,
      generationBlockedMessage: priorGenerated
        ? '要重新生成，请先在设置中开启“当前视频 AI 助手”。'
        : null,
    };
  }

  function seedSummaryCacheForCurrentSource(sequence) {
    summaryCacheResult = summaryResult(true, sequence, { cacheHit: true });
    summaryCacheSourceIdentityKey = currentSourceIdentityKey();
    return summaryCacheResult;
  }

  function knowledgeResult(authorized, sequence) {
    return {
      status: authorized ? 'ready' : 'no_context',
      title: 'Popup 授权 Mock 视频',
      generatedAt: Date.now(),
      sourceState: {
        metadata: true,
        description: true,
        pages: true,
        chapters: false,
        transcript: authorized,
        transcriptEvidence: authorized,
        contentText: false,
      },
      transcriptEvidence: authorized ? transcriptEvidence() : null,
      nodes: authorized ? [{
        id: `popup-knowledge-${sequence}`,
        title: `知识节点响应 ${sequence}`,
        reason: '由当前视频元数据生成。',
        source: 'metadata',
        sourceLabel: '当前视频元数据',
        confidence: 0.8,
        timestamp: null,
        endTimestamp: null,
        timestampLabel: null,
        evidence: null,
      }] : [],
      warnings: [],
      limitations: [authorized ? '当前没有更多节点。' : '此前保存的主要文本来源已经不可用。'],
    };
  }

  function searchResult(query, authorized) {
    const common = {
      query: String(query || ''),
      normalizedQuery: String(query || '').trim().toLowerCase(),
      limitations: [authorized ? '候选只来自当前视频证据。' : '此前保存的主要文本来源已经不可用。'],
      evidenceState: {
        transcriptSegmentCount: authorized ? 2 : 0,
        timedKnowledgeNodeCount: 0,
        metadataHintAvailable: true,
        contextFresh: true,
      },
      queryRewrite: {
        originalQuery: String(query || ''),
        normalizedQuery: String(query || '').trim().toLowerCase(),
        expanded: false,
        expandedTerms: [],
        visibleExpandedTerms: [],
        reasons: [],
        aiRewriteEnabled: false,
      },
      aiRerank: {
        enabled: false,
        status: 'disabled',
        model: null,
        note: '本次仅使用本地候选顺序。',
        generatedAt: null,
        originalCandidateIds: authorized ? ['popup-candidate-1'] : [],
        orderedCandidateIds: authorized ? ['popup-candidate-1'] : [],
        explanations: [],
      },
    };
    if (!authorized) {
      return { ...common, status: 'no_evidence', candidates: [], summary: '没有读取失效来源，也没有采用新来源。' };
    }
    return {
      ...common,
      status: 'ready',
      summary: '找到 1 个当前视频字幕候选。',
      candidates: [{
        id: 'popup-candidate-1',
        binding: { kind: 'transcript_segment', segmentId: 'hidden-popup-segment' },
        source: 'transcript_segment',
        sourceLabel: '可定位字幕证据',
        startSeconds: 4,
        endSeconds: 8,
        timeRangeLabel: '0:04-0:08',
        evidenceText: `${String(query || '')} 的当前候选`,
        matchReasons: ['命中当前视频字幕正文'],
        confidence: 0.88,
        confidenceLabel: '高',
        note: null,
        jumpPreview: {
          canJump: true,
          requiresConfirmation: true,
          disabledReason: null,
          message: '可预览，确认后才会跳转。',
          targetSeconds: 4,
          targetTimeLabel: '0:04',
          sourceLabel: '可定位字幕证据',
          confidence: 0.88,
          confidenceLabel: '高',
          evidencePreview: `${String(query || '')} 的当前候选`,
        },
      }],
    };
  }

  function fullTextQaResult(request, authorized) {
    const requestId = String(request?.requestId || 'popup-qa-request');
    const turnId = String(request?.turnId || 'popup-qa-turn');
    const question = String(request?.question || '').trim();
    const sourceLabel = authorized ? 'B站字幕' : null;
    const common = {
      requestId,
      turnId,
      question,
      title: title || '当前视频',
      partTitle: page > 1 ? `第 ${page} P` : null,
      sourceLabel,
      textSize: { lineCount: authorized ? 2 : 0, charCount: authorized ? 34 : null, utf8Bytes: authorized ? 96 : 0 },
      answerEvidenceLineNumbers: [],
      citations: [],
      limitations: [],
      generatedAt: Date.now(),
      canRetry: true,
    };
    if (cancelledFullTextQaRequestIds.has(requestId)) {
      return {
        ...common,
        status: 'cancelled',
        answer: '',
        message: '本次回答已取消，问题已保留，可重新提交。',
        ai: { status: 'cancelled', model: currentChatModel(), note: '本次请求已取消。', errorCode: null },
      };
    }
    const state = currentSummaryState();
    if (state === 'disabled') {
      return {
        ...common,
        status: 'disabled',
        answer: '',
        message: '当前视频 AI 助手已关闭，问题已保留。开启后可重新提交。',
        ai: { status: 'disabled', model: currentChatModel(), note: '当前功能未开启。', errorCode: null },
      };
    }
    if (state === 'unconfigured') {
      return {
        ...common,
        status: 'not_configured',
        answer: '',
        message: 'AI 服务尚未配置完成，问题已保留。完成设置后可重新提交。',
        ai: { status: 'not_configured', model: currentChatModel(), note: 'AI 服务未配置。', errorCode: null },
      };
    }
    if (!authorized || params.get('qaNoText') === '1') {
      return {
        ...common,
        status: 'no_text',
        answer: '',
        message: '当前分 P 没有可用的主要文本，无法回答。问题已保留。',
        ai: { status: 'failed', model: currentChatModel(), note: '当前主要文本不可用。', errorCode: 'no_text' },
      };
    }
    if (params.get('qaContextTooLong') === '1') {
      return {
        ...common,
        status: 'context_too_long',
        answer: '',
        message: '当前正文过长，所选模型没有接受本次完整请求；系统不会截断或分段发送。问题已保留，可更换模型后重试。',
        ai: { status: 'context_too_long', model: currentChatModel(), note: '完整正文未被所选模型接受。', errorCode: 'context_too_long' },
      };
    }
    if (params.get('qaUnsupported') === '1') {
      return {
        ...common,
        status: 'unsupported',
        answer: '当前视频文本没有足够内容回答这个问题。',
        message: '当前视频文本没有足够内容支持回答。',
        limitations: ['没有使用标题、简介、通用知识或其他视频内容补答。'],
        ai: { status: 'unsupported', model: currentChatModel(), note: '当前正文依据不足。', errorCode: null },
        canRetry: false,
      };
    }
    const citationId = `popup-qa-citation-${requestId}`;
    const rawVisibleCopy = params.get('qaRawVisibleCopy') === '1';
    return {
      ...common,
      status: 'ready',
      answer: rawVisibleCopy
        ? 'document is not defined; fallback transcript confidence sourceHash=popup-secret segmentId=segment-secret subtitle_url=https://secret.invalid bvid=BV1RawLeak99 CID=9201 独立 BV1RawLeak99'
        : `回答：${question}。作者先说明约束，再用当前视频中的示例给出结论。`,
      answerEvidenceLineNumbers: [1, 2],
      citations: [{
        id: citationId,
        evidenceLineNumbers: [1, 2],
        evidenceText: rawVisibleCopy
          ? 'fallback transcript confidence sourceHash=popup-secret segmentId=segment-secret subtitle_url=https://secret.invalid bvid=BV1RawLeak99 CID=9201 独立 BV1RawLeak99'
          : '作者先说明约束条件，随后通过当前视频中的示例验证结论。',
        startSeconds: 4,
        endSeconds: 8,
        timeRangeLabel: '0:04-0:08',
        sourceLabel: 'B站字幕',
        binding: { requestId, turnId, citationId },
      }],
      message: '回答已基于当前分 P 的完整主要文本生成。',
      limitations: ['回答和引用只基于当前分 P 本次提交的完整主要文本。'],
      ai: { status: 'generated', model: currentChatModel(), note: '回答已生成。', errorCode: null },
      canRetry: false,
    };
  }

  function storageGet(keys) {
    if (params.get('rejectStorage') === '1') {
      return Promise.reject(new Error('MOCK_POPUP_PRIMARY_TEXT_STORAGE_READ_FAILED'));
    }
    if (typeof keys === 'string') return Promise.resolve({ [keys]: storage[keys] });
    if (Array.isArray(keys)) return Promise.resolve(Object.fromEntries(keys.map(key => [key, storage[key]])));
    return Promise.resolve({ ...storage });
  }

  if (params.get('deferInitialContext') === '1') {
    deferredActionCounts.set('GET_CURRENT_VIDEO_CONTEXT', 1);
  }

  window.__popupMockMessages = messages;
  window.__popupMockSourceV1 = sourceV1;
  window.__popupMockSourceV2 = sourceV2;
  window.__popupMockSourceB = sourceB;
  window.__popupMockStorage = storage;
  window.__popupMockDeferNextResponse = (action) => {
    deferredActionCounts.set(action, (deferredActionCounts.get(action) || 0) + 1);
  };
  window.__popupMockPendingResponseCount = (action) => pendingResponses
    .filter((item) => !action || item.action === action).length;
  window.__popupMockResolveResponses = (action) => {
    const selected = pendingResponses.filter((item) => !action || item.action === action);
    for (const item of selected) {
      const index = pendingResponses.indexOf(item);
      if (index >= 0) pendingResponses.splice(index, 1);
      item.resolve(typeof item.response === 'function' ? item.response() : item.response);
    }
  };
  window.__popupMockSummaryCache = () => summaryCacheResult;
  window.__popupMockSummaryCacheSourceIdentityKey = () => summaryCacheSourceIdentityKey;
  window.__popupMockSeedSummaryCacheForCurrentSource = (sequence = 7) => seedSummaryCacheForCurrentSource(Number(sequence) || 7);
  window.__popupMockReplaceSummaryGeneration = () => {
    summaryReplacementSequence += 1;
    summaryCacheResult = summaryResult(true, summaryReplacementSequence, {
      cacheHit: true,
      requestId: `mock-replacement-${summaryReplacementSequence}`,
    });
    summaryCacheSourceIdentityKey = currentSourceIdentityKey();
  };
  window.__popupMockEmitSelectionChange = (mode = 'same') => {
    const oldValue = storage[storageKey];
    let newValue;
    if (mode === 'clear') {
      delete storage[storageKey];
      newValue = undefined;
    } else if (mode === 'other') {
      const partKey = currentPartKey();
      activeBaseSourceIdentityKey = sourceB;
      seedSummaryCacheForCurrentSource(7);
      newValue = partKey ? { ...(oldValue || {}), [partKey]: sourceB } : {};
      storage[storageKey] = newValue;
    } else if (mode === 'current') {
      const partKey = currentPartKey();
      activeBaseSourceIdentityKey = sourceV2;
      const sourceIdentityKey = currentSourceIdentityKey();
      newValue = partKey && sourceIdentityKey ? { ...(oldValue || {}), [partKey]: sourceIdentityKey } : {};
      storage[storageKey] = newValue;
    } else {
      newValue = oldValue === undefined ? undefined : { ...oldValue };
    }
    emitStorageChange(storageKey, oldValue, newValue);
  };
  window.__popupMockEmitUserConfigChange = (mode = 'disable') => {
    const oldValue = storage[userConfigKey];
    const currentModel = currentChatModel();
    const newValue = mode === 'model'
      ? userConfig({ enabled: true, configured: true, chatModel: `${currentModel}-v2` })
      : mode === 'unconfigured'
        ? userConfig({ enabled: true, configured: false, chatModel: currentModel })
        : mode === 'enable'
          ? userConfig({ enabled: true, configured: true, chatModel: currentModel })
          : userConfig({ enabled: false, configured: true, chatModel: currentModel });
    storage[userConfigKey] = newValue;
    emitStorageChange(userConfigKey, oldValue, newValue);
  };
  window.__popupMockSwitchContext = () => {
    bvid = 'BV1PopupNext7';
    cid = 9302;
    page = 2;
    title = '切换后的 Popup 视频';
  };

  window.chrome = {
    runtime: {
      getURL(path) {
        return `/${path}`;
      },
      sendMessage(message) {
        messages.push(message);
        const exactSource = message.params?.selectedSourceIdentityKey;
        const authorized = message.params?.primaryTextSelectionsReady === true
          && exactSource === currentSourceIdentityKey();
        switch (message.action) {
          case 'GET_QUICK_STATS':
            return Promise.resolve({ success: true, data: {
              todayWatchTime: 0,
              dailyGoal: 3600,
              streakDays: 1,
              avgCompletion: 0.5,
              efficiencyScore: 50,
              weeklyWatchTime: 3600,
              weeklyLocalPcWatchTime: 3600,
              weeklyLocalPcDays: 1,
            } });
          case 'GET_SYNC_STATUS':
            return Promise.resolve({ success: true, data: { lastSync: null, totalRecords: 1, backfillComplete: true, syncProgress: null } });
          case 'GET_CURRENT_VIDEO_CONTEXT':
            return maybeDeferResponse(message.action, { success: true, data: currentContext() });
          case 'GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE':
            return maybeDeferResponse(message.action, { success: true, data: transcriptEvidence() });
          case 'GET_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS_CACHE':
            return maybeDeferResponse(message.action, () => {
              if (params.get('cachedSummary') === '1' && !summaryCacheResult) {
                summaryCacheResult = summaryResult(authorized, nextActionSequence(message.action), {
                  cacheHit: true,
                  priorGenerated: ['disabled', 'unconfigured'].includes(currentSummaryState()),
                });
                summaryCacheSourceIdentityKey = exactSource || null;
              }
              const state = currentSummaryState();
              const cacheMissStatus = state === 'ready' ? null : state;
              const matchingCache = params.get('cachedSummary') === '1'
                && summaryCacheResult
                && summaryCacheSourceIdentityKey === exactSource
                && summaryCacheResult.model === currentChatModel()
                ? withLiveConfigCacheState(summaryCacheResult)
                : null;
              return {
                success: true,
                data: matchingCache
                  ? matchingCache
                  : cacheMissStatus
                    ? summaryResult(
                      authorized,
                      nextActionSequence(message.action),
                      { status: cacheMissStatus },
                    )
                  : {
                  status: 'not_requested',
                  title: 'Popup 授权 Mock 视频',
                  message: '可在这里手动生成摘要与亮点；打开面板不会自动发送正文。',
                  sourceLabel: null,
                  textSize: { lineCount: 0, charCount: null, utf8Bytes: 0 },
                  summarySentences: [],
                  keyPoints: [],
                  highlights: [],
                  limitations: [],
                  ai: { status: 'not_requested', model: null, error: null, note: '尚未请求生成。' },
                  generatedAt: Date.now(),
                  model: null,
                  cacheKey: null,
                  cacheHit: false,
                  current: true,
                  requestId: null,
                  canGenerate: true,
                  priorGenerated: false,
                  generationBlockedMessage: null,
                },
              };
            });
          case 'GENERATE_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS': {
            const sequence = nextActionSequence(message.action);
            const requestId = String(message.params?.requestId || '');
            if (params.get('summaryReject') === '1') {
              return Promise.reject(new Error('MOCK_POPUP_SUMMARY_NETWORK_FAILURE'));
            }
            return maybeDeferResponse(message.action, () => {
              if (cancelledSummaryRequestIds.has(requestId)) {
                return {
                  success: true,
                  data: summaryResult(true, sequence, { status: 'cancelled', requestId }),
                };
              }
              const state = currentSummaryState();
              const data = summaryResult(
                params.get('summaryNoText') === '1' ? true : authorized,
                sequence,
                {
                  status: params.get('summaryNoText') === '1'
                    ? 'no_text'
                    : state === 'ready'
                      ? undefined
                      : state,
                  requestId,
                },
              );
              if (data.status === 'ready') {
                summaryCacheResult = { ...data, cacheHit: true };
                summaryCacheSourceIdentityKey = exactSource || null;
              }
              return { success: true, data };
            });
          }
          case 'CANCEL_CURRENT_VIDEO_SUMMARY_HIGHLIGHTS': {
            const requestId = String(message.params?.requestId || '');
            if (requestId) cancelledSummaryRequestIds.add(requestId);
            return maybeDeferResponse(message.action, { success: true, data: { cancelled: true } });
          }
          case 'GET_VIDEO_KNOWLEDGE':
            return maybeDeferResponse(message.action, {
              success: true,
              data: knowledgeResult(
                params.get('knowledgeNoEvidence') === '1' ? false : authorized,
                nextActionSequence(message.action),
              ),
            });
          case 'ASK_CURRENT_VIDEO_FULL_TEXT':
            if (params.get('qaReject') === '1') {
              return Promise.reject(new Error('MOCK_POPUP_QA_NETWORK_FAILURE'));
            }
            return maybeDeferResponse(message.action, () => ({
              success: true,
              data: fullTextQaResult(message.params, authorized),
            }));
          case 'CANCEL_CURRENT_VIDEO_FULL_TEXT_QA': {
            const requestId = String(message.params?.requestId || '');
            if (requestId) cancelledFullTextQaRequestIds.add(requestId);
            return Promise.resolve({ success: true, data: { cancelled: Boolean(requestId) } });
          }
          case 'REQUEST_CURRENT_VIDEO_QA_CITATION_JUMP': {
            const allowed = authorized
              && message.params?.confirmed === true
              && String(message.params?.requestId || '').length > 0
              && String(message.params?.turnId || '').length > 0
              && String(message.params?.citationId || '').startsWith('popup-qa-citation-');
            if (params.get('rawJumpFailure') === '1') {
              return maybeDeferResponse(message.action, { success: true, data: {
                ok: false,
                message: 'document is not defined; sourceHash=popup-source-v2',
                candidateId: String(message.params?.citationId || ''),
                targetSeconds: null,
                targetTimeLabel: null,
                returnPointSeconds: null,
                sourceLabel: null,
                confidence: null,
              } });
            }
            returnAvailable = allowed;
            return maybeDeferResponse(message.action, { success: true, data: {
              ok: allowed,
              message: params.get('rawJumpSuccess') === '1'
                ? 'document is not defined; BVID CID sourceHash segmentId subtitle_url'
                : (allowed ? '已跳到 0:04，可返回 0:12。' : '引用结果已变化，请重新提交问题。'),
              candidateId: String(message.params?.citationId || ''),
              targetSeconds: allowed ? 4 : null,
              targetTimeLabel: allowed ? '0:04' : null,
              returnPointSeconds: allowed ? 12 : null,
              sourceLabel: allowed ? '当前视频文本' : null,
              confidence: allowed ? 1 : null,
            } });
          }
          case 'SEARCH_CURRENT_VIDEO_SEGMENTS':
            return maybeDeferResponse(message.action, {
              success: true,
              data: searchResult(message.params?.query, authorized),
            });
          case 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP':
            if (params.get('rawJumpFailure') === '1') {
              return maybeDeferResponse(message.action, { success: true, data: {
                ok: false,
                message: 'document is not defined; sourceHash=popup-source-v2',
                candidateId: String(message.params?.candidateId || ''),
                targetSeconds: null,
                targetTimeLabel: null,
                returnPointSeconds: null,
                sourceLabel: null,
                confidence: null,
              } });
            }
            returnAvailable = authorized;
            return maybeDeferResponse(message.action, { success: true, data: {
              ok: authorized,
              message: params.get('rawJumpSuccess') === '1'
                ? 'document is not defined; BVID CID sourceHash segmentId subtitle_url'
                : (authorized ? '已跳到 0:04，可返回 0:12。' : '主要文本来源不可用，未跳转。'),
              candidateId: String(message.params?.candidateId || ''),
              targetSeconds: authorized ? 4 : null,
              targetTimeLabel: authorized ? '0:04' : null,
              returnPointSeconds: authorized ? 12 : null,
              sourceLabel: authorized ? '可定位字幕证据' : null,
              confidence: authorized ? 0.88 : null,
            } });
          case 'REQUEST_CURRENT_VIDEO_HIGHLIGHT_JUMP':
            {
            const bindingMatches = Boolean(
              summaryCacheResult
              && message.params?.confirmed === true
              && message.params?.cacheKey === summaryCacheResult.cacheKey
              && message.params?.requestId === summaryCacheResult.requestId
              && message.params?.generatedAt === summaryCacheResult.generatedAt
              && message.params?.model === summaryCacheResult.model
              && summaryCacheResult.highlights.some(item => item.id === message.params?.highlightId)
            );
            const allowed = authorized && bindingMatches;
            returnAvailable = allowed;
            return maybeDeferResponse(message.action, { success: true, data: {
              ok: allowed,
              message: allowed ? '已跳到 0:00，可返回 0:12。' : '亮点结果已变化，请重新预览。',
              candidateId: String(message.params?.highlightId || ''),
              targetSeconds: allowed ? 0 : null,
              targetTimeLabel: allowed ? '0:00' : null,
              returnPointSeconds: allowed ? 12 : null,
              sourceLabel: allowed ? '视频亮点' : null,
              confidence: allowed ? 1 : null,
            } });
            }
          case 'RETURN_CURRENT_VIDEO_SEGMENT_JUMP':
            if (params.get('rawReturnFailure') === '1') {
              return maybeDeferResponse(message.action, { success: true, data: {
                ok: false,
                message: 'document is not defined; segmentId=hidden-popup-segment',
                candidateId: null,
                returnPointSeconds: null,
                targetSeconds: null,
              } });
            }
            returnAvailable = false;
            return maybeDeferResponse(message.action, { success: true, data: {
              ok: true,
              message: params.get('rawReturnSuccess') === '1'
                ? 'document is not defined; BVID CID sourceHash segmentId subtitle_url'
                : '已返回 0:12。',
              candidateId: null,
              returnPointSeconds: 12,
              targetSeconds: 4,
            } });
          default:
            return Promise.resolve({ success: true, data: null });
        }
      },
    },
    storage: {
      local: {
        get: storageGet,
        set(values) {
          Object.assign(storage, values || {});
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener(listener) {
          storageChangeListeners.add(listener);
        },
        removeListener(listener) {
          storageChangeListeners.delete(listener);
        },
      },
    },
    tabs: {
      create() {
        return Promise.resolve();
      },
    },
  };
})();
