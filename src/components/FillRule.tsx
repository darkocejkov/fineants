/** Budget progress as a 3px rule: paper track, ink for the spent fraction, oxblood for spend past the cap. */
export function FillRule({ spentCents, capCents }: { spentCents: number; capCents: number }) {
  if (capCents <= 0) return null;
  const within = Math.min(spentCents, capCents) / capCents;
  const over = spentCents > capCents ? Math.min((spentCents - capCents) / capCents, 1) : 0;
  // Over-cap spend is drawn from the right edge back toward the cap tick, capped at the full width.
  return (
    <div className="fill-rule" role="img" aria-label={`${Math.round((spentCents / capCents) * 100)}% of cap`}>
      <span className="fill-rule-bar" style={{ width: `${(within * (1 - over)) * 100}%` }} />
      {over > 0 ? <span className="fill-rule-over" style={{ width: `${over * 100}%` }} /> : null}
    </div>
  );
}
