"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { setCategory, clearCategoryOverride, setTransfer } from "@/lib/queries/meta";

/** Only ever send the browser back to a path on this site. */
function safeReturn(raw: FormDataEntryValue | null): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/transactions";
}

function revalidateAll(): void {
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/spending");
  revalidatePath("/accounts/[id]", "page");
}

export async function setTransactionCategory(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("category") ?? "");
  if (id) {
    const db = getDb();
    if (raw === "clear") clearCategoryOverride(db, id);
    else if (raw === "") setCategory(db, id, null);
    else if (/^\d+$/.test(raw)) setCategory(db, id, Number(raw));
    revalidateAll();
  }
  redirect(safeReturn(formData.get("returnTo")));
}

export async function setTransactionTransfer(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const flag = String(formData.get("transfer") ?? "");
  if (id && (flag === "1" || flag === "0")) {
    setTransfer(getDb(), id, flag === "1");
    revalidateAll();
  }
  redirect(safeReturn(formData.get("returnTo")));
}
