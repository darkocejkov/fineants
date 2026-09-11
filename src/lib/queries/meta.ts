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
  const counterpartId = m?.counterpartTransactionId ?? null;
  // Unmarking a transfer frees an auto partner so the next pass can re-pair it with something
  // else. That holds whether this row is still the pass's own auto side or was pinned `true`
  // first — confirming a pair leaves this row `manual` while it keeps the counterpart, and the
  // partner would otherwise stay a transfer pointing at a row that is no longer one, with
  // nothing left to re-pair it. Pinning `true` must NOT free the partner: the pair is confirmed,
  // not broken, so both sides stay intact and the partner keeps its own (auto) source.
  const partner = !isTransfer && counterpartId !== null ? getMeta(db, counterpartId) : undefined;
  const freeId =
    counterpartId !== null && (m?.transferSource === "auto" || (partner?.transferSource === "auto" && partner.counterpartTransactionId === transactionId))
      ? counterpartId
      : null;
  db.transaction((tx) => {
    if (!isTransfer && freeId !== null) {
      upsertMeta(tx, freeId, { isTransfer: false, transferSource: null, counterpartTransactionId: null }, nowIso);
    }
    upsertMeta(tx, transactionId, { isTransfer, transferSource: "manual", counterpartTransactionId: isTransfer ? counterpartId : null }, nowIso);
  });
}

export function setRecurring(db: Db, transactionId: string, recurringCostId: number | null, nowIso = now()): void {
  upsertMeta(db, transactionId, { recurringCostId, recurringSource: "manual" }, nowIso);
}
