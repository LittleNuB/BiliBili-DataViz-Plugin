export interface StreakDetails {
  current: number;
  currentStartDate: string | null;
  currentEndDate: string | null;
  longest: number;
  longestStartDate: string | null;
  longestEndDate: string | null;
}

export function computeStreakFromDateSet(dates: Set<string>, todayKey = dateKey()): StreakDetails {
  if (dates.size === 0) {
    return {
      current: 0,
      currentStartDate: null,
      currentEndDate: null,
      longest: 0,
      longestStartDate: null,
      longestEndDate: null,
    };
  }

  const sorted = Array.from(dates).sort();
  const ranges: Array<{ startDate: string; endDate: string; days: number }> = [];
  let startDate = sorted[0];
  let endDate = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDateKey(sorted[i - 1]);
    const curr = parseDateKey(sorted[i]);
    if (daysBetween(prev, curr) === 1) {
      endDate = sorted[i];
      continue;
    }

    ranges.push({ startDate, endDate, days: countInclusiveDays(startDate, endDate) });
    startDate = sorted[i];
    endDate = sorted[i];
  }
  ranges.push({ startDate, endDate, days: countInclusiveDays(startDate, endDate) });

  const yesterdayKey = dateKey(offsetDays(parseDateKey(todayKey), -1));
  const currentAnchor = dates.has(todayKey) ? todayKey : dates.has(yesterdayKey) ? yesterdayKey : null;
  const currentRange = currentAnchor
    ? ranges.find(range => range.startDate <= currentAnchor && range.endDate >= currentAnchor)
    : null;
  const longestRange = ranges.reduce((best, range) => {
    if (!best || range.days > best.days) return range;
    if (range.days === best.days && range.endDate > best.endDate) return range;
    return best;
  }, null as { startDate: string; endDate: string; days: number } | null);

  return {
    current: currentRange?.days ?? 0,
    currentStartDate: currentRange?.startDate ?? null,
    currentEndDate: currentRange?.endDate ?? null,
    longest: longestRange?.days ?? 0,
    longestStartDate: longestRange?.startDate ?? null,
    longestEndDate: longestRange?.endDate ?? null,
  };
}

export function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function countInclusiveDays(startDate: string, endDate: string): number {
  return daysBetween(parseDateKey(startDate), parseDateKey(endDate)) + 1;
}

function daysBetween(a: Date, b: Date): number {
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bUtc - aUtc) / 86_400_000);
}

function offsetDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
