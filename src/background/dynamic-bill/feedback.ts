import type { DynamicBillFeedbackProfile } from '../storage/dynamic-bill-repo';
import { DYNAMIC_BILL_STRATEGY } from './strategy';

export interface DynamicBillFeedbackEvaluation {
  blocked: boolean;
  scoreMultiplier: number;
  creatorFeedbackCount: number;
  topicFeedbackCount: number;
  facts: string[];
}

export function evaluateDynamicBillFeedback(
  profile: DynamicBillFeedbackProfile,
  target: {
    creatorMid: number;
    topicKey?: string;
    topicLabel?: string;
  },
): DynamicBillFeedbackEvaluation {
  const creatorFeedbackCount = profile.creatorCountsByMid.get(target.creatorMid) ?? 0;
  const topicFeedbackCount = target.topicKey
    ? profile.topicCountsByKey.get(target.topicKey) ?? 0
    : 0;
  const creatorBlocked = creatorFeedbackCount >= DYNAMIC_BILL_STRATEGY.feedbackCreatorBlockCount;
  const topicBlocked = topicFeedbackCount >= DYNAMIC_BILL_STRATEGY.feedbackTopicBlockCount;
  const isDampened = creatorFeedbackCount >= DYNAMIC_BILL_STRATEGY.feedbackDampenCount
    || topicFeedbackCount >= DYNAMIC_BILL_STRATEGY.feedbackDampenCount;
  const facts: string[] = [];

  if (creatorFeedbackCount > 0) {
    facts.push(
      `本地少提醒记录：这个 UP 已累计 ${creatorFeedbackCount} 次；未达屏蔽阈值时本次生成会降低排序权重。`,
    );
  }
  if (topicFeedbackCount > 0) {
    facts.push(
      `本地少提醒记录：${target.topicLabel ?? '这个主题'}已累计 ${topicFeedbackCount} 次；未达屏蔽阈值时本次生成会降低排序权重。`,
    );
  }

  return {
    blocked: creatorBlocked || topicBlocked,
    scoreMultiplier: isDampened ? DYNAMIC_BILL_STRATEGY.feedbackScoreMultiplier : 1,
    creatorFeedbackCount,
    topicFeedbackCount,
    facts,
  };
}

export function applyDynamicBillFeedbackScore(
  score: number,
  feedback: DynamicBillFeedbackEvaluation,
): number {
  return Math.round(score * feedback.scoreMultiplier * 100) / 100;
}
