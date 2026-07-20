export const UNAVAILABLE_DYNAMIC_BILL_CREATOR_NAME = '名称暂不可用的 UP 主';

export function dynamicBillCreatorDisplayName(input: {
  creatorMid: number;
  creatorName?: unknown;
}): string {
  const name = typeof input.creatorName === 'string'
    ? input.creatorName.trim().replace(/\s+/g, ' ')
    : '';
  const rawMid = String(input.creatorMid);
  if (!name || name === rawMid || name.toLocaleLowerCase() === `up ${rawMid}`) {
    return UNAVAILABLE_DYNAMIC_BILL_CREATOR_NAME;
  }
  return name;
}
