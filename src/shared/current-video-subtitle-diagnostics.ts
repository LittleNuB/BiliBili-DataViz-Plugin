import type {
  CurrentVideoContext,
  CurrentVideoContextResult,
  CurrentVideoSubtitleSourceState,
} from './types/current-video-context';
import type { CurrentVideoTranscriptEvidenceState } from './types/current-video-transcript';

export type CurrentVideoSubtitleDiagnosticStatus =
  | 'no_context'
  | 'missing_cid'
  | 'enable_ai_subtitle'
  | 'track_found'
  | 'reading_body'
  | 'cached'
  | 'login_required'
  | 'no_track'
  | 'fetch_failed'
  | 'malformed'
  | 'empty'
  | 'language_mismatch'
  | 'unsupported_host'
  | 'stale'
  | 'metadata_only';

export type CurrentVideoSubtitleDiagnosticTone = 'ready' | 'info' | 'warning' | 'blocked';

export interface CurrentVideoSubtitleFeatureGate {
  label: '摘要' | '知识节点' | '片段检索' | '手动跳转';
  available: boolean;
  message: string;
}

export interface CurrentVideoSubtitleDiagnostics {
  status: CurrentVideoSubtitleDiagnosticStatus;
  tone: CurrentVideoSubtitleDiagnosticTone;
  title: string;
  message: string;
  action: string;
  detailLines: string[];
  featureGates: CurrentVideoSubtitleFeatureGate[];
  evidenceAvailable: boolean;
  canRetry: boolean;
}

export interface CurrentVideoSubtitleDiagnosticsOptions {
  refreshing?: boolean;
}

export function buildCurrentVideoSubtitleDiagnostics(
  context: CurrentVideoContextResult | null,
  options: CurrentVideoSubtitleDiagnosticsOptions = {},
): CurrentVideoSubtitleDiagnostics {
  if (options.refreshing) {
    return diagnostics({
      status: 'reading_body',
      tone: 'info',
      title: '正在读取字幕正文',
      message: '正在刷新当前视频上下文、重新检测字幕来源，并尝试把 B 站字幕正文缓存为本地证据。',
      action: '请保持当前 B 站视频页打开；如果刚开启中文 AI 字幕，等待检测完成即可。',
      evidenceAvailable: false,
      canRetry: false,
      detailLines: [
        '这个过程只使用当前页面和 B 站字幕接口，不会读取浏览器本地敏感文件或账号资料。',
      ],
    });
  }

  if (!context || context.kind !== 'video') {
    return diagnostics({
      status: 'no_context',
      tone: 'blocked',
      title: '没有当前视频上下文',
      message: '请先打开一个 B 站视频页，再使用当前视频摘要、知识节点、片段检索或跳转。',
      action: '打开视频页后再点击重新检测字幕。',
      evidenceAvailable: false,
      canRetry: true,
      detailLines: ['没有当前视频时，不会从历史、收藏、关注或本地账号资料里寻找替代证据。'],
    });
  }

  if (isMissingCid(context)) {
    return diagnostics({
      status: 'missing_cid',
      tone: 'blocked',
      title: '缺少 CID，暂时不能检测字幕',
      message: 'Bili-Bill 还没有拿到当前分 P 的 CID，因此不能安全请求 B 站字幕来源或读取字幕正文。',
      action: '请确认视频页加载完成；如果播放器里已经开启中文 AI 字幕，请点击重新检测字幕。',
      evidenceAvailable: false,
      canRetry: true,
      detailLines: [
        'CID 仍未知时，摘要只能使用标题、UP 主、简介、分 P 或章节等元数据兜底。',
      ],
    });
  }

  const evidence = context.transcriptEvidence ?? null;
  if (evidence?.active) {
    return diagnostics({
      status: 'cached',
      tone: 'ready',
      title: '已缓存字幕正文',
      message: `已缓存当前视频字幕正文证据${countText(evidence.segmentCount)}，摘要、知识节点、片段检索和手动跳转会使用这些本地字幕片段。`,
      action: '如果刚切换分 P 或重新开启字幕，可以再次重新检测字幕以刷新证据。',
      evidenceAvailable: true,
      canRetry: true,
      detailLines: [
        coverageText(evidence),
        '字幕正文只作为当前视频的本地证据；普通界面不会展示原始字幕地址、内部片段编号或校验信息。',
      ].filter(Boolean),
    });
  }

  if (evidence && evidence.status !== 'missing') {
    return transcriptEvidenceDiagnostics(evidence);
  }

  const probe = context.subtitleProbe ?? null;
  if (probe) {
    return subtitleProbeDiagnostics(probe);
  }

  if (context.sources.transcript === 'unknown') {
    return diagnostics({
      status: 'enable_ai_subtitle',
      tone: 'warning',
      title: '请先开启中文 AI 字幕',
      message: '当前还没有可用字幕正文。B 站视频通常需要先在播放器里手动开启“中文 AI”字幕，插件才有机会检测到字幕来源。',
      action: '在播放器字幕菜单中开启中文 AI 字幕后，点击重新检测字幕。',
      evidenceAvailable: false,
      canRetry: true,
      detailLines: [notModelFailureText()],
    });
  }

  return diagnostics({
    status: 'metadata_only',
    tone: 'warning',
    title: '仍使用元数据和简介兜底',
    message: '当前没有可引用的字幕正文；摘要不能当作完整视频总结，片段检索和跳转也不能定位到具体字幕时间。',
    action: '如果这个视频提供中文 AI 字幕，请先在播放器里开启，再点击重新检测字幕。',
    evidenceAvailable: false,
    canRetry: true,
    detailLines: [notModelFailureText()],
  });
}

function transcriptEvidenceDiagnostics(
  evidence: CurrentVideoTranscriptEvidenceState,
): CurrentVideoSubtitleDiagnostics {
  switch (evidence.status) {
    case 'stale':
      return diagnostics({
        status: 'stale',
        tone: 'warning',
        title: '本地字幕证据与当前视频不匹配',
        message: '本地缓存的字幕正文不属于当前 BVID、CID、分 P 或语言，已经停止作为当前视频证据使用。',
        action: '点击重新检测字幕，重新读取当前视频的字幕正文。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: ['为了避免把旧视频片段当作当前视频证据，摘要、检索和跳转会继续使用元数据或简介兜底。'],
      });
    case 'empty':
      return diagnostics({
        status: 'empty',
        tone: 'warning',
        title: '字幕正文为空',
        message: '已找到可读取的字幕来源，但 B 站没有返回有效正文片段。',
        action: '请确认播放器里开启的是中文 AI 字幕；如果刚开启，请稍后重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
    case 'malformed':
      return diagnostics({
        status: 'malformed',
        tone: 'warning',
        title: '字幕正文结构异常',
        message: 'B 站返回的字幕正文结构无法稳定解析，Bili-Bill 不会把它当作可引用字幕证据。',
        action: '可以稍后重新检测字幕；在结构恢复前，摘要和定位功能只能使用元数据或简介兜底。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
    case 'language_mismatch':
      return diagnostics({
        status: 'language_mismatch',
        tone: 'warning',
        title: '字幕语言不匹配',
        message: '当前可读字幕不是本次需要的中文 AI 字幕，因此不会作为当前视频正文证据。',
        action: '请在 B 站播放器里切换到中文 AI 字幕后，再点击重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
    case 'login_required':
      return diagnostics({
      status: 'login_required',
      tone: 'blocked',
      title: '字幕需要登录或访问权限',
      message: 'B 站字幕正文接口要求当前浏览器会话具备访问权限。Bili-Bill 不会读取浏览器本地敏感文件。',
      action: '请在浏览器里确认 B 站已登录且播放器字幕可见，然后重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: ['这不是模型失败；当前缺少的是 B 站允许读取的字幕正文。'],
      });
    case 'endpoint_failed':
      return diagnostics({
        status: 'fetch_failed',
        tone: 'warning',
        title: '字幕正文拉取失败',
        message: '已尝试读取字幕正文，但请求失败；当前仍只能使用元数据或简介作为本地证据。',
        action: '请稍后重试，或确认当前视频页仍然打开且字幕已在播放器里开启。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
    case 'track_unavailable':
      return diagnostics({
        status: evidence.reason === 'subtitle_host_unsupported' ? 'unsupported_host' : 'no_track',
        tone: 'warning',
        title: evidence.reason === 'subtitle_host_unsupported' ? '字幕来源不受支持' : '字幕轨道没有正文地址',
        message: evidence.reason === 'subtitle_host_unsupported'
          ? '字幕正文地址不属于受限的 B 站或 hdslb 字幕域名，Bili-Bill 已拒绝读取。'
          : '播放器返回了字幕信息，但没有可读取的正文地址。',
        action: '请在播放器里重新选择中文 AI 字幕后，再点击重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: ['普通界面不会展示原始字幕地址，也不会向其他服务上传字幕。'],
      });
    case 'unsupported':
      return diagnostics({
        status: 'metadata_only',
        tone: 'warning',
        title: '当前页面暂时不能读取字幕正文',
        message: '当前上下文不满足读取字幕正文的条件；Bili-Bill 仍使用元数据或简介兜底。',
        action: '请确认当前标签页是 B 站视频页，再重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
    default:
      return diagnostics({
        status: 'metadata_only',
        tone: 'warning',
        title: '仍使用元数据和简介兜底',
        message: '当前没有可引用的字幕正文；摘要不能当作完整视频总结，片段检索和跳转也不能定位到具体字幕时间。',
        action: '如果这个视频提供中文 AI 字幕，请先在播放器里开启，再点击重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
  }
}

function subtitleProbeDiagnostics(
  probe: CurrentVideoSubtitleSourceState,
): CurrentVideoSubtitleDiagnostics {
  switch (probe.status) {
    case 'available':
      return diagnostics({
        status: 'track_found',
        tone: 'info',
        title: '已发现字幕轨道',
        message: `已检测到当前视频字幕轨道${countText(probe.trackCount)}，但还没有可引用的字幕正文缓存。`,
        action: '点击重新检测字幕，继续读取并缓存字幕正文。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [
          probe.languages.length > 0 ? `检测到语言：${probe.languages.join('、')}` : '',
          '只有字幕正文缓存成功后，摘要、片段检索和手动跳转才会解除限制。',
        ].filter(Boolean),
      });
    case 'login_required':
      return diagnostics({
      status: 'login_required',
      tone: 'blocked',
      title: '字幕需要登录或访问权限',
      message: 'B 站字幕来源检测提示需要当前浏览器会话具备访问权限。Bili-Bill 不会读取浏览器本地敏感文件。',
      action: '请确认 B 站已登录，并在播放器里开启中文 AI 字幕后重新检测。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: ['这不是 DeepSeek 或模型失败；当前缺少的是 B 站字幕访问权限。'],
      });
    case 'unavailable':
      return diagnostics({
        status: 'no_track',
        tone: 'warning',
        title: '没有返回字幕轨道',
        message: 'B 站播放器接口没有返回可用字幕轨道。最常见原因是还没有在播放器里手动开启中文 AI 字幕。',
        action: '请先在播放器字幕菜单中开启中文 AI 字幕，开启后点击重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
    case 'endpoint_failed':
      return diagnostics({
        status: 'fetch_failed',
        tone: 'warning',
        title: '字幕来源检测失败',
        message: '字幕来源检测请求失败，因此还不能读取字幕正文。',
        action: '请稍后重试，或确认当前 B 站视频页仍然打开。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: ['当前仍使用元数据或简介兜底；不会把简介当作完整视频正文。'],
      });
    case 'malformed':
      return diagnostics({
        status: 'malformed',
        tone: 'warning',
        title: '字幕来源结构异常',
        message: 'B 站播放器返回的字幕来源结构无法稳定识别，暂时不会继续读取字幕正文。',
        action: '可以稍后重新检测字幕；在结构恢复前，摘要和定位功能只能使用元数据或简介兜底。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
    default:
      return diagnostics({
        status: probe.reason === 'missing_cid' ? 'missing_cid' : 'metadata_only',
        tone: 'warning',
        title: probe.reason === 'missing_cid' ? '缺少 CID，暂时不能检测字幕' : '当前页面暂时不能检测字幕',
        message: probe.reason === 'missing_cid'
          ? 'Bili-Bill 还没有拿到当前分 P 的 CID，因此不能安全请求 B 站字幕来源。'
          : '当前页面不满足字幕检测条件；仍使用元数据或简介兜底。',
        action: '请确认视频页加载完成，并在播放器里开启中文 AI 字幕后重新检测字幕。',
        evidenceAvailable: false,
        canRetry: true,
        detailLines: [notModelFailureText()],
      });
  }
}

function diagnostics(input: Omit<CurrentVideoSubtitleDiagnostics, 'featureGates'>): CurrentVideoSubtitleDiagnostics {
  return {
    ...input,
    detailLines: input.detailLines.filter(Boolean),
    featureGates: featureGates(input.evidenceAvailable),
  };
}

function featureGates(evidenceAvailable: boolean): CurrentVideoSubtitleFeatureGate[] {
  if (evidenceAvailable) {
    return [
      { label: '摘要', available: true, message: '可用：可基于本地字幕正文生成摘要。' },
      { label: '知识节点', available: true, message: '可用：可生成带时间范围的字幕节点。' },
      { label: '片段检索', available: true, message: '可用：可搜索当前视频字幕片段。' },
      { label: '手动跳转', available: true, message: '可用：命中片段后可预览并手动确认跳转。' },
    ];
  }

  return [
    { label: '摘要', available: false, message: '不可用：没有字幕正文时只能展示元数据或简介说明，不能完整总结。' },
    { label: '知识节点', available: false, message: '不可用：没有字幕正文时不会生成推测时间点。' },
    { label: '片段检索', available: false, message: '不可用：没有字幕正文时不能定位具体片段。' },
    { label: '手动跳转', available: false, message: '不可用：没有可定位片段时不会提供跳转目标。' },
  ];
}

function isMissingCid(context: CurrentVideoContext): boolean {
  return !context.cid
    || context.subtitleProbe?.reason === 'missing_cid'
    || context.transcriptEvidence?.reason === 'missing_cid';
}

function countText(count: number): string {
  return count > 0 ? ` ${count} 条` : '';
}

function coverageText(evidence: CurrentVideoTranscriptEvidenceState): string {
  if (typeof evidence.coverageStartSeconds !== 'number' || typeof evidence.coverageEndSeconds !== 'number') {
    return '';
  }
  return `可引用时间范围：${formatDuration(evidence.coverageStartSeconds)}-${formatDuration(evidence.coverageEndSeconds)}。`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function notModelFailureText(): string {
  return '这不是 DeepSeek 或模型失败；当前缺少的是可引用的当前视频字幕正文。';
}
