import type { WatchHistoryRecord } from '../../shared/types/watch-event';
import type { WeeklyTip, BlindBoxItem } from '../../shared/types/analytics';
import { getRecordsByDateRange } from '../storage/watch-history-repo';
import { dateKey, daysAgo } from '../../shared/utils/time';
import { computeCategoryDistribution, computeTopTags } from './category';
import { computeCreatorRanking, detectDeepBond } from './creator';
import { computeCompletionDistribution } from './behavior';

const ALL_BILIBILI_CATEGORIES = [
  '动画', '番剧', '国创', '音乐', '舞蹈', '游戏', '知识', '科技',
  '运动', '汽车', '生活', '美食', '动物圈', '鬼畜', '时尚', '娱乐',
  '影视', '纪录片', '电影', '电视剧', '综艺',
];

export async function generateWeeklyTips(records: WatchHistoryRecord[]): Promise<WeeklyTip[]> {
  const tips: WeeklyTip[] = [];

  if (records.length === 0) return tips;

  const completionDist = computeCompletionDistribution(records);
  const lowCompletion = completionDist[0]; // 25%以下桶
  if (lowCompletion && lowCompletion.count > 0) {
    const lowRate = lowCompletion.count / records.length;
    if (lowRate > 0.4) {
      tips.push({
        category: 'completion',
        title: '高跳出率检测',
        description: `你最近有 ${Math.round(lowRate * 100)}% 的视频看了不到25%就放弃了，试试关掉自动播放，主动选择想看的视频？`,
      });
    }
  }

  const categoryDist = computeCategoryDistribution(records);
  if (categoryDist.length > 0 && categoryDist[0].percentage > 0.5) {
    tips.push({
      category: 'diversity',
      title: '内容消费集中',
      description: `你的观看时间有 ${Math.round(categoryDist[0].percentage * 100)}% 集中在「${categoryDist[0].name}」区，试试探索新分区？`,
    });
  }

  const ranking = computeCreatorRanking(records);
  const topCreator = ranking.find(c => c.videoCount >= 5);
  if (topCreator) {
    tips.push({
      category: 'creator',
      title: '发现宝藏UP主',
      description: `你已经追了「${topCreator.name}」的 ${topCreator.videoCount} 个视频但还没关注Ta（如果确实没关注的话）。`,
    });
  }

  const deepBond = detectDeepBond(records);
  if (deepBond.length > 0) {
    tips.push({
      category: 'creator',
      title: '深度绑定提醒',
      description: `你和「${deepBond[0].name}」形成了深度绑定（完播率高于80%），这是你的"本命UP主"！`,
    });
  }

  // At least one general tip
  if (tips.length === 0) {
    tips.push({
      category: 'habit',
      title: '数据积累中',
      description: '多看几个视频，系统就能为你生成个性化的观看建议了。',
    });
  }

  return tips.slice(0, 3);
}

export async function generateBlindBox(records: WatchHistoryRecord[]): Promise<BlindBoxItem[]> {
  const items: BlindBoxItem[] = [];

  if (records.length === 0) return items;

  const knownCategories = new Set(records.map(r => r.tagName).filter(Boolean));
  const unknownCategories = ALL_BILIBILI_CATEGORIES.filter(c => !knownCategories.has(c));

  // Suggest an unexplored category
  if (unknownCategories.length > 0) {
    const pick = unknownCategories[Math.floor(Math.random() * unknownCategories.length)];
    items.push({
      name: pick,
      reason: `你从未看过「${pick}」区的内容，也许会有惊喜？`,
      type: 'category',
    });
  }

  // Suggest a tag-based creator blindbox
  const topTags = computeTopTags(records, 5);
  if (topTags.length > 0) {
    const tag = topTags[Math.floor(Math.random() * topTags.length)].name;
    items.push({
      name: `关于「${tag}」的新内容`,
      reason: `你对「${tag}」很感兴趣，试试搜索这个标签发现新UP主？`,
      type: 'creator',
    });
  }

  // Suggest a random category
  const allCategories = ALL_BILIBILI_CATEGORIES;
  const randomCat = allCategories[Math.floor(Math.random() * allCategories.length)];
  items.push({
    name: `随机探索「${randomCat}」`,
    reason: '放下算法推荐的惯性，去一个你平时不太逛的分区看看吧。',
    type: 'video',
  });

  return items;
}

export async function getExperimentData(): Promise<{
  tips: WeeklyTip[];
  blindBox: BlindBoxItem[];
}> {
  const now = new Date();
  const sevenDaysAgo = daysAgo(7);
  const records = await getRecordsByDateRange(dateKey(sevenDaysAgo), dateKey(now));

  return {
    tips: await generateWeeklyTips(records),
    blindBox: await generateBlindBox(records),
  };
}
