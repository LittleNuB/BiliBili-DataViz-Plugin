let dynamicBillDataOperationTail: Promise<void> = Promise.resolve();

export function runDynamicBillDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = dynamicBillDataOperationTail.then(operation, operation);
  dynamicBillDataOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
