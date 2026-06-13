import type {
  FavoriteItem,
  SmartFavoriteCategoryEvidence,
  SmartFavoriteCategoryEvidenceKind,
} from '../../shared/types/favorite.ts';

export const UNCATEGORIZED_PATH = ['未分类'];
export const NEEDS_REVIEW_LABEL = '待确认';

interface TaxonomyEntry {
  path: string[];
  terms: string[];
}

interface TaxonomyTermRef {
  entry: TaxonomyEntry;
  display: string;
  normalized: string;
  pathIndex: number;
  isLeafEvidence: boolean;
}

interface AiFavoriteClassificationInput {
  path?: unknown;
  summary?: unknown;
  keywords?: unknown;
  aliases?: unknown;
}

interface MatchSource {
  label: string;
  kind: 'metadata' | 'ai' | 'path';
  direct: boolean;
  weight: number;
  values: string[];
}

interface LeafScore {
  entry: TaxonomyEntry;
  leafDirectScore: number;
  leafWeakScore: number;
  directTerms: Set<string>;
  weakTerms: Set<string>;
  directSourceKinds: Set<'metadata' | 'ai'>;
  directLabels: Set<string>;
  weakLabels: Set<string>;
}

interface ParentScore {
  path: string[];
  directScore: number;
  weakScore: number;
  directTerms: Set<string>;
  weakTerms: Set<string>;
  directSourceKinds: Set<'metadata' | 'ai'>;
  directLabels: Set<string>;
  weakLabels: Set<string>;
}

export interface FavoritePathClassification {
  path: string[];
  evidence: SmartFavoriteCategoryEvidence;
}

const TAXONOMY: TaxonomyEntry[] = [
  { path: ['知识', '编程'], terms: ['计算机技术', '编程', '代码', '开发', '程序员', '软件工程', '前端', '后端', '算法', 'Python', 'JavaScript', 'TypeScript'] },
  { path: ['知识', '科学'], terms: ['科学科普', '科普', '科学', '物理', '量子力学', '数学', '化学', '生物', '天文', '宇宙', '自然'] },
  { path: ['知识', '社科'], terms: ['社科·法律·心理', '社科', '法律', '心理', '心理学', '社会学', '经济', '经济学', '哲学', '人文'] },
  { path: ['知识', '历史'], terms: ['历史', '历史人文', '战争史', '世界史', '中国史', '近代史', '古代史'] },
  { path: ['知识', '历史', '二战'], terms: ['二战', '第二次世界大战', 'WW2', '苏德战争', '库尔斯克', '诺曼底'] },
  { path: ['知识', '学习'], terms: ['校园学习', '学习', '教程', '公开课', '课程', '考试', '英语', '语言学习'] },
  { path: ['知识', '财经'], terms: ['财经商业', '财经', '商业', '投资', '理财', '金融', '股票', '基金'] },
  { path: ['知识', '职场'], terms: ['职场', '职业', '效率', '办公', '生产力', '管理'] },
  { path: ['娱乐', '游戏'], terms: ['游戏', '单机游戏', '网络游戏', '电子竞技', '手游', '游戏实况', '游戏解说', '攻略', '主机游戏', 'Steam', '独立游戏', '开荒', '速通'] },
  { path: ['娱乐', '影视'], terms: ['影视', '电影', '电视剧', '影评', '影视剪辑', '纪录片', '动画电影'] },
  { path: ['娱乐', '动漫'], terms: ['动画', '动漫', '番剧', '国创', 'MAD', 'MMD', '二次元'] },
  { path: ['娱乐', '音乐'], terms: ['音乐', '原创音乐', '翻唱', 'VOCALOID', '演奏', '乐器', '音乐现场'] },
  { path: ['娱乐', '生活'], terms: ['生活', '日常', '搞笑', '美食', '探店', '餐厅', '菜品', '旅行', '家居', '手工', '萌宠', 'vlog'] },
  { path: ['创作', '设计'], terms: ['设计', '绘画', '美术', '摄影', '视觉设计', '平面设计', 'UI', '建模'] },
  { path: ['创作', '剪辑'], terms: ['剪辑', '视频制作', '后期', '特效', '拍摄', '调色'] },
  { path: ['科技', '数码'], terms: ['数码', '科技', '手机', '电脑', '硬件', '测评', '装机', 'AI', '人工智能'] },
  { path: ['汽车', '交通'], terms: ['汽车', '新能源车', '赛车', '摩托', '交通', '驾驶'] },
  { path: ['体育', '运动'], terms: ['体育', '运动', '健身', '篮球', '足球', '跑步', '格斗'] },
];

const TERM_REFS = buildTermRefs(TAXONOMY);

export function classifyFavoritePath(
  item: FavoriteItem,
  ai: AiFavoriteClassificationInput | undefined,
): FavoritePathClassification {
  const leafScores = new Map<string, LeafScore>();
  const parentScores = new Map<string, ParentScore>();
  const sources = buildSources(item, ai);

  for (const source of sources) {
    for (const value of source.values) {
      const normalizedValue = normalizeForTaxonomy(value);
      if (!normalizedValue) continue;

      for (const ref of TERM_REFS) {
        if (!normalizedValue.includes(ref.normalized)) continue;
        accumulateLeafScore(leafScores, ref, source, value);
        accumulateParentScore(parentScores, ref, source, value);
      }
    }
  }

  const bestLeaf = pickBestLeaf(leafScores);
  if (bestLeaf && bestLeaf.leafDirectScore > 0) {
    return {
      path: bestLeaf.entry.path.slice(0, 4),
      evidence: buildResolvedEvidence(bestLeaf),
    };
  }

  const bestParent = pickBestParent(parentScores);
  const bestWeakLeaf = bestLeaf && bestLeaf.leafWeakScore > 0 ? bestLeaf : null;

  if (bestParent && bestParent.directScore > 0) {
    const path = bestWeakLeaf && isPathPrefix(bestParent.path, bestWeakLeaf.entry.path)
      ? [...bestParent.path, NEEDS_REVIEW_LABEL].slice(0, 4)
      : bestParent.path.slice(0, 4);
    return {
      path,
      evidence: buildParentFallbackEvidence(bestParent, bestWeakLeaf),
    };
  }

  if (bestWeakLeaf) {
    const parentPath = bestWeakLeaf.entry.path.slice(0, -1);
    if (parentPath.length > 0) {
      return {
        path: [...parentPath, NEEDS_REVIEW_LABEL].slice(0, 4),
        evidence: buildWeakFallbackEvidence(parentPath, bestWeakLeaf),
      };
    }
  }

  if (bestParent && bestParent.weakScore > 0) {
    return {
      path: [...bestParent.path, NEEDS_REVIEW_LABEL].slice(0, 4),
      evidence: buildWeakParentFallbackEvidence(bestParent),
    };
  }

  return {
    path: UNCATEGORIZED_PATH,
    evidence: {
      kind: 'path_fallback',
      summary: '路径兜底：缺少可用分类证据，暂列未分类。',
      directTerms: [],
      weakTerms: [],
      downgraded: true,
    },
  };
}

export function normalizeFavoritePath(aiPath: unknown, item: FavoriteItem): string[] {
  return classifyFavoritePath(item, { path: aiPath }).path;
}

export function expandFavoriteSearchTerms(terms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of terms.map(term => term.trim()).filter(Boolean)) {
    expanded.add(term);
    for (const related of getRelatedTerms(term)) {
      expanded.add(related);
    }
  }
  return Array.from(expanded).slice(0, 32);
}

export function buildTaxonomyPromptSummary(): string {
  return TAXONOMY
    .map(entry => `${entry.path.join(' / ')}：${entry.terms.slice(0, 8).join('、')}`)
    .join('\n');
}

function buildTermRefs(entries: TaxonomyEntry[]): TaxonomyTermRef[] {
  const refs: TaxonomyTermRef[] = [];
  for (const entry of entries) {
    entry.path.forEach((part, pathIndex) => {
      refs.push({
        entry,
        display: part,
        normalized: normalizeForTaxonomy(part),
        pathIndex,
        isLeafEvidence: pathIndex === entry.path.length - 1,
      });
    });
    for (const term of entry.terms) {
      refs.push({
        entry,
        display: term,
        normalized: normalizeForTaxonomy(term),
        pathIndex: entry.path.length - 1,
        isLeafEvidence: true,
      });
    }
  }
  return refs;
}

function buildSources(item: FavoriteItem, ai: AiFavoriteClassificationInput | undefined): MatchSource[] {
  return [
    { label: '标题', kind: 'metadata', direct: true, weight: 7, values: [item.title] },
    { label: '简介', kind: 'metadata', direct: true, weight: 4, values: [item.intro] },
    { label: 'B站分区', kind: 'metadata', direct: true, weight: 6, values: [item.tagName] },
    { label: 'B站标签', kind: 'metadata', direct: true, weight: 6, values: item.tags ?? [] },
    { label: 'AI摘要', kind: 'ai', direct: true, weight: 5, values: [normalizeText(ai?.summary)] },
    { label: 'AI关键词', kind: 'ai', direct: true, weight: 6, values: normalizeTextArray(ai?.keywords) },
    { label: 'AI别名', kind: 'ai', direct: true, weight: 4, values: normalizeTextArray(ai?.aliases) },
    { label: 'AI路径', kind: 'path', direct: false, weight: 3, values: normalizeTextArray(ai?.path) },
    { label: '原收藏夹', kind: 'path', direct: false, weight: 2, values: [item.folderTitle] },
  ];
}

function accumulateLeafScore(
  scores: Map<string, LeafScore>,
  ref: TaxonomyTermRef,
  source: MatchSource,
  rawValue: string,
): void {
  const key = pathKey(ref.entry.path);
  const score = scores.get(key) ?? {
    entry: ref.entry,
    leafDirectScore: 0,
    leafWeakScore: 0,
    directTerms: new Set<string>(),
    weakTerms: new Set<string>(),
    directSourceKinds: new Set<'metadata' | 'ai'>(),
    directLabels: new Set<string>(),
    weakLabels: new Set<string>(),
  };

  if (ref.isLeafEvidence) {
    if (source.direct) {
      score.leafDirectScore += source.weight;
      score.directTerms.add(extractMatchedTerm(rawValue, ref.display, ref.normalized, ref.entry.path.at(-1) ?? ''));
      score.directLabels.add(source.label);
      if (source.kind !== 'path') {
        score.directSourceKinds.add(source.kind);
      }
    } else {
      score.leafWeakScore += source.weight;
      score.weakTerms.add(extractMatchedTerm(rawValue, ref.display, ref.normalized, ref.entry.path.at(-1) ?? ''));
      score.weakLabels.add(source.label);
    }
  } else if (!source.direct) {
    score.weakLabels.add(source.label);
  }

  scores.set(key, score);
}

function accumulateParentScore(
  scores: Map<string, ParentScore>,
  ref: TaxonomyTermRef,
  source: MatchSource,
  rawValue: string,
): void {
  const parentPath = ref.isLeafEvidence ? ref.entry.path.slice(0, -1) : ref.entry.path.slice(0, ref.pathIndex + 1);
  if (parentPath.length === 0) return;

  const key = pathKey(parentPath);
  const score = scores.get(key) ?? {
    path: parentPath,
    directScore: 0,
    weakScore: 0,
    directTerms: new Set<string>(),
    weakTerms: new Set<string>(),
    directSourceKinds: new Set<'metadata' | 'ai'>(),
    directLabels: new Set<string>(),
    weakLabels: new Set<string>(),
  };

  if (source.direct) {
    score.directScore += Math.max(1, source.weight - (ref.isLeafEvidence ? 1 : 0));
    score.directTerms.add(extractMatchedTerm(rawValue, ref.display, ref.normalized, parentPath.at(-1) ?? ''));
    score.directLabels.add(source.label);
    if (source.kind !== 'path') {
      score.directSourceKinds.add(source.kind);
    }
  } else {
    score.weakScore += source.weight;
    score.weakTerms.add(extractMatchedTerm(rawValue, ref.display, ref.normalized, parentPath.at(-1) ?? ''));
    score.weakLabels.add(source.label);
  }

  scores.set(key, score);
}

function pickBestLeaf(scores: Map<string, LeafScore>): LeafScore | null {
  const ranked = Array.from(scores.values()).sort((a, b) => {
    return (
      b.leafDirectScore - a.leafDirectScore
      || b.leafWeakScore - a.leafWeakScore
      || b.directTerms.size - a.directTerms.size
      || b.entry.path.length - a.entry.path.length
      || a.entry.path.join('/').localeCompare(b.entry.path.join('/'), 'zh-CN')
    );
  });
  return ranked[0] ?? null;
}

function pickBestParent(scores: Map<string, ParentScore>): ParentScore | null {
  const ranked = Array.from(scores.values()).sort((a, b) => {
    return (
      b.directScore - a.directScore
      || b.weakScore - a.weakScore
      || b.path.length - a.path.length
      || a.path.join('/').localeCompare(b.path.join('/'), 'zh-CN')
    );
  });
  return ranked[0] ?? null;
}

function buildResolvedEvidence(score: LeafScore): SmartFavoriteCategoryEvidence {
  const kind = resolveEvidenceKind(score.directSourceKinds);
  const directTerms = Array.from(score.directTerms).filter(Boolean).slice(0, 3);
  const sourceLabels = Array.from(score.directLabels).slice(0, 2).join('、') || '直接证据';
  return {
    kind,
    summary: `${labelForEvidenceKind(kind)}：${sourceLabels}命中“${directTerms.join('、') || score.entry.path.at(-1)}”，归入 ${score.entry.path.join(' / ')}。`,
    directTerms,
    weakTerms: Array.from(score.weakTerms).filter(Boolean).slice(0, 3),
    downgraded: false,
  };
}

function buildParentFallbackEvidence(parent: ParentScore, weakLeaf: LeafScore | null): SmartFavoriteCategoryEvidence {
  const directTerms = Array.from(parent.directTerms).filter(Boolean).slice(0, 3);
  const weakLeafName = weakLeaf?.entry.path.at(-1) ?? '具体子类';
  return {
    kind: weakLeaf ? 'path_fallback' : resolveEvidenceKind(parent.directSourceKinds),
    summary: weakLeaf
      ? `路径兜底：只能确认到 ${parent.path.join(' / ')}，但标题、简介、标签和 AI 关键词里缺少“${weakLeafName}”直接证据，暂放 ${[...parent.path, NEEDS_REVIEW_LABEL].join(' / ')}。`
      : `${labelForEvidenceKind(resolveEvidenceKind(parent.directSourceKinds))}：目前只能确认到 ${parent.path.join(' / ')}，证据不足，未放入具体子类。`,
    directTerms,
    weakTerms: weakLeaf ? Array.from(weakLeaf.weakTerms).filter(Boolean).slice(0, 3) : [],
    downgraded: true,
  };
}

function buildWeakFallbackEvidence(parentPath: string[], leaf: LeafScore): SmartFavoriteCategoryEvidence {
  const weakLeafName = leaf.entry.path.at(-1) ?? '具体子类';
  return {
    kind: 'path_fallback',
    summary: `路径兜底：${Array.from(leaf.weakLabels).slice(0, 2).join('、') || '弱路径提示'}指向“${weakLeafName}”，但缺少标题、简介、标签或 AI 关键词的直接证据，暂放 ${[...parentPath, NEEDS_REVIEW_LABEL].join(' / ')}。`,
    directTerms: [],
    weakTerms: Array.from(leaf.weakTerms).filter(Boolean).slice(0, 3),
    downgraded: true,
  };
}

function buildWeakParentFallbackEvidence(parent: ParentScore): SmartFavoriteCategoryEvidence {
  return {
    kind: 'path_fallback',
    summary: `路径兜底：只有${Array.from(parent.weakLabels).slice(0, 2).join('、') || '弱路径提示'}支持 ${parent.path.join(' / ')}，证据不足，暂放 ${[...parent.path, NEEDS_REVIEW_LABEL].join(' / ')}。`,
    directTerms: [],
    weakTerms: Array.from(parent.weakTerms).filter(Boolean).slice(0, 3),
    downgraded: true,
  };
}

function resolveEvidenceKind(kinds: Set<'metadata' | 'ai'>): SmartFavoriteCategoryEvidenceKind {
  if (kinds.has('metadata') && kinds.has('ai')) return 'mixed';
  if (kinds.has('ai')) return 'ai';
  return 'metadata';
}

function labelForEvidenceKind(kind: SmartFavoriteCategoryEvidenceKind): string {
  switch (kind) {
    case 'ai':
      return 'AI证据';
    case 'mixed':
      return 'AI + 元数据证据';
    case 'path_fallback':
      return '路径兜底';
    case 'metadata':
    default:
      return '元数据证据';
  }
}

function getRelatedTerms(term: string): string[] {
  const normalized = normalizeForTaxonomy(term);
  if (!normalized) return [];
  return Array.from(new Set(TERM_REFS
    .filter(ref => ref.normalized.includes(normalized) || normalized.includes(ref.normalized))
    .flatMap(ref => [...ref.entry.path, ...ref.entry.terms])));
}

function extractMatchedTerm(rawValue: string, displayTerm: string, normalizedNeedle: string, fallback: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return fallback || displayTerm || normalizedNeedle;
  return displayTerm || fallback || normalizedNeedle;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function pathKey(path: string[]): string {
  return path.join('\u0001');
}

function isPathPrefix(prefix: string[], path: string[]): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((part, index) => part === path[index]);
}

function normalizeForTaxonomy(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·・._\-_/\\|:：,，。!！？?（）()[\]【】《》<>"“”'`]+/g, '');
}
