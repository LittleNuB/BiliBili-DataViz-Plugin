let activeLocalSettingsWrites = 0;
let localSettingsClearDepth = 0;
const localSettingsWriteIdleWaiters = new Set<() => void>();

export function runLocalSettingsWriteOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (localSettingsClearDepth > 0) {
    return Promise.reject(new Error('LOCAL_SETTINGS_CLEAR_IN_PROGRESS'));
  }

  beginLocalSettingsWrite();
  return Promise.resolve()
    .then(operation)
    .finally(endLocalSettingsWrite);
}

export function tryRunLocalSettingsWriteOperation(
  operation: () => Promise<void>,
): Promise<boolean> {
  if (localSettingsClearDepth > 0) return Promise.resolve(false);

  beginLocalSettingsWrite();
  return Promise.resolve()
    .then(operation)
    .then(() => true)
    .finally(endLocalSettingsWrite);
}

export function runLocalSettingsClearDataOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  localSettingsClearDepth += 1;
  return Promise.resolve()
    .then(waitForLocalSettingsWrites)
    .then(operation)
    .finally(() => {
      localSettingsClearDepth = Math.max(0, localSettingsClearDepth - 1);
    });
}

function beginLocalSettingsWrite(): void {
  activeLocalSettingsWrites += 1;
}

function endLocalSettingsWrite(): void {
  activeLocalSettingsWrites = Math.max(0, activeLocalSettingsWrites - 1);
  if (activeLocalSettingsWrites !== 0) return;
  for (const resolve of localSettingsWriteIdleWaiters) resolve();
  localSettingsWriteIdleWaiters.clear();
}

function waitForLocalSettingsWrites(): Promise<void> {
  if (activeLocalSettingsWrites === 0) return Promise.resolve();
  return new Promise(resolve => localSettingsWriteIdleWaiters.add(resolve));
}
