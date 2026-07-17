import type { DynamicBillFeedbackProfile } from '../storage/dynamic-bill-repo';

export interface DynamicBillFeedbackEvaluation {
  blocked: boolean;
  facts: string[];
}

export function evaluateDynamicBillFeedback(
  profile: DynamicBillFeedbackProfile,
  target: {
    creatorMid: number;
  },
): DynamicBillFeedbackEvaluation {
  const pause = profile.pausesByCreatorMid.get(target.creatorMid);
  if (!pause) {
    return {
      blocked: false,
      facts: [],
    };
  }

  return {
    blocked: true,
    facts: [
      `这个 UP 当前不进入动态账单候选，${new Date(pause.expiresAt).toLocaleString('zh-CN')} 后会按普通本地规则参与。`,
    ],
  };
}
