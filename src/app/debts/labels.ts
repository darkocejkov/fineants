import type { Cadence, DebtKind } from "@/lib/db/schema";
import type { DebtStatus } from "@/lib/debts/schedule";
import type { StatusTone } from "@/components/StatusWord";

export const DEBT_TONE: Record<DebtStatus, StatusTone> = { paid_off: "good", on_track: "good", due_soon: "attention", interest_starts_soon: "attention", overdue: "bad" };
export const KIND_LABEL: Record<DebtKind, string> = { bnpl: "buy now, pay later", loan: "loan", other: "other" };
export const CADENCE_LABEL: Record<Cadence, string> = { weekly: "every week", biweekly: "every two weeks", monthly: "every month", yearly: "every year", custom_days: "every N days" };
