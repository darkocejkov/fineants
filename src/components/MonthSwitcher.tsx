import Link from "next/link";
import { addMonths } from "@/lib/time";

function label(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function MonthSwitcher({ current, earliest, latest, basePath }: { current: string; earliest: string; latest: string; basePath: string }) {
  const prev = addMonths(`${current}-01`, -1).slice(0, 7);
  const next = addMonths(`${current}-01`, 1).slice(0, 7);
  const canPrev = prev >= earliest;
  const canNext = next <= latest;
  return (
    <nav className="month-switcher" aria-label="Month">
      <Link className="button" href={canPrev ? `${basePath}?month=${prev}` : "#"} aria-disabled={!canPrev}>
        Previous month
      </Link>
      <span>{label(current)}</span>
      <Link className="button" href={canNext ? `${basePath}?month=${next}` : "#"} aria-disabled={!canNext}>
        Next month
      </Link>
    </nav>
  );
}
