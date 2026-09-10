export type TransferCandidate = { id: string; accountId: string; currency: string; amountCents: number; dateSec: number; pending: boolean };
export type TransferPair = { outflowId: string; inflowId: string };

export const TRANSFER_WINDOW_DAYS = 3;

/**
 * Money that leaves one of the owner's accounts and arrives in another, same currency, same
 * amount, within a few days, is a transfer. Greedy: outflows in date order each take the
 * nearest free inflow; ties on distance go to the smaller id so the result is deterministic.
 */
export function pairTransfers(rows: TransferCandidate[], maxDays = TRANSFER_WINDOW_DAYS): TransferPair[] {
  const maxSec = maxDays * 86400;
  const groups = new Map<string, { outs: TransferCandidate[]; ins: TransferCandidate[] }>();
  for (const r of rows) {
    if (r.pending || r.amountCents === 0) continue;
    const key = `${r.currency}|${Math.abs(r.amountCents)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { outs: [], ins: [] }));
    (r.amountCents < 0 ? g.outs : g.ins).push(r);
  }
  const byDateThenId = (a: TransferCandidate, b: TransferCandidate) => a.dateSec - b.dateSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const pairs: TransferPair[] = [];
  for (const g of groups.values()) {
    if (g.outs.length === 0 || g.ins.length === 0) continue;
    g.outs.sort(byDateThenId);
    const taken = new Set<string>();
    for (const out of g.outs) {
      let best: TransferCandidate | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const inn of g.ins) {
        if (taken.has(inn.id) || inn.accountId === out.accountId) continue;
        const dist = Math.abs(inn.dateSec - out.dateSec);
        if (dist > maxSec) continue;
        if (dist < bestDist || (dist === bestDist && best && inn.id < best.id)) {
          best = inn;
          bestDist = dist;
        }
      }
      if (best) {
        taken.add(best.id);
        pairs.push({ outflowId: out.id, inflowId: best.id });
      }
    }
  }
  return pairs;
}
