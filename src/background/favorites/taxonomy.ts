import type { FavoriteItem } from '../../shared/types/favorite';

export const UNCATEGORIZED_PATH = ['未分类'];
export const SMART_FAVORITE_TAXONOMY_VERSION = 'taxonomy-v2';

interface TaxonomyEntry {
  path: string[];
  terms: string[];
}

interface TaxonomyMatch {
  entry: TaxonomyEntry;
  matchedTerm: string;
  matchedIndex: number;
}

const TAXONOMY: TaxonomyEntry[] = [
  { path: ['知识', '编程'], terms: ['计算机技术', '编程', '代码', '开发', '程序员', '软件工程', '前端', '后端', '算法', 'Python', 'JavaScript', 'TypeScript', 'AI编程', 'Vibe Coding', 'Codex', 'Cursor', 'Claude Code', 'Copilot', 'MCP', 'Agent'] },
  { path: ['知识', '科学'], terms: ['科学科普', '科普', '科学', '物理', '量子力学', '数学', '化学', '生物', '天文', '宇宙', '自然'] },
  { path: ['知识', '社科'], terms: ['社科·法律·心理', '社科', '法律', '心理', '心理学', '社会学', '经济', '经济学', '哲学', '人文'] },
  { path: ['知识', '历史'], terms: ['历史', '历史人文', '战争史', '世界史', '中国史', '近代史', '古代史'] },
  { path: ['知识', '历史', '二战'], terms: ['二战', '第二次世界大战', 'WW2', '苏德战争', '库尔斯克', '诺曼底'] },
  { path: ['知识', '军事'], terms: ['军事', '军武', '武器', '装备', '战术', '军队'] },
  { path: ['知识', '学习'], terms: ['校园学习', '学习', '教程', '公开课', '课程', '考试', '考研', '英语', '语言学习', '知识库', 'NotebookLM', '插件', '浏览器插件', '字幕插件'] },
  { path: ['知识', '财经'], terms: ['财经商业', '财经', '商业', '投资', '理财', '金融', '股票', '基金'] },
  { path: ['知识', '职场'], terms: ['职场', '职业', '效率', '办公', '生产力', '管理', '求职', '面试', '求职面试'] },
  { path: ['娱乐', '游戏'], terms: ['游戏', '单机游戏', '网络游戏', '电子竞技', '手游', '游戏实况', '主机游戏', 'Steam', '独立游戏'] },
  { path: ['娱乐', '影视'], terms: ['影视', '电影', '电视剧', '影评', '影视剪辑', '纪录片', '动画电影'] },
  { path: ['娱乐', '动漫'], terms: ['动画', '动漫', '番剧', '国创', 'MAD', 'MMD', '二次元'] },
  { path: ['娱乐', '音乐'], terms: ['音乐', '原创音乐', '翻唱', 'VOCALOID', '演奏', '乐器', '音乐现场'] },
  { path: ['娱乐', '生活'], terms: ['生活', '日常', '搞笑', '美食', '旅行', '家居', '手工', '萌宠'] },
  { path: ['创作', '设计'], terms: ['设计', '绘画', '美术', '摄影', '视觉设计', '平面设计', 'UI', '建模'] },
  { path: ['创作', '剪辑'], terms: ['剪辑', '视频制作', '后期', '特效', '拍摄', '调色'] },
  { path: ['科技', '数码'], terms: ['数码', '科技', '手机', '电脑', '硬件', '测评', '装机', 'AI', '人工智能'] },
  { path: ['汽车', '交通'], terms: ['汽车', '新能源车', '赛车', '摩托', '交通', '驾驶'] },
  { path: ['体育', '运动'], terms: ['体育', '运动', '健身', '篮球', '足球', '跑步', '格斗'] },
];

const TERM_INDEX = buildTermIndex(TAXONOMY);

export function normalizeFavoritePath(aiPath: unknown, item: FavoriteItem): string[] {
  const aiParts = normalizeTextArray(aiPath).slice(0, 4);
  const bilibiliTerms = [item.tagName, ...(item.tags ?? [])];
  const contentTerms = [item.title];
  const folderTerms = isGenericFolderTitle(item.folderTitle) ? [] : [item.folderTitle];

  const bilibiliMatch = findBestTaxonomyMatch(bilibiliTerms, true);
  if (bilibiliMatch) {
    return appendCompatibleTail(bilibiliMatch.entry.path, aiParts);
  }

  const contentMatch = findBestTaxonomyMatch(contentTerms, true);
  if (contentMatch) {
    return appendCompatibleTail(contentMatch.entry.path, aiParts);
  }

  const folderMatch = findBestTaxonomyMatch(folderTerms, true);
  if (folderMatch) {
    return appendCompatibleTail(folderMatch.entry.path, aiParts);
  }

  const aiMatch = findBestTaxonomyMatch(aiParts, false);
  if (aiMatch && hasNonGenericAiTail(aiParts, aiMatch.entry.path)) {
    return appendAiTailAfterMatch(aiMatch, aiParts);
  }

  const fallback = [
    item.tagName,
    isGenericFolderTitle(item.folderTitle) ? '' : item.folderTitle,
    '未分类',
  ].map(part => part.trim()).filter(Boolean);
  if (fallback.length > 0) return fallback.slice(0, 4);
  return UNCATEGORIZED_PATH;
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

function buildTermIndex(entries: TaxonomyEntry[]): Map<string, TaxonomyEntry[]> {
  const index = new Map<string, TaxonomyEntry[]>();
  for (const entry of entries) {
    for (const term of getMatchTerms(entry)) {
      const key = normalizeForTaxonomy(term);
      const bucket = index.get(key) ?? [];
      bucket.push(entry);
      index.set(key, bucket);
    }
  }
  return index;
}

function findBestTaxonomyMatch(terms: string[], allowContains: boolean): TaxonomyMatch | null {
  let best: TaxonomyMatch | null = null;

  terms.forEach((term, matchedIndex) => {
    const normalizedTerm = normalizeForTaxonomy(term);
    const entries = TERM_INDEX.get(normalizedTerm) ?? [];
    for (const entry of entries) {
      if (!best || entry.path.length > best.entry.path.length) {
        best = { entry, matchedTerm: term, matchedIndex };
      }
    }

    if (!allowContains || entries.length > 0) return;
    for (const entry of TAXONOMY) {
      for (const candidate of getMatchTerms(entry)) {
        const key = normalizeForTaxonomy(candidate);
        if (!isUsefulContainsKey(key)) continue;
        if (!normalizedTerm.includes(key)) continue;
        if (!best || entry.path.length > best.entry.path.length) {
          best = { entry, matchedTerm: candidate, matchedIndex };
        }
      }
    }
  });

  return best;
}

function getMatchTerms(entry: TaxonomyEntry): string[] {
  return [entry.path[entry.path.length - 1], ...entry.terms].filter(Boolean);
}

function appendCompatibleTail(basePath: string[], aiParts: string[]): string[] {
  const path = [...basePath];
  for (const part of aiParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (path.some(existing => normalizeForTaxonomy(existing) === normalizeForTaxonomy(trimmed))) continue;
    if (TERM_INDEX.has(normalizeForTaxonomy(trimmed))) continue;
    path.push(trimmed);
    if (path.length >= 4) break;
  }

  return path.slice(0, 4);
}

function appendAiTailAfterMatch(match: TaxonomyMatch, aiParts: string[]): string[] {
  const path = [...match.entry.path];
  const matchedPartIndex = aiParts.findIndex(part => normalizeForTaxonomy(part) === normalizeForTaxonomy(match.matchedTerm));
  for (const part of aiParts.slice(Math.max(0, matchedPartIndex + 1))) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (path.some(existing => normalizeForTaxonomy(existing) === normalizeForTaxonomy(trimmed))) continue;
    if (TERM_INDEX.has(normalizeForTaxonomy(trimmed))) continue;
    path.push(trimmed);
    if (path.length >= 4) break;
  }
  return path.slice(0, 4);
}

function hasNonGenericAiTail(aiParts: string[], basePath: string[]): boolean {
  const baseKeys = new Set(basePath.map(normalizeForTaxonomy));
  return aiParts.some(part => {
    const key = normalizeForTaxonomy(part);
    return key.length > 0 && !baseKeys.has(key) && !TERM_INDEX.has(key);
  });
}

function getRelatedTerms(term: string): string[] {
  const normalized = normalizeForTaxonomy(term);
  const exact = TERM_INDEX.get(normalized);
  if (exact) {
    return exact.flatMap(entry => [...entry.path, ...entry.terms]);
  }

  return TAXONOMY
    .filter(entry => [...entry.path, ...entry.terms].some(candidate => {
      const value = normalizeForTaxonomy(candidate);
      return value.includes(normalized) || normalized.includes(value);
    }))
    .flatMap(entry => [...entry.path, ...entry.terms]);
}

function isUsefulContainsKey(value: string): boolean {
  if (value === 'ai' || value.length < 2) return false;
  return value.length >= 3 || /[\u4e00-\u9fff]/.test(value);
}

function isGenericFolderTitle(value: string): boolean {
  const normalized = normalizeForTaxonomy(value);
  return !normalized || normalized === normalizeForTaxonomy('默认收藏夹') || normalized === normalizeForTaxonomy('收藏夹');
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function normalizeForTaxonomy(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·・._\-_/\\|:：,，。!！？?（）()[\]【】《》<>"“”'`]+/g, '');
}
