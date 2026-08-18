export function restorePreflightAllows(
  availableFreeQuotaBytes,
  requiredFreeQuotaBytes,
) {
  return (
    Number.isSafeInteger(availableFreeQuotaBytes) &&
    availableFreeQuotaBytes >= 0 &&
    Number.isSafeInteger(requiredFreeQuotaBytes) &&
    requiredFreeQuotaBytes >= 0 &&
    availableFreeQuotaBytes >= requiredFreeQuotaBytes
  );
}
