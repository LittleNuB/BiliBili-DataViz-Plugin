(() => {
  const params = new URLSearchParams(location.search);
  const messages = [];
  const bvid = 'BV1PopupMock9';
  const cid = params.get('missingIdentity') === '1' ? null : 9201;
  const page = 1;
  const storageKey = 'currentVideoPrimaryTextSelections';
  const sourceV2 = `primary-text:bilibili_subtitle:${bvid}:9201:1:zh-cn:popup-source-v2`;
  const sourceV1 = `primary-text:bilibili_subtitle:${bvid}:9201:1:zh-cn:popup-source-v1`;
  const storage = {};
  let returnAvailable = false;

  if (params.get('savedV1') === '1') {
    storage[storageKey] = { [`${bvid}:9201:1`]: sourceV1 };
  }

  function transcriptEvidence() {
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
      sourceIdentityKey: cid === null ? null : sourceV2,
      sourceHash: cid === null ? null : 'popup-source-v2',
      bodyHash: cid === null ? null : 'popup-body-v2',
      timelineHash: cid === null ? null : 'popup-timeline-v2',
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
      title: params.get('missingTitle') === '1' ? null : 'Popup 授权 Mock 视频',
      authorName: 'Mock UP',
      authorMid: 42,
      durationSeconds: 600,
      currentPart: { page, title: '主视频', total: 1 },
      parts: [{ page, cid, title: '主视频', durationSeconds: 600 }],
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

  function summaryResult(authorized) {
    return {
      status: authorized ? 'ready' : 'cancelled',
      sourceTier: authorized ? 'transcript_summary' : null,
      sourceTierLabel: authorized ? '字幕正文摘要' : null,
      confidence: authorized ? 'medium' : 'low',
      generationMode: 'local_fallback',
      title: 'Popup 授权 Mock 视频',
      summary: authorized ? '手动摘要已使用精确的当前正文来源。' : '此前保存的主要文本来源已经不可用。',
      bullets: authorized ? ['手动触发后才读取。'] : [],
      evidence: [],
      timestampRanges: [],
      missingSources: [],
      warnings: authorized ? [] : ['selected_source_missing'],
      limitations: [authorized ? '仅用于 popup 授权测试。' : '请重新选择主要文本来源。'],
      nextQuestions: [],
      ai: { status: 'not_requested', model: null, error: null, note: '本次未请求外部模型。' },
      generatedAt: Date.now(),
    };
  }

  function knowledgeResult(authorized) {
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
      nodes: [],
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
        evidenceText: 'Popup 手动检索使用精确来源。',
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
          evidencePreview: 'Popup 手动检索使用精确来源。',
        },
      }],
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

  window.__popupMockMessages = messages;
  window.__popupMockSourceV1 = sourceV1;
  window.__popupMockSourceV2 = sourceV2;
  window.__popupMockStorage = storage;

  window.chrome = {
    runtime: {
      getURL(path) {
        return `/${path}`;
      },
      sendMessage(message) {
        messages.push(message);
        const exactSource = message.params?.selectedSourceIdentityKey;
        const authorized = message.params?.primaryTextSelectionsReady === true && exactSource === sourceV2;
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
            return Promise.resolve({ success: true, data: currentContext() });
          case 'GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE':
            return Promise.resolve({ success: true, data: transcriptEvidence() });
          case 'GET_CURRENT_VIDEO_SUMMARY':
            return Promise.resolve({ success: true, data: summaryResult(authorized) });
          case 'GET_VIDEO_KNOWLEDGE':
            return Promise.resolve({ success: true, data: knowledgeResult(authorized) });
          case 'SEARCH_CURRENT_VIDEO_SEGMENTS':
            return Promise.resolve({ success: true, data: searchResult(message.params?.query, authorized) });
          case 'REQUEST_CURRENT_VIDEO_SEGMENT_JUMP':
            if (params.get('rawJumpFailure') === '1') {
              return Promise.resolve({ success: true, data: {
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
            return Promise.resolve({ success: true, data: {
              ok: authorized,
              message: authorized ? '已跳到 0:04，可返回 0:12。' : '主要文本来源不可用，未跳转。',
              candidateId: String(message.params?.candidateId || ''),
              targetSeconds: authorized ? 4 : null,
              targetTimeLabel: authorized ? '0:04' : null,
              returnPointSeconds: authorized ? 12 : null,
              sourceLabel: authorized ? '可定位字幕证据' : null,
              confidence: authorized ? 0.88 : null,
            } });
          case 'RETURN_CURRENT_VIDEO_SEGMENT_JUMP':
            if (params.get('rawReturnFailure') === '1') {
              return Promise.resolve({ success: true, data: {
                ok: false,
                message: 'document is not defined; segmentId=hidden-popup-segment',
                candidateId: null,
                returnPointSeconds: null,
                targetSeconds: null,
              } });
            }
            returnAvailable = false;
            return Promise.resolve({ success: true, data: {
              ok: true,
              message: '已返回 0:12。',
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
    },
    tabs: {
      create() {
        return Promise.resolve();
      },
    },
  };
})();
