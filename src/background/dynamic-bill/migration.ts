import { db } from '../storage/db.ts';
import { deriveLegacyCreatorPauses } from './migration-plan.ts';
import {
  DYNAMIC_BILL_MIGRATION_VERSION,
  DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE,
} from './strategy.ts';

let pendingMigration: Promise<void> | null = null;

export async function ensureDynamicBill013Migration(): Promise<void> {
  if (pendingMigration) return pendingMigration;

  pendingMigration = runDynamicBill013Migration()
    .catch((error) => {
      if (
        error instanceof Error
        && error.message === DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE
      ) {
        throw error;
      }
      throw new Error(DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE);
    })
    .finally(() => {
      pendingMigration = null;
    });

  return pendingMigration;
}

async function runDynamicBill013Migration(): Promise<void> {
  const existing = await db.dynamicBillMigrations
    .where('version')
    .equals(DYNAMIC_BILL_MIGRATION_VERSION)
    .first();
  if (existing) return;

  const now = Date.now();
  try {
    await db.transaction(
      'rw',
      [
        db.dynamicBillItems,
        db.dynamicBillExplanations,
        db.dynamicBillFeedback,
        db.dynamicBillCreatorPauses,
        db.dynamicBillRotationRecords,
        db.dynamicBillMigrations,
      ],
      async () => {
        const txExisting = await db.dynamicBillMigrations
          .where('version')
          .equals(DYNAMIC_BILL_MIGRATION_VERSION)
          .first();
        if (txExisting) return;

        const legacyFeedback = await db.dynamicBillFeedback.toArray();
        const migratedPauses = deriveLegacyCreatorPauses(legacyFeedback, now);
        const existingPauses = await db.dynamicBillCreatorPauses.toArray();
        const existingPauseIds = new Map(
          existingPauses.map((pause) => [pause.creatorMid, pause.id]),
        );

        await db.dynamicBillItems.clear();
        await db.dynamicBillExplanations.clear();
        await db.dynamicBillFeedback.clear();
        await db.dynamicBillRotationRecords.clear();

        if (migratedPauses.length > 0) {
          await db.dynamicBillCreatorPauses.bulkPut(
            migratedPauses.map((pause) => ({
              ...pause,
              id: existingPauseIds.get(pause.creatorMid),
            })),
          );
        }

        await db.dynamicBillMigrations.put({
          version: DYNAMIC_BILL_MIGRATION_VERSION,
          completedAt: now,
        });
      },
    );
  } catch {
    throw new Error(DYNAMIC_BILL_UPGRADE_FAILED_MESSAGE);
  }
}
