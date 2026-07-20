import type { DynamicBillGenerateResult } from '../../shared/types/dynamic-bill';
import { ensureDynamicBill013Migration } from './migration';
import { runDynamicBillDataOperation } from './operation-control';
import { generateFixedDynamicBillItems } from './rules';

export function generateDynamicBillItems(): Promise<DynamicBillGenerateResult> {
  return runDynamicBillDataOperation(generateDynamicBillItemsExclusive);
}

async function generateDynamicBillItemsExclusive(): Promise<DynamicBillGenerateResult> {
  await ensureDynamicBill013Migration();
  return generateFixedDynamicBillItems();
}
