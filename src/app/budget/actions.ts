"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { updateCategory, CategoryError } from "@/lib/queries/categories";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function moneyOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k).replace(/[,$\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function setCategoryCapAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  const month = /^\d{4}-\d{2}$/.test(str(fd, "month")) ? str(fd, "month") : "";
  const back = month ? `/budget?month=${month}` : "/budget";
  if (!Number.isInteger(id)) redirect(back);
  const cap = moneyOrNull(fd, "cap");
  let error: string | null = null;
  try {
    updateCategory(getDb(), id, { monthlyCapCents: cap, capCurrency: cap === null ? null : str(fd, "capCurrency") || null });
  } catch (e) {
    error = e instanceof CategoryError ? e.message : "Something went wrong saving the cap.";
  }
  revalidatePath("/budget");
  revalidatePath("/");
  revalidatePath("/settings/categories");
  redirect(error ? `${back}${month ? "&" : "?"}error=${encodeURIComponent(error)}` : `${back}${month ? "&" : "?"}saved=${id}`);
}
