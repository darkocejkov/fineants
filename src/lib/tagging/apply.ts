import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, transactionMeta, transactions, type TransactionMetaRow } from "../db/schema";
import { getState, setState, STATE_KEYS } from "../db/appState";
import { listRecurringCosts } from "../queries/recurring";
import { listRules } from "../queries/rules";
import { effectiveDate } from "../queries/transactions";
import { matchRecurring } from "./recurringMatch";
import { compileRules, firstMatches, type CompiledRule } from "./rules";
import { pairTransfers } from "./transfers";

export type TaggingReport = {
  categorised: number;
  categoryCleared: number;
  transfersPaired: number;
  transfersCleared: number;
  recurringMatched: number;
  invalidRules: { id: number; error: string }[];
  durationMs: number;
  at: string;
};

type Loaded = {
  id: string;
  accountId: string;
  currency: string;
  hidden: boolean;
  amountCents: number;
  payee: string | null;
  description: string;
  pending: boolean;
  dateSec: number;
  localDate: string | null;
  meta: TransactionMetaRow | null;
};

function loadAll(db: Pick<Db, "select">, ids?: string[]): Loaded[] {
  const q = db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      currency: accounts.currency,
      hidden: accounts.hidden,
      amountCents: transactions.amountCents,
      payee: transactions.payee,
      description: transactions.description,
      pending: transactions.pending,
      dateSec: effectiveDate,
      localDate: transactions.localDate,
      meta: transactionMeta,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id));
  const rows = ids ? q.where(inArray(transactions.id, ids)).all() : q.all();
  return rows.map((r) => ({ ...r, meta: r.meta ?? null }));
}

type Desired = Pick<TransactionMetaRow, "categoryId" | "categorySource" | "ruleId" | "isTransfer" | "transferSource" | "counterpartTransactionId" | "recurringCostId" | "recurringSource" | "note">;

function fromMeta(m: TransactionMetaRow | null): Desired {
  return {
    categoryId: m?.categoryId ?? null,
    categorySource: m?.categorySource ?? null,
    ruleId: m?.ruleId ?? null,
    isTransfer: m?.isTransfer ?? false,
    transferSource: m?.transferSource ?? null,
    counterpartTransactionId: m?.counterpartTransactionId ?? null,
    recurringCostId: m?.recurringCostId ?? null,
    recurringSource: m?.recurringSource ?? null,
    note: m?.note ?? null,
  };
}

function isEmpty(d: Desired): boolean {
  return d.categoryId === null && d.categorySource === null && !d.isTransfer && d.transferSource === null && d.recurringCostId === null && d.recurringSource === null && (d.note === null || d.note === "");
}

function same(a: Desired, b: Desired): boolean {
  return (Object.keys(a) as (keyof Desired)[]).every((k) => a[k] === b[k]);
}

/** Step 6.1 for one row: returns the new desired state and whether the category changed. */
function applyRules(compiled: CompiledRule[], row: Loaded, d: Desired): { set: boolean; cleared: boolean } {
  let set = false;
  let cleared = false;
  const m = firstMatches(compiled, row);
  if (d.categorySource !== "manual") {
    const next = m.category ? m.category.categoryId : null;
    const nextRule = m.category ? m.category.id : null;
    if (next !== d.categoryId || nextRule !== d.ruleId) {
      if (next === null && d.categoryId !== null) cleared = true;
      if (next !== null && next !== d.categoryId) set = true;
      d.categoryId = next;
      d.ruleId = nextRule;
      d.categorySource = next === null ? null : "rule";
    }
  }
  if (d.transferSource !== "manual") {
    if (m.transfer) {
      d.isTransfer = true;
      d.transferSource = "rule";
      d.counterpartTransactionId = null;
    } else if (d.transferSource === "rule") {
      d.isTransfer = false;
      d.transferSource = null;
    }
  }
  return { set, cleared };
}

export function applyTagging(db: Db, opts: { now?: () => number } = {}): TaggingReport {
  const now = opts.now ?? Date.now;
  const started = now();
  const { compiled, invalid } = compileRules(listRules(db));
  const report: TaggingReport = { categorised: 0, categoryCleared: 0, transfersPaired: 0, transfersCleared: 0, recurringMatched: 0, invalidRules: invalid, durationMs: 0, at: new Date(started).toISOString() };

  db.transaction((tx) => {
    const rows = loadAll(tx);
    const desired = new Map<string, Desired>();
    const before = new Map<string, Desired>();

    // 6.1 rules
    for (const row of rows) {
      const d = fromMeta(row.meta);
      before.set(row.id, { ...d });
      const r = applyRules(compiled, row, d);
      if (r.set) report.categorised++;
      if (r.cleared) report.categoryCleared++;
      desired.set(row.id, d);
    }

    // 6.2 transfers: drop every auto pairing, except one whose partner has been manually pinned
    // as a transfer pointing back at it — that pair is confirmed, not stale, and the partner is
    // excluded from re-pairing below (transferSource === "manual"), so an unconditional drop
    // would orphan this row with nothing left to re-pair with. Recompute the rest among rows
    // nobody pinned. A confirmed pair's auto side must also be excluded from that recompute
    // (below): otherwise a same-currency/amount collision could still reassign it to an
    // unrelated candidate, breaking the pair asymmetrically just like an unconditional drop
    // would.
    const confirmedAutoIds = new Set<string>();
    for (const [id, d] of desired) {
      if (d.transferSource !== "auto") continue;
      const partner = d.counterpartTransactionId ? desired.get(d.counterpartTransactionId) : undefined;
      const partnerConfirmsPair = partner?.transferSource === "manual" && partner.counterpartTransactionId === id;
      if (partnerConfirmsPair) {
        confirmedAutoIds.add(id);
        continue;
      }
      d.isTransfer = false;
      d.transferSource = null;
      d.counterpartTransactionId = null;
    }
    const candidates = rows.filter((r) => {
      const d = desired.get(r.id)!;
      return !r.hidden && d.transferSource !== "manual" && d.transferSource !== "rule" && !confirmedAutoIds.has(r.id);
    });
    const pairs = pairTransfers(candidates.map((r) => ({ id: r.id, accountId: r.accountId, currency: r.currency, amountCents: r.amountCents, dateSec: r.dateSec, pending: r.pending })));
    for (const p of pairs) {
      const a = desired.get(p.outflowId)!;
      const b = desired.get(p.inflowId)!;
      a.isTransfer = true; a.transferSource = "auto"; a.counterpartTransactionId = p.inflowId;
      b.isTransfer = true; b.transferSource = "auto"; b.counterpartTransactionId = p.outflowId;
    }

    // 6.3 recurring: each active cost with a pattern re-derives its auto links from scratch; manual
    // links are untouched and occupy their period. A row that has no category after 6.1 borrows
    // the cost's category with source "recurring" (6.1 clears that source when it runs, so it is
    // re-derived here every pass).
    const costs = listRecurringCosts(tx as unknown as Db).filter((c) => c.matchPattern && c.matchPattern.trim());
    for (const [, d] of desired) {
      if (d.recurringSource === "auto") {
        d.recurringCostId = null;
        d.recurringSource = null;
      }
    }
    for (const cost of costs) {
      const candidates = rows
        .filter((r) => r.localDate !== null)
        .map((r) => {
          const d = desired.get(r.id)!;
          return {
            id: r.id, accountId: r.accountId, currency: r.currency, amountCents: r.amountCents, payee: r.payee, description: r.description,
            localDate: r.localDate!, isTransfer: d.isTransfer, hidden: r.hidden, pending: r.pending,
            manualCostId: d.recurringSource === "manual" ? d.recurringCostId : null,
          };
        });
      for (const link of matchRecurring(cost, candidates)) {
        const d = desired.get(link.transactionId)!;
        if (d.recurringCostId !== null) continue; // already linked to another cost this pass
        d.recurringCostId = cost.id;
        d.recurringSource = "auto";
        if (d.categoryId === null && d.categorySource !== "manual" && cost.categoryId !== null) {
          d.categoryId = cost.categoryId;
          d.categorySource = "recurring";
          d.ruleId = null;
        }
      }
    }

    // Write only what changed.
    const stamp = new Date(now()).toISOString();
    let newlyPairedRows = 0;
    for (const row of rows) {
      const d = desired.get(row.id)!;
      const b = before.get(row.id)!;
      if (b.isTransfer && !d.isTransfer) report.transfersCleared++;
      if (!b.isTransfer && d.isTransfer && d.transferSource === "auto") newlyPairedRows++;
      if (b.recurringCostId !== d.recurringCostId && d.recurringSource === "auto") report.recurringMatched++;
      if (same(b, d)) continue;
      if (isEmpty(d)) {
        if (row.meta) tx.delete(transactionMeta).where(eq(transactionMeta.transactionId, row.id)).run();
        continue;
      }
      tx.insert(transactionMeta)
        .values({ transactionId: row.id, ...d, updatedAt: stamp })
        .onConflictDoUpdate({ target: transactionMeta.transactionId, set: { ...d, updatedAt: stamp } })
        .run();
    }
    // A pair is two rows; an odd count means one side was already auto (re-paired to a new partner).
    report.transfersPaired = Math.ceil(newlyPairedRows / 2);
  });

  report.durationMs = now() - started;
  setState(db, STATE_KEYS.lastTagging, report);
  return report;
}

/** Step 6.1 for a single transaction, used after a manual override is cleared. */
export function applyRulesToOne(db: Db, transactionId: string): void {
  const { compiled } = compileRules(listRules(db));
  const row = loadAll(db, [transactionId])[0];
  if (!row) return;
  const d = fromMeta(row.meta);
  applyRules(compiled, row, d);
  if (isEmpty(d)) {
    if (row.meta) db.delete(transactionMeta).where(eq(transactionMeta.transactionId, row.id)).run();
    return;
  }
  const stamp = new Date().toISOString();
  db.insert(transactionMeta)
    .values({ transactionId: row.id, ...d, updatedAt: stamp })
    .onConflictDoUpdate({ target: transactionMeta.transactionId, set: { ...d, updatedAt: stamp } })
    .run();
}

export function getLastTagging(db: Db): TaggingReport | undefined {
  return getState<TaggingReport>(db, STATE_KEYS.lastTagging);
}
