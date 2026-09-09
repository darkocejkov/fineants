export function unixToDate(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

export function isoToLocal(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

export function relativeFromNow(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "never";
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
