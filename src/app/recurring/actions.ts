"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { CADENCES, type Cadence } from "@/lib/db/schema";
import { createRecurringCost, updateRecurringCost, setRecurringActive, deleteRecurringCost, RecurringError, type RecurringInput } from "@/lib/queries/recurring";
import { applyTagging } from "@/lib/tagging/apply";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function intOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function money(fd: FormData, k: string): number {
  const s = str(fd, k).replace(/[,$\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function revalidate(): void {
  for (const p of ["/", "/recurring", "/transactions", "/budget"]) revalidatePath(p);
}

function inputFrom(fd: FormData): RecurringInput {
  const cadence = str(fd, "cadence");
  const tolerancePct = str(fd, "tolerance");
  return {
    name: str(fd, "name"),
    provider: str(fd, "provider") || null,
    currency: str(fd, "currency") || "CAD",
    amountCents: money(fd, "amount"),
    cadence: (CADENCES as readonly string[]).includes(cadence) ? (cadence as Cadence) : "monthly",
    intervalDays: intOrNull(fd, "intervalDays"),
    anchorOn: str(fd, "anchorOn"),
    categoryId: intOrNull(fd, "category"),
    accountId: str(fd, "account") || null,
    matchPattern: str(fd, "matchPattern") || null,
    matchToleranceBps: tolerancePct ? Math.round(Number(tolerancePct) * 100) : 1000,
    notes: str(fd, "notes") || null,
  };
}

function fail(path: string, err: unknown): never {
  const message = err instanceof RecurringError ? err.message : "Something went wrong saving that.";
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

export async function createRecurringAction(fd: FormData): Promise<void> {
  try {
    createRecurringCost(getDb(), inputFrom(fd));
  } catch (e) {
    fail("/recurring", e);
  }
  applyTagging(getDb());
  revalidate();
  redirect("/recurring?saved=new");
}

export async function updateRecurringAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id)) redirect("/recurring");
  try {
    const db = getDb();
    updateRecurringCost(db, id, { ...inputFrom(fd), active: fd.get("active") === "on" });
  } catch (e) {
    fail(`/recurring?edit=${id}`, e);
  }
  applyTagging(getDb());
  revalidate();
  redirect(`/recurring?saved=${id}`);
}

export async function setRecurringActiveAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) {
    setRecurringActive(getDb(), id, str(fd, "active") === "1");
    applyTagging(getDb());
    revalidate();
  }
  redirect("/recurring");
}

export async function deleteRecurringAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) {
    deleteRecurringCost(getDb(), id);
    applyTagging(getDb());
    revalidate();
  }
  redirect("/recurring");
}
