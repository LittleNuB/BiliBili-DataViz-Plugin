import type { DynamicBillGenerateResult } from '../../shared/types/dynamic-bill';
import { ensureDynamicBill013Migration } from './migration';
import { generateFixedDynamicBillItems } from './rules';

export async function generateDynamicBillItems(): Promise<DynamicBillGenerateResult> {
  await ensureDynamicBill013Migration();
  return generateFixedDynamicBillItems();
}
