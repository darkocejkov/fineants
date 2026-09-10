"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/db/schema";
import { updateAccountSettings } from "@/lib/queries/accounts";

export async function updateAccount(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const typeRaw = String(formData.get("type") ?? "");
  const type = (ACCOUNT_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as AccountType) : null;

  updateAccountSettings(getDb(), id, {
    nickname: String(formData.get("nickname") ?? ""),
    type,
    hidden: formData.get("hidden") === "on",
  });

  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/spending");

  // A cheap "Saved" acknowledgement beside the row's button, with no client state.
  redirect(`/settings?saved=${encodeURIComponent(id)}`);
}
