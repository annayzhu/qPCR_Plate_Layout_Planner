export const MAX_QUICK_ENTRY_COUNT = 999;

export function parseQuickEntryCount(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const count = Number(normalized);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_QUICK_ENTRY_COUNT
  ) {
    return null;
  }

  return count;
}

export function generateNumberedEntries(prefix: string, count: number) {
  if (
    !prefix ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_QUICK_ENTRY_COUNT
  ) {
    return [];
  }

  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}
