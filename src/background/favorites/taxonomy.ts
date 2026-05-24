import type { FavoriteItem } from '../../shared/types/favorite';

export const UNCATEGORIZED_PATH = ['未分类'];
export const SMART_FAVORITE_TAXONOMY_VERSION = 'bili-native-taxonomy-v3';

interface BiliRegion {
  id: number;
  name: string;
  parentId?: number;
  parentName?: string;
  aliases?: string[];
}

interface AiTailLike {
  path?: unknown;
  topicTail?: unknown;
}

interface BiliRegionInput {
  tid?: number;
  tname?: string;
  tidV2?: number;
  tnameV2?: string;
  pidV2?: number;
  pidNameV2?: string;
}

export interface ResolvedBiliRegion {
  tid?: number;
  tname?: string;
  tidV2?: number;
  tnameV2?: string;
  pidV2?: number;
  pidNameV2?: string;
  legacyPath: string[];
  v2Path: string[];
  preferredPath: string[];
}

export interface FavoriteBasePath {
  path: string[];
  source: 'bili_v2' | 'bili_legacy' | 'tag_override' | 'folder' | 'uncategorized';
}

const OLD_REGIONS: BiliRegion[] = [
  { id: 1, name: '动画' },
  { id: 24, name: 'MAD·AMV', parentId: 1, parentName: '动画' },
  { id: 25, name: 'MMD·3D', parentId: 1, parentName: '动画' },
  { id: 47, name: '短片·手书·配音', parentId: 1, parentName: '动画' },
  { id: 27, name: '综合', parentId: 1, parentName: '动画' },
  { id: 13, name: '番剧' },
  { id: 33, name: '连载动画', parentId: 13, parentName: '番剧' },
  { id: 32, name: '完结动画', parentId: 13, parentName: '番剧' },
  { id: 51, name: '资讯', parentId: 13, parentName: '番剧' },
  { id: 152, name: '官方延伸', parentId: 13, parentName: '番剧' },
  { id: 167, name: '国创' },
  { id: 153, name: '国产动画', parentId: 167, parentName: '国创' },
  { id: 168, name: '国产原创相关', parentId: 167, parentName: '国创' },
  { id: 169, name: '布袋戏', parentId: 167, parentName: '国创' },
  { id: 195, name: '动态漫·广播剧', parentId: 167, parentName: '国创' },
  { id: 170, name: '资讯', parentId: 167, parentName: '国创' },
  { id: 3, name: '音乐' },
  { id: 28, name: '原创音乐', parentId: 3, parentName: '音乐' },
  { id: 31, name: '翻唱', parentId: 3, parentName: '音乐' },
  { id: 30, name: 'VOCALOID·UTAU', parentId: 3, parentName: '音乐' },
  { id: 194, name: '电音', parentId: 3, parentName: '音乐' },
  { id: 59, name: '演奏', parentId: 3, parentName: '音乐' },
  { id: 29, name: '音乐现场', parentId: 3, parentName: '音乐' },
  { id: 130, name: '音乐综合', parentId: 3, parentName: '音乐' },
  { id: 193, name: 'MV', parentId: 3, parentName: '音乐' },
  { id: 243, name: '乐评盘点', parentId: 3, parentName: '音乐' },
  { id: 4, name: '游戏' },
  { id: 17, name: '单机游戏', parentId: 4, parentName: '游戏' },
  { id: 171, name: '电子竞技', parentId: 4, parentName: '游戏' },
  { id: 172, name: '手机游戏', parentId: 4, parentName: '游戏' },
  { id: 65, name: '网络游戏', parentId: 4, parentName: '游戏' },
  { id: 173, name: '桌游棋牌', parentId: 4, parentName: '游戏' },
  { id: 121, name: 'GMV', parentId: 4, parentName: '游戏' },
  { id: 136, name: '音游', parentId: 4, parentName: '游戏' },
  { id: 19, name: 'Mugen', parentId: 4, parentName: '游戏' },
  { id: 129, name: '舞蹈' },
  { id: 20, name: '宅舞', parentId: 129, parentName: '舞蹈' },
  { id: 198, name: '街舞', parentId: 129, parentName: '舞蹈' },
  { id: 199, name: '明星舞蹈', parentId: 129, parentName: '舞蹈' },
  { id: 200, name: '国风舞蹈', parentId: 129, parentName: '舞蹈' },
  { id: 154, name: '舞蹈综合', parentId: 129, parentName: '舞蹈' },
  { id: 156, name: '舞蹈教程', parentId: 129, parentName: '舞蹈' },
  { id: 36, name: '知识' },
  { id: 201, name: '科学科普', parentId: 36, parentName: '知识' },
  { id: 124, name: '社科·法律·心理', parentId: 36, parentName: '知识' },
  { id: 228, name: '人文历史', parentId: 36, parentName: '知识' },
  { id: 207, name: '财经商业', parentId: 36, parentName: '知识' },
  { id: 208, name: '校园学习', parentId: 36, parentName: '知识' },
  { id: 209, name: '职业职场', parentId: 36, parentName: '知识' },
  { id: 229, name: '设计·创意', parentId: 36, parentName: '知识' },
  { id: 122, name: '野生技能协会', parentId: 36, parentName: '知识' },
  { id: 188, name: '科技' },
  { id: 95, name: '数码', parentId: 188, parentName: '科技' },
  { id: 230, name: '软件应用', parentId: 188, parentName: '科技' },
  { id: 231, name: '计算机技术', parentId: 188, parentName: '科技' },
  { id: 232, name: '科工机械', parentId: 188, parentName: '科技' },
  { id: 233, name: '极客DIY', parentId: 188, parentName: '科技' },
  { id: 234, name: '运动' },
  { id: 235, name: '篮球', parentId: 234, parentName: '运动' },
  { id: 249, name: '足球', parentId: 234, parentName: '运动' },
  { id: 164, name: '健身', parentId: 234, parentName: '运动' },
  { id: 236, name: '竞技体育', parentId: 234, parentName: '运动' },
  { id: 237, name: '运动文化', parentId: 234, parentName: '运动' },
  { id: 238, name: '运动综合', parentId: 234, parentName: '运动' },
  { id: 223, name: '汽车' },
  { id: 176, name: '汽车生活', parentId: 223, parentName: '汽车' },
  { id: 224, name: '汽车文化', parentId: 223, parentName: '汽车' },
  { id: 225, name: '汽车极客', parentId: 223, parentName: '汽车' },
  { id: 240, name: '摩托车', parentId: 223, parentName: '汽车' },
  { id: 227, name: '购车攻略', parentId: 223, parentName: '汽车' },
  { id: 247, name: '新能源车', parentId: 223, parentName: '汽车' },
  { id: 160, name: '生活' },
  { id: 138, name: '搞笑', parentId: 160, parentName: '生活' },
  { id: 21, name: '日常', parentId: 160, parentName: '生活' },
  { id: 76, name: '美食圈', parentId: 160, parentName: '生活' },
  { id: 75, name: '动物圈', parentId: 160, parentName: '生活' },
  { id: 161, name: '手工', parentId: 160, parentName: '生活' },
  { id: 162, name: '绘画', parentId: 160, parentName: '生活' },
  { id: 163, name: '运动', parentId: 160, parentName: '生活' },
  { id: 174, name: '其他', parentId: 160, parentName: '生活' },
  { id: 211, name: '美食' },
  { id: 76, name: '美食制作', parentId: 211, parentName: '美食' },
  { id: 212, name: '美食侦探', parentId: 211, parentName: '美食' },
  { id: 213, name: '美食测评', parentId: 211, parentName: '美食' },
  { id: 214, name: '田园美食', parentId: 211, parentName: '美食' },
  { id: 215, name: '美食记录', parentId: 211, parentName: '美食' },
  { id: 119, name: '鬼畜' },
  { id: 22, name: '鬼畜调教', parentId: 119, parentName: '鬼畜' },
  { id: 26, name: '音MAD', parentId: 119, parentName: '鬼畜' },
  { id: 126, name: '人力VOCALOID', parentId: 119, parentName: '鬼畜' },
  { id: 216, name: '鬼畜剧场', parentId: 119, parentName: '鬼畜' },
  { id: 127, name: '教程演示', parentId: 119, parentName: '鬼畜' },
  { id: 155, name: '时尚' },
  { id: 157, name: '美妆护肤', parentId: 155, parentName: '时尚' },
  { id: 158, name: '服饰', parentId: 155, parentName: '时尚' },
  { id: 159, name: 'T台', parentId: 155, parentName: '时尚' },
  { id: 192, name: '风尚标', parentId: 155, parentName: '时尚' },
  { id: 202, name: '资讯' },
  { id: 203, name: '热点', parentId: 202, parentName: '资讯' },
  { id: 204, name: '环球', parentId: 202, parentName: '资讯' },
  { id: 205, name: '社会', parentId: 202, parentName: '资讯' },
  { id: 206, name: '综合', parentId: 202, parentName: '资讯' },
  { id: 5, name: '娱乐' },
  { id: 71, name: '综艺', parentId: 5, parentName: '娱乐' },
  { id: 137, name: '明星', parentId: 5, parentName: '娱乐' },
  { id: 181, name: '影视' },
  { id: 182, name: '影视杂谈', parentId: 181, parentName: '影视' },
  { id: 183, name: '影视剪辑', parentId: 181, parentName: '影视' },
  { id: 85, name: '短片', parentId: 181, parentName: '影视' },
  { id: 184, name: '预告·资讯', parentId: 181, parentName: '影视' },
  { id: 177, name: '纪录片' },
  { id: 37, name: '人文·历史', parentId: 177, parentName: '纪录片' },
  { id: 178, name: '科学·探索·自然', parentId: 177, parentName: '纪录片' },
  { id: 179, name: '军事', parentId: 177, parentName: '纪录片' },
  { id: 180, name: '社会·美食·旅行', parentId: 177, parentName: '纪录片' },
  { id: 23, name: '电影' },
  { id: 147, name: '华语电影', parentId: 23, parentName: '电影' },
  { id: 145, name: '欧美电影', parentId: 23, parentName: '电影' },
  { id: 146, name: '日本电影', parentId: 23, parentName: '电影' },
  { id: 83, name: '其他国家', parentId: 23, parentName: '电影' },
  { id: 11, name: '电视剧' },
  { id: 185, name: '国产剧', parentId: 11, parentName: '电视剧' },
  { id: 187, name: '海外剧', parentId: 11, parentName: '电视剧' },
];

const V2_REGIONS: BiliRegion[] = [
  { id: 1005, name: '动画' },
  { id: 2016, name: '动画综合', parentId: 1005, parentName: '动画' },
  { id: 2017, name: '动漫杂谈', parentId: 1005, parentName: '动画' },
  { id: 2018, name: 'MMD·3D', parentId: 1005, parentName: '动画' },
  { id: 2019, name: 'MAD·AMV', parentId: 1005, parentName: '动画' },
  { id: 2020, name: '动画短片', parentId: 1005, parentName: '动画' },
  { id: 1008, name: '游戏' },
  { id: 2066, name: '单机主机类游戏', parentId: 1008, parentName: '游戏' },
  { id: 2067, name: '三坑桌游类游戏', parentId: 1008, parentName: '游戏' },
  { id: 2068, name: '网游手游类游戏', parentId: 1008, parentName: '游戏' },
  { id: 2069, name: '电子竞技类游戏', parentId: 1008, parentName: '游戏' },
  { id: 2070, name: '游戏杂谈', parentId: 1008, parentName: '游戏' },
  { id: 2071, name: '射击游戏', parentId: 1008, parentName: '游戏' },
  { id: 2072, name: '冒险游戏', parentId: 1008, parentName: '游戏' },
  { id: 2073, name: '解谜游戏', parentId: 1008, parentName: '游戏' },
  { id: 2074, name: '音乐舞蹈游戏', parentId: 1008, parentName: '游戏' },
  { id: 2075, name: '休闲益智游戏', parentId: 1008, parentName: '游戏' },
  { id: 2076, name: '体育竞速游戏', parentId: 1008, parentName: '游戏' },
  { id: 2077, name: '模拟经营游戏', parentId: 1008, parentName: '游戏' },
  { id: 2078, name: '策略战棋游戏', parentId: 1008, parentName: '游戏' },
  { id: 2079, name: '角色扮演游戏', parentId: 1008, parentName: '游戏' },
  { id: 2080, name: '动作格斗游戏', parentId: 1008, parentName: '游戏' },
  { id: 1009, name: '二次元' },
  { id: 2081, name: '二次元绘画', parentId: 1009, parentName: '二次元' },
  { id: 2082, name: '二次元装扮', parentId: 1009, parentName: '二次元' },
  { id: 2083, name: '二次元资讯', parentId: 1009, parentName: '二次元' },
  { id: 2084, name: '二次元综合', parentId: 1009, parentName: '二次元' },
  { id: 1010, name: '知识' },
  { id: 2085, name: '校园学习', parentId: 1010, parentName: '知识' },
  { id: 2086, name: '职业职场', parentId: 1010, parentName: '知识' },
  { id: 2087, name: '商业财经', parentId: 1010, parentName: '知识' },
  { id: 2088, name: '科学科普', parentId: 1010, parentName: '知识' },
  { id: 2089, name: '社科人文', parentId: 1010, parentName: '知识' },
  { id: 2090, name: '法律心理', parentId: 1010, parentName: '知识' },
  { id: 1011, name: '人工智能' },
  { id: 2096, name: 'AI学习', parentId: 1011, parentName: '人工智能' },
  { id: 2097, name: 'AI资讯', parentId: 1011, parentName: '人工智能' },
  { id: 2098, name: 'AI杂谈', parentId: 1011, parentName: '人工智能' },
  { id: 1012, name: '科技数码' },
  { id: 2099, name: '电脑', parentId: 1012, parentName: '科技数码' },
  { id: 2100, name: '手机平板', parentId: 1012, parentName: '科技数码' },
  { id: 2101, name: '摄影摄像', parentId: 1012, parentName: '科技数码' },
  { id: 2102, name: '影音智能', parentId: 1012, parentName: '科技数码' },
  { id: 2103, name: '工程机械', parentId: 1012, parentName: '科技数码' },
  { id: 2104, name: '科技数码综合', parentId: 1012, parentName: '科技数码' },
  { id: 1013, name: '运动' },
  { id: 2105, name: '综合运动', parentId: 1013, parentName: '运动' },
  { id: 2106, name: '球类运动', parentId: 1013, parentName: '运动' },
  { id: 2107, name: '健身', parentId: 1013, parentName: '运动' },
  { id: 2108, name: '竞技赛事', parentId: 1013, parentName: '运动' },
  { id: 1014, name: '汽车' },
  { id: 2109, name: '汽车综合', parentId: 1014, parentName: '汽车' },
  { id: 2110, name: '购车攻略', parentId: 1014, parentName: '汽车' },
  { id: 2111, name: '新能源车', parentId: 1014, parentName: '汽车' },
  { id: 2112, name: '摩托车', parentId: 1014, parentName: '汽车' },
  { id: 1015, name: '美食' },
  { id: 2113, name: '美食制作', parentId: 1015, parentName: '美食' },
  { id: 2114, name: '美食探店', parentId: 1015, parentName: '美食' },
  { id: 2115, name: '美食测评', parentId: 1015, parentName: '美食' },
  { id: 2116, name: '田园美食', parentId: 1015, parentName: '美食' },
  { id: 2117, name: '美食综合', parentId: 1015, parentName: '美食' },
  { id: 1016, name: '生活兴趣' },
  { id: 2118, name: '生活经验', parentId: 1016, parentName: '生活兴趣' },
  { id: 2119, name: '家居房产', parentId: 1016, parentName: '生活兴趣' },
  { id: 2120, name: '手工', parentId: 1016, parentName: '生活兴趣' },
  { id: 2121, name: '绘画', parentId: 1016, parentName: '生活兴趣' },
  { id: 2122, name: '出行', parentId: 1016, parentName: '生活兴趣' },
  { id: 2123, name: '三农', parentId: 1016, parentName: '生活兴趣' },
  { id: 2124, name: '亲子', parentId: 1016, parentName: '生活兴趣' },
  { id: 2125, name: '时尚美妆', parentId: 1016, parentName: '生活兴趣' },
  { id: 2126, name: '仿妆cos', parentId: 1016, parentName: '生活兴趣' },
  { id: 2127, name: '动物', parentId: 1016, parentName: '生活兴趣' },
  { id: 2128, name: '收藏', parentId: 1016, parentName: '生活兴趣' },
  { id: 1017, name: '娱乐综艺' },
  { id: 2129, name: '娱乐粉丝创作', parentId: 1017, parentName: '娱乐综艺' },
  { id: 2130, name: '综艺杂谈', parentId: 1017, parentName: '娱乐综艺' },
  { id: 2131, name: '综艺剪辑', parentId: 1017, parentName: '娱乐综艺' },
  { id: 1018, name: '影视' },
  { id: 2132, name: '影视动漫杂谈', parentId: 1018, parentName: '影视' },
  { id: 2133, name: '影视剪辑', parentId: 1018, parentName: '影视' },
  { id: 2134, name: '小剧场', parentId: 1018, parentName: '影视' },
  { id: 2135, name: '短片', parentId: 1018, parentName: '影视' },
  { id: 1019, name: '音乐' },
  { id: 2136, name: '音乐演唱', parentId: 1019, parentName: '音乐' },
  { id: 2137, name: '音乐演奏', parentId: 1019, parentName: '音乐' },
  { id: 2138, name: '音乐综合', parentId: 1019, parentName: '音乐' },
  { id: 2139, name: '乐评盘点', parentId: 1019, parentName: '音乐' },
  { id: 1020, name: '舞蹈' },
  { id: 2140, name: '舞蹈表演', parentId: 1020, parentName: '舞蹈' },
  { id: 2141, name: '舞蹈教程', parentId: 1020, parentName: '舞蹈' },
  { id: 2142, name: '舞蹈综合', parentId: 1020, parentName: '舞蹈' },
  { id: 1021, name: '鬼畜' },
  { id: 2143, name: '鬼畜调教', parentId: 1021, parentName: '鬼畜' },
  { id: 2144, name: '音MAD', parentId: 1021, parentName: '鬼畜' },
  { id: 2145, name: '鬼畜剧场', parentId: 1021, parentName: '鬼畜' },
];

const BROAD_TAGS = new Set([
  'AI', '人工智能', '科技', '数码', '知识', '课程', '教程', '学习', '视频', '综合',
  '计算机', '软件', '互联网', '办公', '经验', '生活', '游戏', '影视', '音乐',
]);

const MUSIC_LIVE_TERMS = [
  '演唱会', '音乐现场', '巡演', '饭拍', 'live', 'concert', '现场版', '现场演唱', '舞台现场',
];

const MUSIC_MV_TERMS = ['mv', 'musicvideo', '音乐录影带'];

const MUSIC_PERFORMANCE_TERMS = ['演奏', '翻弹', '钢琴', '吉他', '贝斯', '鼓手', '乐器'];

const MUSIC_GENERAL_TERMS = [
  '音乐', '歌曲', '歌手', '唱歌', '翻唱', '专辑', '单曲', '音频', '音质修复', '无损',
  '高音质', 'remix', 'cover', '伴奏', '歌词', '作曲', '作词',
];

const ANIMATION_STRONG_TERMS = [
  'mmd', '模型配布', '动作配布', '镜头配布', '渲染', 'miku', '初音', '洛天依',
  'vocaloid', 'utau', '手书', 'amv', 'mad', '动画短片',
];

const PREFERRED_TAG_TAILS: Array<[string, string]> = [
  ['AI编程', '编程'],
  ['编程', '编程'],
  ['代码', '编程'],
  ['程序员', '编程'],
  ['软件开发', '编程'],
  ['Codex', 'Codex'],
  ['ChatGPT', 'ChatGPT'],
  ['Claude Code', 'Claude Code'],
  ['Cursor', 'Cursor'],
  ['MCP', 'MCP'],
  ['知识库', '知识库'],
  ['NotebookLM', '知识库'],
  ['插件', '插件'],
  ['字幕插件', '字幕插件'],
  ['操作系统', '操作系统'],
  ['GitHub', 'GitHub'],
  ['Git', 'Git'],
  ['二战', '二战'],
  ['第二次世界大战', '二战'],
  ['WW2', '二战'],
];

const OLD_BY_ID = buildRegionIdMap(OLD_REGIONS);
const V2_BY_ID = buildRegionIdMap(V2_REGIONS);
const OLD_BY_NAME = buildRegionNameMap(OLD_REGIONS);
const V2_BY_NAME = buildRegionNameMap(V2_REGIONS);
const RELATED_TERMS = buildRelatedTerms();

export function resolveBiliRegion(input: BiliRegionInput): ResolvedBiliRegion {
  const v2 = findRegion(V2_BY_ID, V2_BY_NAME, input.tidV2, input.tnameV2);
  const old = findRegion(OLD_BY_ID, OLD_BY_NAME, input.tid, input.tname);
  const pidV2 = input.pidV2 || v2?.parentId;
  const pidNameV2 = input.pidNameV2 || v2?.parentName;
  const tnameV2 = input.tnameV2 || v2?.name;
  const tname = input.tname || old?.name;
  const v2Path = buildPath(pidNameV2, tnameV2);
  const legacyPath = buildPath(old?.parentName, tname);

  return {
    tid: input.tid || old?.id,
    tname,
    tidV2: input.tidV2 || v2?.id,
    tnameV2,
    pidV2,
    pidNameV2,
    legacyPath,
    v2Path,
    preferredPath: v2Path.length > 0 ? v2Path : legacyPath,
  };
}

export function normalizeFavoritePath(ai: unknown, item: FavoriteItem): string[] {
  const basePath = resolveFavoriteBasePath(item).path;
  const tail = [
    ...extractPreferredTagTails(item.tags),
    ...extractAiTail(ai),
    ...extractGeneralTagTails(item.tags),
  ];
  return appendTail(basePath, tail);
}

export function resolveFavoriteBasePath(item: FavoriteItem): FavoriteBasePath {
  const region = resolveBiliRegion(item);
  const musicOverride = resolveMusicOverridePath(item, region);
  if (musicOverride.length > 0) return { path: musicOverride, source: 'tag_override' };
  if (region.v2Path.length > 0) return { path: region.v2Path, source: 'bili_v2' };
  if (region.legacyPath.length > 0) return { path: region.legacyPath, source: 'bili_legacy' };

  const fallback = fallbackBasePath(item);
  return {
    path: fallback,
    source: isPathSame(fallback, UNCATEGORIZED_PATH) ? 'uncategorized' : 'folder',
  };
}

export function expandFavoriteSearchTerms(terms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of terms.map(term => term.trim()).filter(Boolean)) {
    expanded.add(term);
    const key = normalizeForTaxonomy(term);
    for (const related of RELATED_TERMS.get(key) ?? []) {
      expanded.add(related);
    }
  }
  return Array.from(expanded).slice(0, 48);
}

export function buildTaxonomyPromptSummary(): string {
  return [
    '分类根路径由本地 B站分区 ID 决定，AI 不要重写一级/二级类目。',
    'v2 示例：人工智能 / AI学习；科技数码 / 电脑；知识 / 校园学习；游戏 / 单机主机类游戏。',
    '旧分区 fallback 示例：科技 / 计算机技术；科技 / 软件应用；知识 / 人文历史；游戏 / 单机游戏。',
    'AI 只输出 topicTail 作为可选末级主题，例如 ["编程","Codex"] 或 ["二战"]。',
  ].join('\n');
}

function buildRegionIdMap(regions: BiliRegion[]): Map<number, BiliRegion> {
  return new Map(regions.map(region => [region.id, region]));
}

function buildRegionNameMap(regions: BiliRegion[]): Map<string, BiliRegion> {
  const map = new Map<string, BiliRegion>();
  for (const region of regions) {
    for (const name of [region.name, ...(region.aliases ?? [])]) {
      if (name) map.set(normalizeForTaxonomy(name), region);
    }
  }
  return map;
}

function findRegion(
  byId: Map<number, BiliRegion>,
  byName: Map<string, BiliRegion>,
  id?: number,
  name?: string,
): BiliRegion | undefined {
  if (id && byId.has(id)) return byId.get(id);
  if (name?.trim()) return byName.get(normalizeForTaxonomy(name));
  return undefined;
}

function buildPath(parentName?: string, name?: string): string[] {
  return [parentName, name]
    .map(part => part?.trim() ?? '')
    .filter(Boolean)
    .filter((part, index, list) => list.findIndex(value => normalizeForTaxonomy(value) === normalizeForTaxonomy(part)) === index)
    .slice(0, 4);
}

function fallbackBasePath(item: FavoriteItem): string[] {
  if (item.tname?.trim()) return [item.tname.trim()];
  if (item.tagName?.trim()) return [item.tagName.trim()];
  if (!isGenericFolderTitle(item.folderTitle)) return [item.folderTitle.trim(), '未分类'].filter(Boolean);
  return UNCATEGORIZED_PATH;
}

function resolveMusicOverridePath(item: FavoriteItem, region: ResolvedBiliRegion): string[] {
  if (isMusicPath(region.preferredPath)) return [];
  if (!isAnimationLikePath(region.preferredPath)) return [];

  const text = normalizeForTaxonomy([
    item.title,
    item.intro,
    item.authorName,
    item.folderTitle,
    item.tagName,
    item.tname ?? '',
    item.tnameV2 ?? '',
    ...(item.tags ?? []),
  ].join(' '));
  if (!text) return [];

  const liveScore = countTermHits(text, MUSIC_LIVE_TERMS);
  const mvScore = countTermHits(text, MUSIC_MV_TERMS);
  const performanceScore = countTermHits(text, MUSIC_PERFORMANCE_TERMS);
  const generalScore = countTermHits(text, MUSIC_GENERAL_TERMS);
  const animationScore = countTermHits(text, ANIMATION_STRONG_TERMS);
  const musicScore = liveScore * 3 + mvScore * 2 + performanceScore * 2 + generalScore;

  if (musicScore < 2) return [];
  if (animationScore > 0 && liveScore === 0 && mvScore === 0 && performanceScore === 0) return [];

  if (liveScore > 0) return ['音乐', '音乐现场'];
  if (mvScore > 0) return ['音乐', 'MV'];
  if (performanceScore > 0) return ['音乐', '音乐演奏'];
  return ['音乐', '音乐综合'];
}

function isAnimationLikePath(path: string[]): boolean {
  const normalized = path.map(normalizeForTaxonomy);
  return normalized.includes(normalizeForTaxonomy('动画'))
    || normalized.includes(normalizeForTaxonomy('MMD·3D'))
    || normalized.includes(normalizeForTaxonomy('二次元'))
    || normalized.includes(normalizeForTaxonomy('鬼畜'));
}

function isMusicPath(path: string[]): boolean {
  return path.some(part => normalizeForTaxonomy(part) === normalizeForTaxonomy('音乐'));
}

function countTermHits(text: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    if (text.includes(normalizeForTaxonomy(term))) score++;
  }
  return score;
}

function isPathSame(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((part, index) => normalizeForTaxonomy(part) === normalizeForTaxonomy(right[index]));
}

function appendTail(basePath: string[], tails: string[]): string[] {
  const path = basePath.length > 0 ? [...basePath] : [...UNCATEGORIZED_PATH];
  for (const tail of tails) {
    const normalizedTail = normalizeForTaxonomy(tail);
    if (!normalizedTail) continue;
    if (path.some(part => normalizeForTaxonomy(part) === normalizedTail)) continue;
    path.push(tail.trim());
    if (path.length >= 4) break;
  }
  return path.slice(0, 4);
}

function extractPreferredTagTails(tags: string[]): string[] {
  const result: string[] = [];
  for (const [alias, normalized] of PREFERRED_TAG_TAILS) {
    if (tags.some(tag => normalizeForTaxonomy(tag) === normalizeForTaxonomy(alias))) {
      result.push(normalized);
    }
  }
  return uniqueNonEmpty(result);
}

function extractGeneralTagTails(tags: string[]): string[] {
  return uniqueNonEmpty(tags)
    .filter(tag => !BROAD_TAGS.has(tag))
    .filter(tag => !PREFERRED_TAG_TAILS.some(([alias]) => normalizeForTaxonomy(alias) === normalizeForTaxonomy(tag)))
    .filter(tag => normalizeForTaxonomy(tag).length >= 2)
    .slice(0, 4);
}

function extractAiTail(ai: unknown): string[] {
  if (!ai || typeof ai !== 'object') return normalizeTextArray(ai).slice(-2);
  const response = ai as AiTailLike;
  const topicTail = normalizeTextArray(response.topicTail);
  if (topicTail.length > 0) return topicTail.slice(0, 2);
  const path = normalizeTextArray(response.path);
  return path.slice(-2);
}

function buildRelatedTerms(): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const region of [...OLD_REGIONS, ...V2_REGIONS]) {
    const related = [region.name, region.parentName, ...(region.aliases ?? [])].filter((value): value is string => Boolean(value));
    for (const term of related) {
      const key = normalizeForTaxonomy(term);
      const bucket = map.get(key) ?? new Set<string>();
      related.forEach(value => bucket.add(value));
      map.set(key, bucket);
    }
  }
  for (const [alias, normalized] of PREFERRED_TAG_TAILS) {
    const related = [alias, normalized];
    for (const term of related) {
      const key = normalizeForTaxonomy(term);
      const bucket = map.get(key) ?? new Set<string>();
      related.forEach(value => bucket.add(value));
      map.set(key, bucket);
    }
  }
  return new Map(Array.from(map.entries()).map(([key, value]) => [key, Array.from(value)]));
}

function isGenericFolderTitle(value: string): boolean {
  const normalized = normalizeForTaxonomy(value);
  return !normalized || normalized === normalizeForTaxonomy('默认收藏夹') || normalized === normalizeForTaxonomy('收藏夹');
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmpty(value.map(item => typeof item === 'string' ? item.trim() : ''));
}

function uniqueNonEmpty(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items.map(value => value.trim()).filter(Boolean)) {
    const key = normalizeForTaxonomy(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeForTaxonomy(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
