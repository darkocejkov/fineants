/** Budget progress as a 3px rule: paper track, ink for the spent fraction, oxblood for spend past the cap. */
export function FillRule({ spentCents, capCents }: { spentCents: number; capCents: number }) {
  if (capCents <= 0) return null;
  const within = Math.min(spentCents, capCents) / capCents;
  // Over-cap spend is drawn from the right edge back toward the cap tick, which is the boundary
  // between the two. Clamped at half the track: at twice the cap the unclamped fraction would be
  // 1, pushing the tick off the left edge and leaving a bar with no cap reading at all. Half keeps
  // the tick on the rule, so "how far past the cap" stays legible however far past it goes.
  const over = spentCents > capCents ? Math.min((spentCents - capCents) / capCents, 0.5) : 0;
  const pct = Math.round((spentCents / capCents) * 100);
  return (
    <div className="fill-rule" role="img" aria-label={spentCents > capCents ? `${pct}% of cap, over cap` : `${pct}% of cap`}>
      <span className="fill-rule-bar" style={{ width: `${(within * (1 - over)) * 100}%` }} />
      {over > 0 ? <span className="fill-rule-over" style={{ width: `${over * 100}%` }} /> : null}
    </div>
  );
}
