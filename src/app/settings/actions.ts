"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { ACCOUNT_TYPES, CATEGORY_KINDS, RULE_FIELDS, RULE_MATCHES, type AccountType, type CategoryKind, type RuleField, type RuleMatch } from "@/lib/db/schema";
import { updateAccountSettings } from "@/lib/queries/accounts";
import { createCategory, updateCategory, setCategoryArchived, moveCategory, CategoryError } from "@/lib/queries/categories";
import { createRule, updateRule, deleteRule, moveRule, RuleError, type RuleInput } from "@/lib/queries/rules";
import { applyTagging } from "@/lib/tagging/apply";

export async function updateAccount(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const typeRaw = String(formData.get("type") ?? "");
  const type = (ACCOUNT_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as AccountType) : null;

  updateAccountSettings(getDb(), id, {
    nickname: String(formData.get("nickname") ?? "").trim(),
    type,
    hidden: formData.get("hidden") === "on",
  });

  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/spending");
  revalidatePath(`/accounts/${encodeURIComponent(id)}`);

  // A cheap "Saved" acknowledgement beside the row's button, with no client state.
  redirect(`/settings?saved=${encodeURIComponent(id)}`);
}

function revalidateTagged(): void {
  for (const p of ["/", "/transactions", "/spending", "/settings", "/settings/categories", "/settings/rules"]) revalidatePath(p);
  revalidatePath("/accounts/[id]", "page");
}

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function intOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}
/** Dollars typed by a person → cents. Empty → null. */
function moneyOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k).replace(/[,$\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function withError(path: string, err: unknown): never {
  const message = err instanceof CategoryError || err instanceof RuleError ? err.message : "Something went wrong saving that.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createCategoryAction(fd: FormData): Promise<void> {
  const kind = (CATEGORY_KINDS as readonly string[]).includes(str(fd, "kind")) ? (str(fd, "kind") as CategoryKind) : "expense";
  try {
    createCategory(getDb(), { name: str(fd, "name"), kind });
  } catch (e) {
    withError("/settings/categories", e);
  }
  revalidateTagged();
  redirect("/settings/categories?saved=new");
}

export async function updateCategoryAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) redirect("/settings/categories");
  const kind = (CATEGORY_KINDS as readonly string[]).includes(str(fd, "kind")) ? (str(fd, "kind") as CategoryKind) : undefined;
  const cap = moneyOrNull(fd, "cap");
  try {
    updateCategory(getDb(), id, { name: str(fd, "name"), kind, monthlyCapCents: cap, capCurrency: cap === null ? null : str(fd, "capCurrency") || null });
  } catch (e) {
    withError("/settings/categories", e);
  }
  revalidateTagged();
  redirect(`/settings/categories?saved=${id}`);
}

export async function archiveCategoryAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id) && id > 0) {
    setCategoryArchived(getDb(), id, str(fd, "archived") === "1");
    applyTagging(getDb());
    revalidateTagged();
  }
  redirect("/settings/categories");
}

export async function moveCategoryAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  const dir = str(fd, "direction");
  if (Number.isInteger(id) && id > 0 && (dir === "up" || dir === "down")) {
    moveCategory(getDb(), id, dir);
    revalidatePath("/settings/categories");
  }
  redirect("/settings/categories");
}

/** On create a rule is always active; on update the checkbox decides (unchecked sends nothing). */
function ruleInputFrom(fd: FormData, isUpdate: boolean): RuleInput {
  const field = str(fd, "field");
  const match = str(fd, "match");
  return {
    name: str(fd, "name"),
    field: (RULE_FIELDS as readonly string[]).includes(field) ? (field as RuleField) : "any",
    match: (RULE_MATCHES as readonly string[]).includes(match) ? (match as RuleMatch) : "contains",
    pattern: str(fd, "pattern"),
    accountId: str(fd, "account") || null,
    minAmountCents: moneyOrNull(fd, "min"),
    maxAmountCents: moneyOrNull(fd, "max"),
    categoryId: intOrNull(fd, "category"),
    markTransfer: fd.get("markTransfer") === "on",
    active: isUpdate ? fd.get("active") === "on" : true,
  };
}

export async function createRuleAction(fd: FormData): Promise<void> {
  try {
    createRule(getDb(), ruleInputFrom(fd, false));
  } catch (e) {
    withError("/settings/rules", e);
  }
  applyTagging(getDb());
  revalidateTagged();
  redirect("/settings/rules?saved=new");
}

export async function updateRuleAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) redirect("/settings/rules");
  try {
    updateRule(getDb(), id, ruleInputFrom(fd, true));
  } catch (e) {
    withError(`/settings/rules?edit=${id}`, e);
  }
  applyTagging(getDb());
  revalidateTagged();
  redirect(`/settings/rules?saved=${id}`);
}

export async function deleteRuleAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id) && id > 0) {
    deleteRule(getDb(), id);
    applyTagging(getDb());
    revalidateTagged();
  }
  redirect("/settings/rules");
}

export async function moveRuleAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  const dir = str(fd, "direction");
  if (Number.isInteger(id) && id > 0 && (dir === "up" || dir === "down")) {
    moveRule(getDb(), id, dir);
    applyTagging(getDb());
    revalidateTagged();
  }
  redirect("/settings/rules");
}

export async function rerunTaggingAction(): Promise<void> {
  applyTagging(getDb());
  revalidateTagged();
  redirect("/settings?tagged=1");
}
