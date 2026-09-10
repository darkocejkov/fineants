import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { transactionMeta, type TransactionMetaRow } from "../db/schema";
import { applyRulesToOne } from "../tagging/apply";

const now = () => new Date().toISOString();

export function getMeta(db: Db, transactionId: string): TransactionMetaRow | undefined {
  return db.select().from(transactionMeta).where(eq(transactionMeta.transactionId, transactionId)).get();
}

type MetaPatch = Partial<Omit<TransactionMetaRow, "transactionId">>;

/** Upsert a partial meta row. The pass owns deletion of empty rows; manual writes never delete. */
export function upsertMeta(db: Pick<Db, "insert">, transactionId: string, patch: MetaPatch, nowIso = now()): void {
  db.insert(transactionMeta)
    .values({ transactionId, updatedAt: nowIso, ...patch })
    .onConflictDoUpdate({ target: transactionMeta.transactionId, set: { ...patch, updatedAt: nowIso } })
    .run();
}

/** Owner picks a category (or "none"). Pinned against the pass until cleared. */
export function setCategory(db: Db, transactionId: string, categoryId: number | null, nowIso = now()): void {
  upsertMeta(db, transactionId, { categoryId, categorySource: "manual", ruleId: null }, nowIso);
}

/** Back to whatever the rules say; re-derives the category immediately via applyRulesToOne. */
export function clearCategoryOverride(db: Db, transactionId: string, nowIso = now()): void {
  const m = getMeta(db, transactionId);
  if (!m || m.categorySource !== "manual") return;
  upsertMeta(db, transactionId, { categoryId: null, categorySource: null, ruleId: null }, nowIso);
  applyRulesToOne(db, transactionId);
}

export function setTransfer(db: Db, transactionId: string, isTransfer: boolean, nowIso = now()): void {
  const m = getMeta(db, transactionId);
  db.transaction((tx) => {
    // Unmarking a transfer frees an auto partner so the next pass can re-pair it with something
    // else. Pinning `true` on a row that already has an auto counterpart must NOT free that
    // partner: the pair is confirmed, not broken, so both sides stay intact — the partner keeps
    // pointing back at this row and keeps its own (auto) source.
    if (!isTransfer && m?.counterpartTransactionId && m.transferSource === "auto") {
      upsertMeta(tx, m.counterpartTransactionId, { isTransfer: false, transferSource: null, counterpartTransactionId: null }, nowIso);
    }
    upsertMeta(tx, transactionId, { isTransfer, transferSource: "manual", counterpartTransactionId: isTransfer ? (m?.counterpartTransactionId ?? null) : null }, nowIso);
  });
}

export function setRecurring(db: Db, transactionId: string, recurringCostId: number | null, nowIso = now()): void {
  upsertMeta(db, transactionId, { recurringCostId, recurringSource: "manual" }, nowIso);
}
