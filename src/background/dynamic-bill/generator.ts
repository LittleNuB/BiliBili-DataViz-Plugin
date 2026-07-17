import type { DynamicBillGenerateResult } from '../../shared/types/dynamic-bill';
import { generateFixedDynamicBillItems } from './rules';

export async function generateDynamicBillItems(): Promise<DynamicBillGenerateResult> {
  return generateFixedDynamicBillItems();
}
