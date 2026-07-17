import { DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE } from "../../../src/shared/dynamic-bill-errors.ts";
import type { DynamicBillExplanation } from "../../../src/shared/types/dynamic-bill.ts";

export const DYNAMIC_BILL_FAILURE_SURFACES = [
  "readConfig",
  "readFilter",
  "readOverview",
  "readItems",
  "saveFilter",
  "openVideo",
  "markProcessed",
  "generateBill",
  "buildExplanations",
  "syncRequest",
  "syncState",
  "syncResult",
  "explanation",
] as const;

export type DynamicBillFailureSurface = typeof DYNAMIC_BILL_FAILURE_SURFACES[number];

const FAILURE_COPY: Record<DynamicBillFailureSurface, string> = {
  readConfig: "读取 AI 配置失败，请稍后重试。",
  readFilter: "读取筛选偏好失败，请稍后重试。",
  readOverview: "读取动态账单状态失败，请稍后重试。",
  readItems: "读取动态账单失败，请稍后重试。",
  saveFilter: "保存筛选偏好失败，请稍后重试。",
  openVideo: "打开新视频失败，请稍后重试。",
  markProcessed: "标记已处理失败，请稍后重试。",
  generateBill: "生成本地账单失败，请稍后重试。",
  buildExplanations: "生成 AI 解释失败，页面仍展示本地证据说明。",
  syncRequest: "动态同步请求失败，请稍后重试。",
  syncState: "动态同步失败，请稍后重试。已保留本地已有动态数据和账单项。",
  syncResult: "同步失败，请稍后重试。已保留本地已有动态数据。",
  explanation: "AI 解释生成失败；以下使用本地规则事实解释。",
};

export function dynamicBillFailureCopy(
  surface: DynamicBillFailureSurface,
  error: unknown,
): string {
  if (errorMessage(error) === DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE) {
    return DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE;
  }
  return FAILURE_COPY[surface];
}

export function explanationStateCopy(
  explanation: DynamicBillExplanation | undefined,
  aiAvailability: {
    enabled: boolean;
    configured: boolean;
    model: string;
  },
): string {
  if (explanation?.status === "generated") {
    return `由 ${explanation.model || aiAvailability.model || "AI"} 生成；只用于展示解释，不参与入选、归属、轮换或状态。`;
  }
  if (explanation?.status === "failed") {
    return dynamicBillFailureCopy("explanation", explanation.error);
  }
  if (explanation?.status === "not_configured" || (aiAvailability.enabled && !aiAvailability.configured)) {
    return "AI 尚未在设置中配置 API Key；以下使用本地规则事实解释。";
  }
  if (explanation?.status === "disabled" || !aiAvailability.enabled) {
    return "AI 解释未在设置中启用；以下使用本地规则事实解释。";
  }
  return "尚未生成 AI 解释；以下使用本地规则事实解释。";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return typeof error === "string" ? error.trim() : "";
}
