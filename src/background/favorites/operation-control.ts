let favoriteDataOperationTail: Promise<void> = Promise.resolve();

export function runFavoriteDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = favoriteDataOperationTail.then(operation, operation);
  favoriteDataOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
