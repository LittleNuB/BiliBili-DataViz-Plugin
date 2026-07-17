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
      `这个 UP 已被本地“少提醒”暂停到 ${new Date(pause.expiresAt).toLocaleString('zh-CN')}，暂停期内不进入动态账单三栏。`,
    ],
  };
}
