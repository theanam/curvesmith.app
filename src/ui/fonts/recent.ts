/* Recently picked font families, newest first (per browser, best effort). */
const KEY = 'curvesmith.recentFonts';
const MAX = 6;

export function readRecentFonts(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentFont(family: string): string[] {
  const next = [family, ...readRecentFonts().filter((f) => f !== family)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  return next;
}
