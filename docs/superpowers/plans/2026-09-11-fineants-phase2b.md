# fineants Phase 2b Implementation Plan — budgets, recurring costs, debts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the tables plan 2a created: monthly category caps with a Budget page, recurring costs matched to bank transactions with a Recurring page, external debts with payments and a transaction picker on Debts pages, the recurring-matching step of the tagging pass, Overview lines for all three, and `GET /api/v1/upcoming` for phase 3.

**Architecture:** Same single Next.js app, library-first. Pure schedule math in `src/lib/recurring/schedule.ts` and `src/lib/debts/schedule.ts`; query modules `queries/recurring.ts`, `queries/debts.ts`, `budget/month.ts`; the tagging pass gains step 6.3 (`tagging/recurringMatch.ts`); pages are server components with server actions; the only new client code is none (all forms are plain HTML posting to server actions or GET round-trips, as in 2a). No schema change: every table exists from migration 0001.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Drizzle ORM 0.45 + better-sqlite3 13, zod 4 (not needed here), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-10-fineants-phase2-design.md` sections 7, 8, 9, 6.3, 12 (Budget, Recurring, Debts, `/debts/link`, Overview additions, Transactions "Set against a debt", Nav), 13 (`summary.debts/budget`, `upcoming`), 15, 16. Visual system: `docs/superpowers/specs/2026-09-09-fineants-design-direction.md` including its "Phase 2 additions" (fill rule, status words, forms, no modals), binding for all UI tasks.

## Global Constraints

- `src/lib/**` never imports from `next` or `react`; every function takes `db: Db` explicitly.
- Money is integer cents plus a `currency` column. Owner-entered dates and `local_date` are `YYYY-MM-DD` text; `*_at` are ISO text written by fineants. Comparisons between date strings use plain string comparison (ISO order).
- Anything bucketed by day or month uses `transactions.local_date`. The budget month is the calendar month in `Config.timezone`.
- A `transaction_meta` field whose source is `manual` is never changed by the tagging pass. The pass stays idempotent: a second identical pass reports zero changes and writes nothing.
- Recurring period: a due date `d`'s period runs from `d − 7 days` up to but not including `next(d) − 7 days`. A cost is `paid` for a period when a linked transaction's `local_date` lies in the window; `due` when unpaid and `today ≤ d`; `overdue` when unpaid and `today > d`.
- Monthly equivalents: weekly ×52/12, biweekly ×26/12, monthly ×1, yearly ÷12, custom_days ×(365.25/interval)/12, rounded to cents.
- Debt remaining = principal − sum(payments), never displayed below 0. Instalments are paid in date order; a payment larger than one instalment spills into the next. Status precedence: `paid_off`, `overdue`, `due_soon` (next due within 14 days), `interest_starts_soon` (`interest_free_until` within 30 days and remaining > 0), `on_track`. No interest accrual is computed.
- One bank transaction pays at most one debt (`debt_payments.transaction_id` is unique); linking a second time is rejected with a message naming the debt it already pays.
- Budget pace: `paceCents = round(cap × daysElapsed / daysInMonth)`; `paceState` is `over_cap` when spent > cap, else `over_pace` when spent > pace, else `on_pace`; rendered as "over", "ahead of pace", "on pace".
- Debts are **not** folded into net worth; they get their own Overview line and total.
- UI follows the design direction: ruled ledgers, one 3px ink rule per section, stamps in ink, sentence case, status words as coloured text only, the fill rule for budget progress, forms one column, no modals (pickers are pages), no badges/pills/icons/shadows/gradients/all-caps. Buttons name the outcome ("Save cap", "Add payment", "Link transaction").
- Tests: Vitest, in-memory SQLite via `tests/helpers/db.ts`, no network. Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` before every commit. Browser checks run against a scratch copy of the database on port 3100, never against `data/fineants.db`, and always stop the dev server and delete the scratch copy and any `.playwright-mcp/` directory afterwards.
- Commit trailer for every commit (literal text; it is a project convention, not the model's identity):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018Djqcj8frDK2ennZUr8JNR
  ```

## File structure

| path | responsibility |
| --- | --- |
| `src/lib/time.ts` | gains `daysInMonth`, `addMonths`, `monthKey`, `parseMonthKey`, `monthBounds` |
| `src/lib/recurring/schedule.ts` | pure cadence math: due dates, current period, status, monthly equivalent |
| `src/lib/debts/schedule.ts` | pure debt math: remaining, projected instalments, next due, status |
| `src/lib/tagging/recurringMatch.ts` | pure matcher: candidates → links per cost |
| `src/lib/tagging/apply.ts` | step 6.3 wired in; `recurringMatched` counted |
| `src/lib/queries/recurring.ts` | recurring costs CRUD, validation, status list, pattern preview, upcoming |
| `src/lib/queries/debts.ts` | debts and payments CRUD, link transaction, candidates, status list, lenders, totals, upcoming |
| `src/lib/budget/month.ts` | `budgetMonth`, `budgetMonthRange` |
| `src/lib/queries/transactions.ts` | `TxRow` gains `debtId`, `debtName` (left join on debt_payments) |
| `src/lib/api/summary.ts` | `buildSummary(db, { tz, nowMs? })` gains `debts` and `budget`; new `buildUpcoming` |
| `src/app/api/v1/summary/route.ts`, `src/app/api/v1/upcoming/route.ts` | routes |
| `src/components/Nav.tsx` | Budget, Recurring, Debts links |
| `src/components/FillRule.tsx`, `src/components/MonthSwitcher.tsx` | budget presentation |
| `src/app/budget/{page,actions}.tsx` | Budget page and cap edits |
| `src/app/recurring/{page,actions}.tsx` | Recurring page, add/edit with preview, activate/deactivate |
| `src/app/debts/{page,actions}.tsx`, `src/app/debts/[id]/page.tsx`, `src/app/debts/link/page.tsx` | Debts pages and picker |
| `src/components/TransactionsTable.tsx` | "Set against a debt" / "Pays <debt>" |
| `src/app/page.tsx` | Overview lines |
| `src/app/globals.css` | `.ledger-group`, `.month-switcher` (small additions) |
| `README.md`, design direction doc | docs |
| `tests/helpers/seed2b.ts` | `seedRecurring`, `seedDebts` |
| tests | `tests/unit/time.test.ts`, `recurring-schedule.test.ts`, `debt-schedule.test.ts`, `recurring-match.test.ts`; `tests/integration/recurring.test.ts`, `debts.test.ts`, `budget.test.ts`, `tagging.test.ts`; `tests/api/routes.test.ts`, `handlers.test.ts` |

Rulings baked into this plan:

- `buildSummary`'s signature changes to `(db, { tz, nowMs? })` because the budget month needs the timezone; the route and tests are updated in the same task.
- Recurring costs and debts each get their own top-level page (spec §12), not Settings sections; the Settings sub-nav stays General / Categories / Rules.
- The recurring form's "would match N" preview is a GET round-trip like the rules form (2a ruling), with the form keyed on edit target and preview state.
- The debt "Link a transaction" picker on `/debts/[id]` is a GET search form plus a ledger with one "Link" button per row; `/debts/link?tx=` is the mirror from the transactions side. No modals.
- `TxRow` learns which debt a transaction pays via a left join, so the transactions row can say "Pays <debt>" instead of offering the link again.
- A debt payment does not change the transaction's category (spec §4 note); the owner can make a "Debt payments" rule.

---

### Task 1: Month arithmetic in `time.ts`

**Files:**
- Modify: `src/lib/time.ts`
- Test: `tests/unit/time.test.ts`

**Interfaces:**
- Produces: `daysInMonth(year: number, month: number): number` (month 1–12); `addMonths(date: string, n: number): string` (day clamped to month end); `monthKey(date: string): string` (`YYYY-MM`); `parseMonthKey(key: string): { year: number; month: number } | null`; `monthBounds(year: number, month: number, tz: string): { startDate: string; endDate: string; startSec: number; endSec: number }` (`endSec` = local midnight after `endDate`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/time.test.ts` (extend the import line with the new names):

```ts
describe("month arithmetic", () => {
  it("knows month lengths including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
  it("adds months and clamps the day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonths("2026-05-31", 12)).toBe("2027-05-31");
  });
  it("parses and formats month keys", () => {
    expect(monthKey("2026-09-09")).toBe("2026-09");
    expect(parseMonthKey("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-9")).toBeNull();
  });
  it("computes month bounds in the zone", () => {
    const b = monthBounds(2026, 9, "America/Toronto");
    expect(b.startDate).toBe("2026-09-01");
    expect(b.endDate).toBe("2026-09-30");
    expect(b.startSec).toBe(Date.UTC(2026, 8, 1, 4) / 1000); // EDT midnight
    expect(b.endSec).toBe(Date.UTC(2026, 9, 1, 4) / 1000);
    const f = monthBounds(2026, 2, "UTC");
    expect(f.endDate).toBe("2026-02-28");
    expect(f.endSec).toBe(Date.UTC(2026, 2, 1) / 1000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/time.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `src/lib/time.ts`:

```ts
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days in a month; `month` is 1–12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar months added to a YYYY-MM-DD string; the day is clamped to the target month's length. */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = split(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  if (!MONTH_KEY_RE.test(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** First and last local date of the month, and the instants at which the month starts and ends in the zone. */
export function monthBounds(year: number, month: number, tz: string): { startDate: string; endDate: string; startSec: number; endSec: number } {
  const startDate = `${year}-${pad2(month)}-01`;
  const endDate = `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
  return {
    startDate,
    endDate,
    startSec: localMidnightMs(startDate, tz) / 1000,
    endSec: localMidnightMs(addDays(endDate, 1), tz) / 1000,
  };
}
```

- [ ] **Step 4: Run tests, type-check, commit**

Run: `npx vitest run tests/unit/time.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS.

```bash
git add src/lib/time.ts tests/unit/time.test.ts
git commit -m "feat(time): month arithmetic and bounds"
```

---

### Task 2: Recurring schedule math (pure)

**Files:**
- Create: `src/lib/recurring/schedule.ts`
- Test: `tests/unit/recurring-schedule.test.ts`

**Interfaces:**
- Produces: `CadenceLike = { cadence: Cadence; intervalDays: number | null; anchorOn: string }`; `PERIOD_LEAD_DAYS = 7`; `dueAt(c, k: number): string` (k-th due date from the anchor, k may be negative); `currentIndex(c, today): number`; `currentDue(c, today): string`; `periodWindow(c, k): { start: string; endExclusive: string }`; `projectDueDates(c, fromDate, toDate): string[]` (inclusive both ends, ascending); `nearestDueIndex(c, date): number`; `RecurringStatus = "paid" | "due" | "overdue"`; `recurringStatus(due: string, today: string, paid: boolean): RecurringStatus`; `monthlyEquivalentCents(amountCents: number, c: CadenceLike): number`; `intervalDaysOf(c): number | null`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/recurring-schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dueAt, currentIndex, currentDue, periodWindow, projectDueDates, nearestDueIndex, recurringStatus, monthlyEquivalentCents, type CadenceLike } from "@/lib/recurring/schedule";

const monthly: CadenceLike = { cadence: "monthly", intervalDays: null, anchorOn: "2026-01-31" };
const weekly: CadenceLike = { cadence: "weekly", intervalDays: null, anchorOn: "2026-09-02" };
const biweekly: CadenceLike = { cadence: "biweekly", intervalDays: null, anchorOn: "2026-09-04" };
const yearly: CadenceLike = { cadence: "yearly", intervalDays: null, anchorOn: "2024-02-29" };
const custom: CadenceLike = { cadence: "custom_days", intervalDays: 45, anchorOn: "2026-01-01" };

describe("dueAt", () => {
  it("steps monthly from the anchor with month-end clamping, without drift", () => {
    expect(dueAt(monthly, 0)).toBe("2026-01-31");
    expect(dueAt(monthly, 1)).toBe("2026-02-28");
    expect(dueAt(monthly, 2)).toBe("2026-03-31"); // not 03-28: computed from the anchor, not chained
    expect(dueAt(monthly, -1)).toBe("2025-12-31");
  });
  it("steps weekly, biweekly, yearly, custom", () => {
    expect(dueAt(weekly, 3)).toBe("2026-09-23");
    expect(dueAt(biweekly, 1)).toBe("2026-09-18");
    expect(dueAt(yearly, 1)).toBe("2025-02-28");
    expect(dueAt(yearly, 4)).toBe("2028-02-29");
    expect(dueAt(custom, 2)).toBe("2026-04-01");
  });
});

describe("periods", () => {
  it("finds the period containing today with the 7-day lead", () => {
    // Due 2026-09-30 (k=8); its period runs 09-23 .. 10-23 (next due 10-31 minus 7).
    expect(currentDue(monthly, "2026-09-23")).toBe("2026-09-30");
    expect(currentDue(monthly, "2026-10-22")).toBe("2026-09-30");
    expect(currentDue(monthly, "2026-10-24")).toBe("2026-10-31");
    expect(currentDue(monthly, "2026-09-22")).toBe("2026-08-31");
    expect(currentIndex(weekly, "2026-09-02")).toBe(0);
    expect(currentIndex(weekly, "2026-09-01")).toBe(0); // lead covers the week before
    expect(currentIndex(weekly, "2026-08-25")).toBe(-1);
  });
  it("gives the period window", () => {
    expect(periodWindow(monthly, 8)).toEqual({ start: "2026-09-23", endExclusive: "2026-10-24" });
  });
  it("projects due dates inside a range, inclusive", () => {
    expect(projectDueDates(weekly, "2026-09-09", "2026-09-30")).toEqual(["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"]);
    expect(projectDueDates(monthly, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(projectDueDates(weekly, "2026-09-10", "2026-09-15")).toEqual([]);
  });
  it("finds the nearest due index to a date", () => {
    expect(nearestDueIndex(monthly, "2026-09-14")).toBe(7); // 08-31 is 14 away, 09-30 is 16 away
    expect(nearestDueIndex(monthly, "2026-09-16")).toBe(8);
    expect(nearestDueIndex(weekly, "2026-09-05")).toBe(0);
    expect(nearestDueIndex(weekly, "2026-09-06")).toBe(1); // tie goes to the later due date
  });
});

describe("status and equivalents", () => {
  it("classifies paid, due, overdue", () => {
    expect(recurringStatus("2026-09-30", "2026-09-25", true)).toBe("paid");
    expect(recurringStatus("2026-09-30", "2026-09-25", false)).toBe("due");
    expect(recurringStatus("2026-09-30", "2026-09-30", false)).toBe("due");
    expect(recurringStatus("2026-09-30", "2026-10-01", false)).toBe("overdue");
  });
  it("normalises to a month", () => {
    expect(monthlyEquivalentCents(1200, monthly)).toBe(1200);
    expect(monthlyEquivalentCents(1000, weekly)).toBe(4333);
    expect(monthlyEquivalentCents(1000, biweekly)).toBe(2167);
    expect(monthlyEquivalentCents(12000, yearly)).toBe(1000);
    expect(monthlyEquivalentCents(4500, custom)).toBe(3044); // 4500 * (365.25/45) / 12 = 3043.75
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/recurring-schedule.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/recurring/schedule.ts`:

```ts
import type { Cadence } from "../db/schema";
import { addDays, addMonths, daysBetween } from "../time";

export type CadenceLike = { cadence: Cadence; intervalDays: number | null; anchorOn: string };
export type RecurringStatus = "paid" | "due" | "overdue";

/** A period opens this many days before its due date, so an early payment still counts. */
export const PERIOD_LEAD_DAYS = 7;

export function intervalDaysOf(c: CadenceLike): number | null {
  if (c.cadence === "weekly") return 7;
  if (c.cadence === "biweekly") return 14;
  if (c.cadence === "custom_days") return c.intervalDays;
  return null;
}

function approxPeriodDays(c: CadenceLike): number {
  if (c.cadence === "monthly") return 365.25 / 12;
  if (c.cadence === "yearly") return 365.25;
  return intervalDaysOf(c) ?? 30;
}

/** The k-th due date counted from the anchor (k may be negative). Month-based cadences are computed from the anchor, never chained, so clamping does not drift. */
export function dueAt(c: CadenceLike, k: number): string {
  if (c.cadence === "monthly") return addMonths(c.anchorOn, k);
  if (c.cadence === "yearly") return addMonths(c.anchorOn, 12 * k);
  const days = intervalDaysOf(c);
  if (!days || days <= 0) throw new Error(`recurring cost has no usable interval (${c.cadence})`);
  return addDays(c.anchorOn, k * days);
}

/** Index k whose period contains `today`: due(k) − lead ≤ today < due(k+1) − lead. */
export function currentIndex(c: CadenceLike, today: string): number {
  let k = Math.floor(daysBetween(c.anchorOn, today) / approxPeriodDays(c));
  while (daysBetween(dueAt(c, k), today) < -PERIOD_LEAD_DAYS) k--;
  while (daysBetween(dueAt(c, k + 1), today) >= -PERIOD_LEAD_DAYS) k++;
  return k;
}

export function currentDue(c: CadenceLike, today: string): string {
  return dueAt(c, currentIndex(c, today));
}

export function periodWindow(c: CadenceLike, k: number): { start: string; endExclusive: string } {
  return { start: addDays(dueAt(c, k), -PERIOD_LEAD_DAYS), endExclusive: addDays(dueAt(c, k + 1), -PERIOD_LEAD_DAYS) };
}

/** Due dates with fromDate ≤ due ≤ toDate, ascending. */
export function projectDueDates(c: CadenceLike, fromDate: string, toDate: string): string[] {
  if (toDate < fromDate) return [];
  let k = Math.floor(daysBetween(c.anchorOn, fromDate) / approxPeriodDays(c)) - 1;
  while (dueAt(c, k) >= fromDate) k--;
  while (dueAt(c, k + 1) < fromDate) k++;
  const out: string[] = [];
  for (k = k + 1; dueAt(c, k) <= toDate; k++) out.push(dueAt(c, k));
  return out;
}

/** The due index closest to `date`; an exact tie goes to the later due date. */
export function nearestDueIndex(c: CadenceLike, date: string): number {
  const k0 = Math.floor(daysBetween(c.anchorOn, date) / approxPeriodDays(c));
  let best = k0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const k of [k0 - 1, k0, k0 + 1, k0 + 2]) {
    const dist = Math.abs(daysBetween(dueAt(c, k), date));
    if (dist < bestDist || (dist === bestDist && k > best)) {
      best = k;
      bestDist = dist;
    }
  }
  return best;
}

export function recurringStatus(due: string, today: string, paid: boolean): RecurringStatus {
  if (paid) return "paid";
  return today <= due ? "due" : "overdue";
}

export function monthlyEquivalentCents(amountCents: number, c: CadenceLike): number {
  switch (c.cadence) {
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "biweekly":
      return Math.round((amountCents * 26) / 12);
    case "monthly":
      return amountCents;
    case "yearly":
      return Math.round(amountCents / 12);
    case "custom_days": {
      const days = c.intervalDays ?? 30;
      return Math.round((amountCents * (365.25 / days)) / 12);
    }
  }
}
```

- [ ] **Step 4: Run tests, type-check, commit**

Run: `npx vitest run tests/unit/recurring-schedule.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS. If a projected value in the tests disagrees with the code by one day, re-derive it by hand from the rules above and fix whichever side is wrong; say so in the report.

```bash
git add src/lib/recurring/schedule.ts tests/unit/recurring-schedule.test.ts
git commit -m "feat(recurring): cadence schedule math"
```

---

### Task 3: Debt schedule math (pure)

**Files:**
- Create: `src/lib/debts/schedule.ts`
- Test: `tests/unit/debt-schedule.test.ts`

**Interfaces:**
- Produces: `DebtLike = Pick<ExternalDebtRow, "principalCents" | "payoffDueOn" | "interestFreeUntil" | "dueDay" | "instalmentAmountCents" | "cadence" | "intervalDays" | "firstInstalmentOn" | "instalmentCount" | "closedAt">`; `PaymentLike = { paidOn: string; amountCents: number }`; `MAX_INSTALMENTS = 600`; `paidCents(payments): number`; `remainingCents(debt, payments): number` (raw, may be negative); `hasSchedule(debt): boolean`; `InstalmentState = "paid" | "partial" | "due" | "overdue"`; `Instalment = { index: number; dueOn: string; amountCents: number; paidCents: number; state: InstalmentState }`; `projectedInstalments(debt, payments, today): Instalment[]`; `nextDue(debt, payments, today): string | null`; `DebtStatus = "paid_off" | "overdue" | "due_soon" | "interest_starts_soon" | "on_track"`; `debtStatus(debt, payments, today): DebtStatus`; `DEBT_STATUS_WORDS: Record<DebtStatus, string>`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/debt-schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { remainingCents, projectedInstalments, nextDue, debtStatus, hasSchedule, type DebtLike, type PaymentLike } from "@/lib/debts/schedule";

const base: DebtLike = {
  principalCents: 40000, payoffDueOn: null, interestFreeUntil: null, dueDay: null,
  instalmentAmountCents: null, cadence: null, intervalDays: null, firstInstalmentOn: null, instalmentCount: null, closedAt: null,
};
const payIn4: DebtLike = { ...base, instalmentAmountCents: 10000, cadence: "biweekly", firstInstalmentOn: "2026-09-01", instalmentCount: 4 };
const deferred: DebtLike = { ...base, principalCents: 120000, interestFreeUntil: "2027-03-01", payoffDueOn: "2027-03-01" };
const loan: DebtLike = { ...base, principalCents: 1500000, dueDay: 15 };
const p = (paidOn: string, amountCents: number): PaymentLike => ({ paidOn, amountCents });

describe("remaining and schedule", () => {
  it("subtracts payments", () => {
    expect(remainingCents(payIn4, [])).toBe(40000);
    expect(remainingCents(payIn4, [p("2026-09-01", 10000), p("2026-09-15", 10000)])).toBe(20000);
    expect(remainingCents(payIn4, [p("2026-09-01", 50000)])).toBe(-10000);
  });
  it("projects a pay-in-4 and applies payments in order with spill-over", () => {
    expect(hasSchedule(payIn4)).toBe(true);
    const rows = projectedInstalments(payIn4, [p("2026-09-01", 15000)], "2026-09-20");
    expect(rows.map((r) => r.dueOn)).toEqual(["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"]);
    expect(rows.map((r) => r.paidCents)).toEqual([10000, 5000, 0, 0]);
    expect(rows.map((r) => r.state)).toEqual(["paid", "partial", "due", "due"]);
  });
  it("marks unpaid past instalments overdue", () => {
    const rows = projectedInstalments(payIn4, [], "2026-09-16");
    expect(rows.map((r) => r.state)).toEqual(["overdue", "overdue", "due", "due"]);
  });
  it("open-ended schedule runs until the principal is covered", () => {
    const openEnded: DebtLike = { ...base, principalCents: 25000, instalmentAmountCents: 10000, cadence: "monthly", firstInstalmentOn: "2026-10-01", instalmentCount: null };
    const rows = projectedInstalments(openEnded, [], "2026-09-09");
    expect(rows.map((r) => r.amountCents)).toEqual([10000, 10000, 5000]);
  });
  it("has no schedule for deferred plans and loans", () => {
    expect(projectedInstalments(deferred, [], "2026-09-09")).toEqual([]);
    expect(projectedInstalments(loan, [], "2026-09-09")).toEqual([]);
  });
});

describe("nextDue", () => {
  it("is the first instalment not fully paid, or null when all are paid", () => {
    expect(nextDue(payIn4, [p("2026-09-01", 10000)], "2026-09-09")).toBe("2026-09-15");
    expect(nextDue(payIn4, [p("2026-09-01", 40000)], "2026-09-09")).toBeNull();
  });
  it("is the payoff date for deferred plans", () => {
    expect(nextDue(deferred, [], "2026-09-09")).toBe("2027-03-01");
  });
  it("is the next occurrence of due_day for open loans", () => {
    expect(nextDue(loan, [], "2026-09-09")).toBe("2026-09-15");
    expect(nextDue(loan, [], "2026-09-15")).toBe("2026-09-15");
    expect(nextDue(loan, [], "2026-09-16")).toBe("2026-10-15");
    expect(nextDue({ ...loan, dueDay: 31 }, [], "2026-02-10")).toBe("2026-02-28");
  });
  it("is null with nothing to go on", () => {
    expect(nextDue(base, [], "2026-09-09")).toBeNull();
  });
});

describe("debtStatus precedence", () => {
  it("paid_off beats everything", () => {
    expect(debtStatus(payIn4, [p("2026-09-01", 40000)], "2026-12-01")).toBe("paid_off");
    expect(debtStatus({ ...payIn4, closedAt: "2026-09-09T00:00:00Z" }, [], "2026-09-09")).toBe("paid_off");
  });
  it("overdue, then due_soon, then interest_starts_soon, then on_track", () => {
    expect(debtStatus(payIn4, [], "2026-09-02")).toBe("overdue");
    expect(debtStatus(payIn4, [], "2026-08-25")).toBe("due_soon");
    expect(debtStatus(payIn4, [], "2026-08-01")).toBe("on_track");
    expect(debtStatus(deferred, [], "2027-02-20")).toBe("due_soon"); // payoff within 14 days wins over interest
    expect(debtStatus(deferred, [], "2027-02-01")).toBe("interest_starts_soon");
    expect(debtStatus(deferred, [], "2026-09-09")).toBe("on_track");
    expect(debtStatus(deferred, [], "2027-03-02")).toBe("overdue");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/debt-schedule.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/debts/schedule.ts`:

```ts
import type { ExternalDebtRow } from "../db/schema";
import { addMonths, daysBetween, daysInMonth } from "../time";
import { dueAt, type CadenceLike } from "../recurring/schedule";

export type DebtLike = Pick<
  ExternalDebtRow,
  "principalCents" | "payoffDueOn" | "interestFreeUntil" | "dueDay" | "instalmentAmountCents" | "cadence" | "intervalDays" | "firstInstalmentOn" | "instalmentCount" | "closedAt"
>;
export type PaymentLike = { paidOn: string; amountCents: number };
export type InstalmentState = "paid" | "partial" | "due" | "overdue";
export type Instalment = { index: number; dueOn: string; amountCents: number; paidCents: number; state: InstalmentState };
export type DebtStatus = "paid_off" | "overdue" | "due_soon" | "interest_starts_soon" | "on_track";

export const MAX_INSTALMENTS = 600;
export const DUE_SOON_DAYS = 14;
export const INTEREST_SOON_DAYS = 30;

export const DEBT_STATUS_WORDS: Record<DebtStatus, string> = {
  paid_off: "paid off",
  overdue: "overdue",
  due_soon: "due soon",
  interest_starts_soon: "interest starts soon",
  on_track: "on track",
};

export function paidCents(payments: PaymentLike[]): number {
  return payments.reduce((n, p) => n + p.amountCents, 0);
}

/** Principal minus payments; may go negative when the owner overpays. Display clamps at 0. */
export function remainingCents(debt: DebtLike, payments: PaymentLike[]): number {
  return debt.principalCents - paidCents(payments);
}

export function hasSchedule(debt: DebtLike): boolean {
  return debt.instalmentAmountCents !== null && debt.cadence !== null && debt.firstInstalmentOn !== null;
}

function cadenceOf(debt: DebtLike): CadenceLike {
  return { cadence: debt.cadence!, intervalDays: debt.intervalDays, anchorOn: debt.firstInstalmentOn! };
}

/** Instalments in date order with payments applied oldest-first; a payment larger than one instalment spills into the next. */
export function projectedInstalments(debt: DebtLike, payments: PaymentLike[], today: string): Instalment[] {
  if (!hasSchedule(debt)) return [];
  const c = cadenceOf(debt);
  const each = debt.instalmentAmountCents!;
  let pool = paidCents(payments);
  let cumulative = 0;
  const out: Instalment[] = [];
  for (let k = 0; k < MAX_INSTALMENTS; k++) {
    if (debt.instalmentCount !== null && k >= debt.instalmentCount) break;
    if (debt.instalmentCount === null && cumulative >= debt.principalCents) break;
    const amountCents = debt.instalmentCount === null ? Math.min(each, debt.principalCents - cumulative) : each;
    cumulative += amountCents;
    const applied = Math.min(pool, amountCents);
    pool -= applied;
    const dueOn = dueAt(c, k);
    const state: InstalmentState = applied >= amountCents ? "paid" : applied > 0 ? "partial" : today > dueOn ? "overdue" : "due";
    out.push({ index: k, dueOn, amountCents, paidCents: applied, state });
  }
  return out;
}

/** Next occurrence of a day-of-month on or after `today`, clamped to month length. */
function nextDueDay(dueDay: number, today: string): string {
  const [y, m] = today.split("-").map(Number);
  const thisMonth = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dueDay, daysInMonth(y, m))).padStart(2, "0")}`;
  if (thisMonth >= today) return thisMonth;
  const next = addMonths(`${y}-${String(m).padStart(2, "0")}-01`, 1);
  const [ny, nm] = next.split("-").map(Number);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(dueDay, daysInMonth(ny, nm))).padStart(2, "0")}`;
}

export function nextDue(debt: DebtLike, payments: PaymentLike[], today: string): string | null {
  if (hasSchedule(debt)) {
    const open = projectedInstalments(debt, payments, today).find((i) => i.paidCents < i.amountCents);
    return open ? open.dueOn : null;
  }
  if (debt.payoffDueOn) return debt.payoffDueOn;
  if (debt.dueDay) return nextDueDay(debt.dueDay, today);
  return null;
}

export function debtStatus(debt: DebtLike, payments: PaymentLike[], today: string): DebtStatus {
  if (debt.closedAt || remainingCents(debt, payments) <= 0) return "paid_off";
  const due = nextDue(debt, payments, today);
  if (due && due < today) return "overdue";
  if (due && daysBetween(today, due) <= DUE_SOON_DAYS) return "due_soon";
  if (debt.interestFreeUntil) {
    const until = daysBetween(today, debt.interestFreeUntil);
    if (until >= 0 && until <= INTEREST_SOON_DAYS) return "interest_starts_soon";
  }
  return "on_track";
}
```

- [ ] **Step 4: Run tests, type-check, commit**

Run: `npx vitest run tests/unit/debt-schedule.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS.

```bash
git add src/lib/debts/schedule.ts tests/unit/debt-schedule.test.ts
git commit -m "feat(debts): remaining, instalment projection, next due, status"
```

---

### Task 4: Recurring costs queries and seed helpers

**Files:**
- Create: `src/lib/queries/recurring.ts`, `tests/helpers/seed2b.ts`
- Test: `tests/integration/recurring.test.ts`

**Interfaces:**
- Consumes: Task 2 schedule functions; `transactionMeta`, `recurringCosts`, `transactions`, `accounts` tables; `CADENCES`.
- Produces:
  - `RecurringInput = { name: string; provider?: string | null; currency: string; amountCents: number; cadence: Cadence; intervalDays?: number | null; anchorOn: string; categoryId?: number | null; accountId?: string | null; matchPattern?: string | null; matchToleranceBps?: number; active?: boolean; notes?: string | null }`
  - `RecurringError`; `validateRecurringInput(input): string | null`
  - `listRecurringCosts(db, opts?: { includeInactive?: boolean }): RecurringCostRow[]`; `getRecurringCost(db, id)`; `createRecurringCost(db, input, nowIso?)`; `updateRecurringCost(db, id, input, nowIso?)`; `setRecurringActive(db, id, active, nowIso?)`; `deleteRecurringCost(db, id)`
  - `RecurringWithStatus = RecurringCostRow & { dueOn: string; status: RecurringStatus; matched: { transactionId: string; localDate: string; amountCents: number } | null; monthlyEquivalentCents: number }`
  - `listRecurringWithStatus(db, opts: { today: string; includeInactive?: boolean }): RecurringWithStatus[]`
  - `previewPatternMatches(db, input: Pick<RecurringInput, "currency" | "amountCents" | "accountId" | "matchPattern" | "matchToleranceBps">, limit = 5): { count: number; sample: { id: string; localDate: string | null; payee: string | null; description: string; amountCents: number; currency: string }[] }`
  - `UpcomingRecurring = { kind: "recurring"; id: number; name: string; provider: string | null; currency: string; amountCents: number; dueOn: string; status: RecurringStatus }`; `upcomingRecurring(db, opts: { today: string; days: number }): UpcomingRecurring[]` — unpaid periods (current or past-due current) with `dueOn ≤ today + days`.
  - Seed helpers: `seedRecurring(db): { spotifyId: number; rentId: number }` (Spotify CAD 1299 monthly anchored `2026-09-05` pattern `spotify` category null; Rent CAD 180000 monthly anchored `2026-09-01` pattern null), `seedRecurringTransactions(db)` (two Spotify outflows on CHQ: `sp-1` `2026-08-05` −1299 "SPOTIFY P1234", `sp-2` `2026-09-05` −1299 "SPOTIFY P1234", plus `sp-near` `2026-09-06` −1250 "Spotify family" which is within 10% and same period).

- [ ] **Step 1: Write the seed helper**

`tests/helpers/seed2b.ts`:

```ts
import type { Db } from "@/lib/db/client";
import { externalDebts, debtPayments, recurringCosts, transactions } from "@/lib/db/schema";

const ISO = "2026-09-09T12:00:00.000Z";

export function seedRecurring(db: Db): { spotifyId: number; rentId: number } {
  const spotify = db.insert(recurringCosts).values({
    name: "Spotify", provider: "Spotify", currency: "CAD", amountCents: 1299, cadence: "monthly", anchorOn: "2026-09-05",
    matchPattern: "spotify", matchToleranceBps: 1000, active: true, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: recurringCosts.id }).get();
  const rent = db.insert(recurringCosts).values({
    name: "Rent", currency: "CAD", amountCents: 180000, cadence: "monthly", anchorOn: "2026-09-01",
    matchToleranceBps: 1000, active: true, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: recurringCosts.id }).get();
  return { spotifyId: spotify.id, rentId: rent.id };
}

function sec(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);
}

/** Spotify outflows on CHQ (seedBasic must have run). */
export function seedRecurringTransactions(db: Db): void {
  const row = (id: string, date: string, amountCents: number, description: string, payee: string | null) => ({
    id, accountId: "CHQ", posted: sec(date), transactedAt: null, amountCents, description, payee, memo: null, pending: false, raw: "{}",
    firstSeenAt: ISO, lastSeenAt: ISO, localDate: date,
  });
  db.insert(transactions).values([
    row("sp-1", "2026-08-05", -1299, "SPOTIFY P1234", "Spotify AB"),
    row("sp-2", "2026-09-05", -1299, "SPOTIFY P1234", "Spotify AB"),
    row("sp-near", "2026-09-06", -1250, "Spotify family", null),
  ]).run();
}

export function seedDebts(db: Db): { couchId: number; loanId: number } {
  const couch = db.insert(externalDebts).values({
    name: "Couch", lender: "Affirm", currency: "CAD", kind: "bnpl", principalCents: 40000, openedOn: "2026-09-01",
    instalmentAmountCents: 10000, cadence: "biweekly", firstInstalmentOn: "2026-09-01", instalmentCount: 4, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: externalDebts.id }).get();
  const loan = db.insert(externalDebts).values({
    name: "Student loan", lender: "OSAP", currency: "CAD", kind: "loan", principalCents: 1500000, openedOn: "2020-09-01", dueDay: 15, aprBps: 0, createdAt: ISO, updatedAt: ISO,
  }).returning({ id: externalDebts.id }).get();
  db.insert(debtPayments).values({ debtId: couch.id, paidOn: "2026-09-01", amountCents: 10000, createdAt: ISO }).run();
  return { couchId: couch.id, loanId: loan.id };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/integration/recurring.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic } from "../helpers/seed";
import { seedRecurring, seedRecurringTransactions } from "../helpers/seed2b";
import type { Db } from "@/lib/db/client";
import {
  validateRecurringInput, listRecurringCosts, createRecurringCost, updateRecurringCost, setRecurringActive, deleteRecurringCost,
  listRecurringWithStatus, previewPatternMatches, upcomingRecurring, getRecurringCost,
} from "@/lib/queries/recurring";
import { setRecurring } from "@/lib/queries/meta";

let db: Db;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
});

const TODAY = "2026-09-09";

describe("validation and CRUD", () => {
  it("validates input", () => {
    const ok = { name: "Netflix", currency: "CAD", amountCents: 1699, cadence: "monthly" as const, anchorOn: "2026-09-12" };
    expect(validateRecurringInput(ok)).toBeNull();
    expect(validateRecurringInput({ ...ok, name: " " })).toMatch(/name/i);
    expect(validateRecurringInput({ ...ok, amountCents: 0 })).toMatch(/amount/i);
    expect(validateRecurringInput({ ...ok, anchorOn: "2026-9-1" })).toMatch(/date/i);
    expect(validateRecurringInput({ ...ok, cadence: "custom_days" })).toMatch(/interval/i);
    expect(validateRecurringInput({ ...ok, cadence: "custom_days", intervalDays: 45 })).toBeNull();
    expect(validateRecurringInput({ ...ok, matchToleranceBps: 20000 })).toMatch(/tolerance/i);
  });
  it("creates, updates, deactivates, deletes", () => {
    const c = createRecurringCost(db, { name: "Netflix", provider: "Netflix", currency: "CAD", amountCents: 1699, cadence: "monthly", anchorOn: "2026-09-12", matchPattern: "netflix" });
    expect(c.id).toBeGreaterThan(0);
    expect(getRecurringCost(db, c.id)?.matchToleranceBps).toBe(1000);
    updateRecurringCost(db, c.id, { name: "Netflix", currency: "CAD", amountCents: 1899, cadence: "monthly", anchorOn: "2026-09-12", matchPattern: null });
    expect(getRecurringCost(db, c.id)).toMatchObject({ amountCents: 1899, matchPattern: null });
    setRecurringActive(db, c.id, false);
    expect(listRecurringCosts(db)).toHaveLength(0);
    expect(listRecurringCosts(db, { includeInactive: true })).toHaveLength(1);
    deleteRecurringCost(db, c.id);
    expect(listRecurringCosts(db, { includeInactive: true })).toHaveLength(0);
  });
  it("rejects invalid input on create", () => {
    expect(() => createRecurringCost(db, { name: "", currency: "CAD", amountCents: 1, cadence: "weekly", anchorOn: "2026-09-01" })).toThrow(/name/i);
  });
});

describe("status", () => {
  it("reports due, paid via a linked transaction, and overdue", () => {
    const { spotifyId, rentId } = seedRecurring(db);
    seedRecurringTransactions(db);
    let rows = listRecurringWithStatus(db, { today: TODAY });
    const spotify = rows.find((r) => r.id === spotifyId)!;
    expect(spotify.dueOn).toBe("2026-09-05");
    expect(spotify.status).toBe("overdue"); // nothing linked yet; due date passed
    expect(spotify.monthlyEquivalentCents).toBe(1299);
    setRecurring(db, "sp-2", spotifyId);
    rows = listRecurringWithStatus(db, { today: TODAY });
    expect(rows.find((r) => r.id === spotifyId)).toMatchObject({ status: "paid", matched: { transactionId: "sp-2", localDate: "2026-09-05", amountCents: -1299 } });
    const rent = rows.find((r) => r.id === rentId)!;
    expect(rent.dueOn).toBe("2026-09-01");
    expect(rent.status).toBe("overdue");
    expect(listRecurringWithStatus(db, { today: "2026-08-30" }).find((r) => r.id === rentId)).toMatchObject({ dueOn: "2026-09-01", status: "due" });
  });
  it("sorts by due date then name and hides inactive by default", () => {
    const { rentId } = seedRecurring(db);
    setRecurringActive(db, rentId, false);
    const rows = listRecurringWithStatus(db, { today: TODAY });
    expect(rows.map((r) => r.name)).toEqual(["Spotify"]);
    expect(listRecurringWithStatus(db, { today: TODAY, includeInactive: true }).map((r) => r.name)).toEqual(["Rent", "Spotify"]);
  });
});

describe("previewPatternMatches", () => {
  it("counts outflows matching pattern and tolerance without writing", () => {
    seedRecurringTransactions(db);
    const r = previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: null, matchPattern: "spotify", matchToleranceBps: 1000 });
    expect(r.count).toBe(3); // sp-1, sp-2, sp-near (1250 is within 10%)
    expect(r.sample.map((s) => s.id)).toEqual(["sp-near", "sp-2", "sp-1"]); // newest first
    expect(previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: null, matchPattern: "spotify", matchToleranceBps: 100 }).count).toBe(2);
    expect(previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: "VISA", matchPattern: "spotify", matchToleranceBps: 1000 }).count).toBe(0);
    expect(previewPatternMatches(db, { currency: "CAD", amountCents: 1299, accountId: null, matchPattern: "  ", matchToleranceBps: 1000 }).count).toBe(0);
  });
});

describe("upcomingRecurring", () => {
  it("lists unpaid periods due within the window, including overdue ones", () => {
    const { spotifyId } = seedRecurring(db);
    let items = upcomingRecurring(db, { today: TODAY, days: 7 });
    expect(items.map((i) => [i.name, i.dueOn, i.status])).toEqual([["Rent", "2026-09-01", "overdue"], ["Spotify", "2026-09-05", "overdue"]]);
    seedRecurringTransactions(db);
    setRecurring(db, "sp-2", spotifyId);
    items = upcomingRecurring(db, { today: TODAY, days: 7 });
    expect(items.map((i) => i.name)).toEqual(["Rent"]);
    // 30 days ahead: Rent's next period (10-01) is not yet current on 09-09 (its period opens 09-24), so still one item.
    expect(upcomingRecurring(db, { today: "2026-09-25", days: 7 }).map((i) => [i.name, i.dueOn])).toEqual([["Rent", "2026-10-01"]]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/integration/recurring.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `src/lib/queries/recurring.ts`**

```ts
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, CADENCES, recurringCosts, transactionMeta, transactions, type Cadence, type RecurringCostRow } from "../db/schema";
import { isDateString, addDays } from "../time";
import { currentIndex, dueAt, monthlyEquivalentCents, periodWindow, recurringStatus, type RecurringStatus } from "../recurring/schedule";

export type RecurringInput = {
  name: string;
  provider?: string | null;
  currency: string;
  amountCents: number;
  cadence: Cadence;
  intervalDays?: number | null;
  anchorOn: string;
  categoryId?: number | null;
  accountId?: string | null;
  matchPattern?: string | null;
  matchToleranceBps?: number;
  active?: boolean;
  notes?: string | null;
};

export class RecurringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurringError";
  }
}

const now = () => new Date().toISOString();

export function validateRecurringInput(input: RecurringInput): string | null {
  if (!input.name.trim()) return "A recurring cost needs a name.";
  if (!input.currency.trim()) return "Choose a currency.";
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return "The expected amount must be more than zero.";
  if (!(CADENCES as readonly string[]).includes(input.cadence)) return "Choose how often it recurs.";
  if (input.cadence === "custom_days" && (!input.intervalDays || !Number.isInteger(input.intervalDays) || input.intervalDays <= 0)) return "A custom cadence needs an interval in days.";
  if (!isDateString(input.anchorOn)) return "The due date must be a real date (YYYY-MM-DD).";
  const bps = input.matchToleranceBps ?? 1000;
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return "The match tolerance must be between 0% and 100%.";
  return null;
}

function toRow(input: RecurringInput, nowIso: string) {
  const pattern = input.matchPattern?.trim() ?? "";
  return {
    name: input.name.trim(),
    provider: input.provider?.trim() || null,
    currency: input.currency.trim(),
    amountCents: input.amountCents,
    cadence: input.cadence,
    intervalDays: input.cadence === "custom_days" ? (input.intervalDays ?? null) : null,
    anchorOn: input.anchorOn,
    categoryId: input.categoryId ?? null,
    accountId: input.accountId || null,
    matchPattern: pattern || null,
    matchToleranceBps: input.matchToleranceBps ?? 1000,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
    updatedAt: nowIso,
  };
}

export function listRecurringCosts(db: Db, opts: { includeInactive?: boolean } = {}): RecurringCostRow[] {
  const q = db.select().from(recurringCosts);
  return (opts.includeInactive ? q : q.where(eq(recurringCosts.active, true))).orderBy(asc(recurringCosts.name), asc(recurringCosts.id)).all();
}

export function getRecurringCost(db: Db, id: number): RecurringCostRow | undefined {
  return db.select().from(recurringCosts).where(eq(recurringCosts.id, id)).get();
}

export function createRecurringCost(db: Db, input: RecurringInput, nowIso = now()): RecurringCostRow {
  const problem = validateRecurringInput(input);
  if (problem) throw new RecurringError(problem);
  return db.insert(recurringCosts).values({ ...toRow(input, nowIso), createdAt: nowIso }).returning().get();
}

export function updateRecurringCost(db: Db, id: number, input: RecurringInput, nowIso = now()): void {
  const problem = validateRecurringInput(input);
  if (problem) throw new RecurringError(problem);
  db.update(recurringCosts).set(toRow(input, nowIso)).where(eq(recurringCosts.id, id)).run();
}

export function setRecurringActive(db: Db, id: number, active: boolean, nowIso = now()): void {
  db.update(recurringCosts).set({ active, updatedAt: nowIso }).where(eq(recurringCosts.id, id)).run();
}

export function deleteRecurringCost(db: Db, id: number): void {
  db.delete(recurringCosts).where(eq(recurringCosts.id, id)).run();
}

export type RecurringWithStatus = RecurringCostRow & {
  dueOn: string;
  status: RecurringStatus;
  matched: { transactionId: string; localDate: string; amountCents: number } | null;
  monthlyEquivalentCents: number;
};

/** The linked transaction inside a period window, if any (manual or auto link). */
function matchedIn(db: Db, costId: number, window: { start: string; endExclusive: string }) {
  return db
    .select({ transactionId: transactions.id, localDate: transactions.localDate, amountCents: transactions.amountCents })
    .from(transactionMeta)
    .innerJoin(transactions, eq(transactions.id, transactionMeta.transactionId))
    .where(and(eq(transactionMeta.recurringCostId, costId), gte(transactions.localDate, window.start), lt(transactions.localDate, window.endExclusive)))
    .orderBy(desc(transactions.localDate))
    .get();
}

export function listRecurringWithStatus(db: Db, opts: { today: string; includeInactive?: boolean }): RecurringWithStatus[] {
  const rows = listRecurringCosts(db, { includeInactive: opts.includeInactive }).map((c) => {
    const k = currentIndex(c, opts.today);
    const dueOn = dueAt(c, k);
    const m = matchedIn(db, c.id, periodWindow(c, k));
    const matched = m && m.localDate ? { transactionId: m.transactionId, localDate: m.localDate, amountCents: m.amountCents } : null;
    return { ...c, dueOn, status: recurringStatus(dueOn, opts.today, matched !== null), matched, monthlyEquivalentCents: monthlyEquivalentCents(c.amountCents, c) };
  });
  return rows.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.name.localeCompare(b.name)));
}

/** Non-hidden outflows in the cost's currency (and account) whose text contains the pattern and whose size is within tolerance. Read-only. */
export function previewPatternMatches(
  db: Db,
  input: Pick<RecurringInput, "currency" | "amountCents" | "accountId" | "matchPattern" | "matchToleranceBps">,
  limit = 5,
): { count: number; sample: { id: string; localDate: string | null; payee: string | null; description: string; amountCents: number; currency: string }[] } {
  const pattern = input.matchPattern?.trim().toLowerCase() ?? "";
  if (!pattern) return { count: 0, sample: [] };
  const bps = input.matchToleranceBps ?? 1000;
  const lo = Math.floor(input.amountCents * (1 - bps / 10000));
  const hi = Math.ceil(input.amountCents * (1 + bps / 10000));
  const rows = db
    .select({ id: transactions.id, localDate: transactions.localDate, payee: transactions.payee, description: transactions.description, amountCents: transactions.amountCents, currency: accounts.currency })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.hidden, false),
        eq(accounts.currency, input.currency),
        input.accountId ? eq(transactions.accountId, input.accountId) : undefined,
        sql`${transactions.amountCents} < 0`,
        sql`-${transactions.amountCents} between ${lo} and ${hi}`,
        sql`(lower(coalesce(${transactions.payee}, '')) like ${"%" + pattern + "%"} or lower(${transactions.description}) like ${"%" + pattern + "%"})`,
      ),
    )
    .orderBy(desc(transactions.localDate), desc(transactions.id))
    .all();
  return { count: rows.length, sample: rows.slice(0, limit) };
}

export type UpcomingRecurring = { kind: "recurring"; id: number; name: string; provider: string | null; currency: string; amountCents: number; dueOn: string; status: RecurringStatus };

/** Active costs whose current period is unpaid and whose due date is on or before today + days (overdue ones included). */
export function upcomingRecurring(db: Db, opts: { today: string; days: number }): UpcomingRecurring[] {
  const horizon = addDays(opts.today, opts.days);
  return listRecurringWithStatus(db, { today: opts.today })
    .filter((r) => r.status !== "paid" && r.dueOn <= horizon)
    .map((r) => ({ kind: "recurring" as const, id: r.id, name: r.name, provider: r.provider, currency: r.currency, amountCents: r.amountCents, dueOn: r.dueOn, status: r.status }));
}
```

The LIKE here is a plain substring on lowercased text; the pattern comes from the owner's own form and `%`/`_` inside it would widen the match rather than break anything. Reuse phase 1's `escapeLikePattern` from `queries/transactions.ts` if it is exported; otherwise export it and use it (`escape '\\'`), so the preview and the matcher agree on literal matching.

- [ ] **Step 5: Run tests, type-check, commit**

Run: `npx vitest run tests/integration/recurring.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS. The `upcomingRecurring` last assertion depends on Rent's period math: on `2026-09-25` the current index for anchor `09-01` is the `10-01` due (its period opens `09-24`); if the value differs, trace `currentIndex` by hand and fix the wrong side, saying so in the report.

```bash
git add src/lib/queries/recurring.ts tests/helpers/seed2b.ts tests/integration/recurring.test.ts
git commit -m "feat(recurring): queries, status, pattern preview, upcoming"
```

---

### Task 5: Tagging step 6.3 — recurring matching

**Files:**
- Create: `src/lib/tagging/recurringMatch.ts`
- Modify: `src/lib/tagging/apply.ts`
- Test: `tests/unit/recurring-match.test.ts`, `tests/integration/tagging.test.ts`

**Interfaces:**
- Consumes: `nearestDueIndex`, `dueAt` (Task 2); `listRecurringCosts` (Task 4); `escapeLikePattern` not needed (matching is in TypeScript here).
- Produces:
  - `RecurringCostLike = Pick<RecurringCostRow, "id" | "currency" | "amountCents" | "cadence" | "intervalDays" | "anchorOn" | "accountId" | "matchPattern" | "matchToleranceBps" | "categoryId">`
  - `RecurringCandidate = { id: string; accountId: string; currency: string; amountCents: number; payee: string | null; description: string; localDate: string; isTransfer: boolean; hidden: boolean; pending: boolean; manualCostId: number | null }` (`manualCostId` = the cost this row is manually linked to, or null)
  - `matchRecurring(cost: RecurringCostLike, candidates: RecurringCandidate[]): { transactionId: string; dueOn: string }[]` — auto links only; a period already occupied by a manual link to this cost is skipped.
  - `apply.ts`: `Loaded` gains `localDate: string | null`; step 6.3 sets `recurringCostId`/`recurringSource = "auto"` and, when the row has no category after 6.1, `categoryId = cost.categoryId` with `categorySource = "recurring"`; `report.recurringMatched` counts rows newly auto-linked.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/recurring-match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchRecurring, type RecurringCandidate, type RecurringCostLike } from "@/lib/tagging/recurringMatch";

const spotify: RecurringCostLike = { id: 1, currency: "CAD", amountCents: 1299, cadence: "monthly", intervalDays: null, anchorOn: "2026-09-05", accountId: null, matchPattern: "spotify", matchToleranceBps: 1000, categoryId: 7 };
const c = (id: string, localDate: string, amountCents: number, over: Partial<RecurringCandidate> = {}): RecurringCandidate => ({
  id, accountId: "CHQ", currency: "CAD", amountCents, payee: "Spotify AB", description: "SPOTIFY P1234", localDate, isTransfer: false, hidden: false, pending: false, manualCostId: null, ...over,
});

describe("matchRecurring", () => {
  it("links one outflow per period, nearest to the due date", () => {
    const links = matchRecurring(spotify, [c("a", "2026-08-05", -1299), c("b", "2026-09-05", -1299), c("b2", "2026-09-06", -1250)]);
    expect(links).toEqual([{ transactionId: "a", dueOn: "2026-08-05" }, { transactionId: "b", dueOn: "2026-09-05" }]);
  });
  it("respects pattern, currency, account, tolerance, sign, transfer, hidden, pending", () => {
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { payee: "Netflix", description: "NETFLIX" })])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { currency: "USD" })])).toEqual([]);
    expect(matchRecurring({ ...spotify, accountId: "VISA" }, [c("x", "2026-09-05", -1299)])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1500)])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", 1299)])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { isTransfer: true })])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { hidden: true })])).toEqual([]);
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { pending: true })])).toEqual([]);
  });
  it("matches case-insensitively on payee or description", () => {
    expect(matchRecurring(spotify, [c("x", "2026-09-05", -1299, { payee: null, description: "spotify premium" })])).toHaveLength(1);
  });
  it("skips a period already occupied by a manual link and never returns manual rows", () => {
    const links = matchRecurring(spotify, [c("m", "2026-09-04", -1299, { manualCostId: 1 }), c("b", "2026-09-05", -1299)]);
    expect(links).toEqual([]);
    // A manual link to a *different* cost excludes only that row.
    expect(matchRecurring(spotify, [c("m", "2026-09-04", -1299, { manualCostId: 2 }), c("b", "2026-09-05", -1299)])).toEqual([{ transactionId: "b", dueOn: "2026-09-05" }]);
  });
  it("returns nothing without a pattern", () => {
    expect(matchRecurring({ ...spotify, matchPattern: null }, [c("a", "2026-09-05", -1299)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing integration tests**

Append to `tests/integration/tagging.test.ts`:

```ts
import { seedRecurring, seedRecurringTransactions } from "../helpers/seed2b";
import { setRecurring } from "@/lib/queries/meta";
import { deleteRecurringCost, updateRecurringCost } from "@/lib/queries/recurring";

describe("applyTagging recurring (6.3)", () => {
  it("links matching outflows, one per period, and reports the count", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    const r = applyTagging(db);
    expect(r.recurringMatched).toBe(2);
    expect(getMeta(db, "sp-1")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "auto" });
    expect(getMeta(db, "sp-2")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "auto" });
    expect(getMeta(db, "sp-near")?.recurringCostId ?? null).toBeNull();
    expect(applyTagging(db).recurringMatched).toBe(0); // idempotent
  });
  it("applies the cost's category when the row has none, with source recurring, and a rule still wins", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    updateRecurringCost(db, spotifyId, { name: "Spotify", currency: "CAD", amountCents: 1299, cadence: "monthly", anchorOn: "2026-09-05", matchPattern: "spotify", categoryId: dining });
    applyTagging(db);
    expect(getMeta(db, "sp-2")).toMatchObject({ categoryId: dining, categorySource: "recurring" });
    createRule(db, { field: "any", match: "contains", pattern: "spotify", categoryId: groceries });
    applyTagging(db);
    expect(getMeta(db, "sp-2")).toMatchObject({ categoryId: groceries, categorySource: "rule", recurringCostId: spotifyId });
  });
  it("a manual link survives and occupies its period", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    setRecurring(db, "sp-near", spotifyId);
    applyTagging(db);
    expect(getMeta(db, "sp-near")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "manual" });
    expect(getMeta(db, "sp-2")?.recurringCostId ?? null).toBeNull(); // September period taken by the manual link
    expect(getMeta(db, "sp-1")).toMatchObject({ recurringCostId: spotifyId, recurringSource: "auto" });
  });
  it("deleting a cost clears its auto links and recurring-sourced categories on the next pass", () => {
    const { spotifyId } = seedRecurring(db);
    seedRecurringTransactions(db);
    updateRecurringCost(db, spotifyId, { name: "Spotify", currency: "CAD", amountCents: 1299, cadence: "monthly", anchorOn: "2026-09-05", matchPattern: "spotify", categoryId: dining });
    applyTagging(db);
    deleteRecurringCost(db, spotifyId); // FK on delete set null clears recurring_cost_id
    applyTagging(db);
    expect(getMeta(db, "sp-2")).toBeUndefined();
  });
});
```

(`groceries`, `dining`, `createRule`, `getMeta`, `applyTagging`, `db` are already in scope in that file.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/recurring-match.test.ts tests/integration/tagging.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/lib/tagging/recurringMatch.ts`**

```ts
import type { RecurringCostRow } from "../db/schema";
import { dueAt, nearestDueIndex } from "../recurring/schedule";
import { daysBetween } from "../time";

export type RecurringCostLike = Pick<RecurringCostRow, "id" | "currency" | "amountCents" | "cadence" | "intervalDays" | "anchorOn" | "accountId" | "matchPattern" | "matchToleranceBps" | "categoryId">;
export type RecurringCandidate = {
  id: string;
  accountId: string;
  currency: string;
  amountCents: number;
  payee: string | null;
  description: string;
  localDate: string;
  isTransfer: boolean;
  hidden: boolean;
  pending: boolean;
  manualCostId: number | null;
};
export type RecurringLink = { transactionId: string; dueOn: string };

function textMatches(c: RecurringCandidate, needle: string): boolean {
  return (c.payee ?? "").toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle);
}

/**
 * One transaction per due date: every eligible outflow is assigned to its nearest due date; when
 * several share one, the closest wins and the rest stay unlinked. A period holding a manual link
 * to this cost is taken; manual rows themselves are never returned (the pass never rewrites them).
 */
export function matchRecurring(cost: RecurringCostLike, candidates: RecurringCandidate[]): RecurringLink[] {
  const needle = cost.matchPattern?.trim().toLowerCase() ?? "";
  if (!needle) return [];
  const lo = cost.amountCents * (1 - cost.matchToleranceBps / 10000);
  const hi = cost.amountCents * (1 + cost.matchToleranceBps / 10000);

  const taken = new Set<number>();
  for (const c of candidates) {
    if (c.manualCostId === cost.id) taken.add(nearestDueIndex(cost, c.localDate));
  }

  const byDue = new Map<number, { c: RecurringCandidate; dist: number }>();
  for (const c of candidates) {
    if (c.manualCostId !== null || c.isTransfer || c.hidden || c.pending) continue;
    if (c.currency !== cost.currency || c.amountCents >= 0) continue;
    if (cost.accountId && c.accountId !== cost.accountId) continue;
    const abs = -c.amountCents;
    if (abs < lo || abs > hi) continue;
    if (!textMatches(c, needle)) continue;
    const k = nearestDueIndex(cost, c.localDate);
    if (taken.has(k)) continue;
    const dist = Math.abs(daysBetween(dueAt(cost, k), c.localDate));
    const cur = byDue.get(k);
    if (!cur || dist < cur.dist || (dist === cur.dist && c.id < cur.c.id)) byDue.set(k, { c, dist });
  }
  return [...byDue.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, { c }]) => ({ transactionId: c.id, dueOn: dueAt(cost, k) }));
}
```

- [ ] **Step 5: Wire step 6.3 into `apply.ts`**

In `src/lib/tagging/apply.ts`:

- Import `listRecurringCosts` from `../queries/recurring` and `matchRecurring` from `./recurringMatch`.
- `Loaded` gains `localDate: string | null`; `loadAll` selects `localDate: transactions.localDate`.
- Replace the `// 6.3 recurring: filled in by plan 2b` line with:

```ts
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
```

If `listRecurringCosts(tx as unknown as Db)` does not type-check, widen `listRecurringCosts`' parameter to `Pick<Db, "select">` in `queries/recurring.ts` (same technique as `loadAll`).

- In the write loop, after the transfer counters, add: `if (b.recurringCostId !== d.recurringCostId && d.recurringSource === "auto") report.recurringMatched++;`
- `applyRules` needs no change: it already treats `categorySource !== "manual"` (including `recurring`) as overwritable and clears the category when no rule matches, which 6.3 then re-applies.

- [ ] **Step 6: Run all tests, type-check, commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS. If the `deleteRecurringCost` test finds the meta row still present, check that `recurring_cost_id`'s FK action is `set null` (it is, from migration 0001) and that the pass then treats a row with `recurringCostId null, recurringSource "auto"` as clearable: add `if (d.recurringSource === "auto" && d.recurringCostId === null) d.recurringSource = null;` at the top of the 6.3 reset loop.

```bash
git add src/lib/tagging tests/unit/recurring-match.test.ts tests/integration/tagging.test.ts
git commit -m "feat(tagging): recurring-cost matching step"
```

---

### Task 6: Debts queries and the transactions-row debt join

**Files:**
- Create: `src/lib/queries/debts.ts`
- Modify: `src/lib/queries/transactions.ts`
- Test: `tests/integration/debts.test.ts`, `tests/integration/queries.test.ts`

**Interfaces:**
- Consumes: Task 3 schedule functions; `externalDebts`, `debtPayments`, `transactions`, `accounts`, `transactionMeta` tables; `isDateString`; `seedDebts` (Task 4 helper).
- Produces:
  - `DebtInput = { name: string; lender: string; currency: string; kind: DebtKind; principalCents: number; openedOn: string; interestFreeUntil?: string | null; payoffDueOn?: string | null; aprBps?: number | null; dueDay?: number | null; instalmentAmountCents?: number | null; cadence?: Cadence | null; intervalDays?: number | null; firstInstalmentOn?: string | null; instalmentCount?: number | null; notes?: string | null }`
  - `DebtError`; `validateDebtInput(input): string | null` (schedule fields all-or-nothing: amount + cadence + first date; `custom_days` needs interval; `dueDay` 1–31; dates valid; principal > 0)
  - `listDebts(db, opts?: { includeClosed?: boolean }): ExternalDebtRow[]`; `getDebt(db, id)`; `createDebt(db, input, nowIso?)`; `updateDebt(db, id, input, nowIso?)`; `setDebtClosed(db, id, closed: boolean, nowIso?)`; `deleteDebt(db, id)`
  - `listPayments(db, debtId): DebtPaymentRow[]`; `addPayment(db, input: { debtId: number; paidOn: string; amountCents: number; note?: string | null; transactionId?: string | null }, nowIso?): DebtPaymentRow`; `deletePayment(db, paymentId)`
  - `linkTransaction(db, input: { debtId: number; transactionId: string; amountCents?: number; paidOn?: string; note?: string | null }, nowIso?): DebtPaymentRow` — defaults from the transaction (`|amount|`, `local_date`); throws `DebtError` naming the debt when the transaction already pays one.
  - `CandidateTx = { id: string; localDate: string | null; payee: string | null; description: string; amountCents: number; currency: string; accountName: string }`; `candidateTransactions(db, opts: { q?: string; amountCents?: number; limit?: number }): CandidateTx[]` — recent non-hidden outflows not yet linked to any debt; `q` is a case-insensitive substring on payee or description; `amountCents` keeps rows within 1% of it.
  - `DebtWithStatus = ExternalDebtRow & { paidCents: number; remainingCents: number; nextDue: string | null; status: DebtStatus; paymentCount: number }`; `listDebtsWithStatus(db, opts: { today: string; includeClosed?: boolean }): DebtWithStatus[]` sorted by lender (case-insensitive) then nextDue (nulls last) then name.
  - `lenders(db): string[]` distinct, sorted; `totalsRemainingByCurrency(db): { currency: string; remainingCents: number; open: number }[]` (open debts, remaining clamped at 0 per debt); `totalsByLender(db): { lender: string; currency: string; remainingCents: number; count: number }[]`
  - `UpcomingDebt = { kind: "debt"; id: number; name: string; lender: string; currency: string; amountCents: number; dueOn: string; status: DebtStatus }`; `upcomingDebts(db, opts: { today: string; days: number }): UpcomingDebt[]` — open debts whose next due is on or before today + days; `amountCents` is the instalment amount, or the remaining balance for a payoff date, or 0 for a due-day loan with no instalment amount.
  - `TxRow` gains `debtId: number | null; debtName: string | null`.

- [ ] **Step 1: Write the failing tests**

`tests/integration/debts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic } from "../helpers/seed";
import { seedDebts } from "../helpers/seed2b";
import type { Db } from "@/lib/db/client";
import {
  validateDebtInput, createDebt, updateDebt, getDebt, listDebts, setDebtClosed, deleteDebt, listPayments, addPayment, deletePayment, linkTransaction,
  candidateTransactions, listDebtsWithStatus, lenders, totalsRemainingByCurrency, totalsByLender, upcomingDebts,
} from "@/lib/queries/debts";

let db: Db;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
});
const TODAY = "2026-09-09";
const ok = { name: "Laptop", lender: "Flexiti", currency: "CAD", kind: "bnpl" as const, principalCents: 120000, openedOn: "2026-09-01", interestFreeUntil: "2027-09-01", payoffDueOn: "2027-09-01" };

describe("validation and CRUD", () => {
  it("validates", () => {
    expect(validateDebtInput(ok)).toBeNull();
    expect(validateDebtInput({ ...ok, name: "" })).toMatch(/name/i);
    expect(validateDebtInput({ ...ok, lender: " " })).toMatch(/lender/i);
    expect(validateDebtInput({ ...ok, principalCents: 0 })).toMatch(/principal/i);
    expect(validateDebtInput({ ...ok, openedOn: "nope" })).toMatch(/opened/i);
    expect(validateDebtInput({ ...ok, dueDay: 32 })).toMatch(/day of the month/i);
    expect(validateDebtInput({ ...ok, instalmentAmountCents: 1000 })).toMatch(/schedule/i);
    expect(validateDebtInput({ ...ok, instalmentAmountCents: 1000, cadence: "custom_days", firstInstalmentOn: "2026-10-01" })).toMatch(/interval/i);
    expect(validateDebtInput({ ...ok, instalmentAmountCents: 1000, cadence: "monthly", firstInstalmentOn: "2026-10-01", instalmentCount: 0 })).toMatch(/count/i);
  });
  it("creates, updates, closes, deletes", () => {
    const d = createDebt(db, ok);
    expect(getDebt(db, d.id)).toMatchObject({ name: "Laptop", lender: "Flexiti", kind: "bnpl" });
    updateDebt(db, d.id, { ...ok, notes: "12 months no interest" });
    expect(getDebt(db, d.id)?.notes).toBe("12 months no interest");
    setDebtClosed(db, d.id, true);
    expect(listDebts(db)).toHaveLength(0);
    expect(listDebts(db, { includeClosed: true })).toHaveLength(1);
    setDebtClosed(db, d.id, false);
    deleteDebt(db, d.id);
    expect(listDebts(db, { includeClosed: true })).toHaveLength(0);
  });
});

describe("payments and linking", () => {
  it("adds and deletes manual payments", () => {
    const { couchId } = seedDebts(db);
    const p = addPayment(db, { debtId: couchId, paidOn: "2026-09-15", amountCents: 10000 });
    expect(listPayments(db, couchId)).toHaveLength(2);
    deletePayment(db, p.id);
    expect(listPayments(db, couchId)).toHaveLength(1);
    expect(() => addPayment(db, { debtId: couchId, paidOn: "bad", amountCents: 1 })).toThrow(/date/i);
    expect(() => addPayment(db, { debtId: couchId, paidOn: "2026-09-15", amountCents: 0 })).toThrow(/amount/i);
  });
  it("links a transaction with defaults from it, once", () => {
    const { couchId, loanId } = seedDebts(db);
    const p = linkTransaction(db, { debtId: couchId, transactionId: "t4" });
    expect(p).toMatchObject({ debtId: couchId, transactionId: "t4", amountCents: 8000, paidOn: "2026-08-30" });
    expect(() => linkTransaction(db, { debtId: loanId, transactionId: "t4" })).toThrow(/already pays Couch/);
    const q = linkTransaction(db, { debtId: loanId, transactionId: "t2", amountCents: 1000, paidOn: "2026-09-08", note: "partial" });
    expect(q).toMatchObject({ amountCents: 1000, paidOn: "2026-09-08", note: "partial" });
    expect(() => linkTransaction(db, { debtId: loanId, transactionId: "missing" })).toThrow(/not found/i);
  });
  it("lists candidate outflows not yet linked, filtered by text and amount", () => {
    const { couchId } = seedDebts(db);
    const all = candidateTransactions(db, {});
    expect(all.map((c) => c.id)).toEqual(["t7", "t1", "t2", "t8", "t4", "t5"]); // outflows, newest first, hidden excluded
    linkTransaction(db, { debtId: couchId, transactionId: "t4" });
    expect(candidateTransactions(db, {}).map((c) => c.id)).not.toContain("t4");
    expect(candidateTransactions(db, { q: "grocery" }).map((c) => c.id)).toEqual(["t1"]);
    expect(candidateTransactions(db, { amountCents: 30000 }).map((c) => c.id)).toEqual(["t5"]);
    expect(candidateTransactions(db, { amountCents: 30200 }).map((c) => c.id)).toEqual(["t5"]); // within 1%
    expect(candidateTransactions(db, { limit: 2 })).toHaveLength(2);
  });
});

describe("status and totals", () => {
  it("computes remaining, next due, status, sorted by lender", () => {
    seedDebts(db);
    const rows = listDebtsWithStatus(db, { today: TODAY });
    expect(rows.map((r) => r.lender)).toEqual(["Affirm", "OSAP"]);
    const couch = rows[0];
    expect(couch).toMatchObject({ paidCents: 10000, remainingCents: 30000, nextDue: "2026-09-15", status: "due_soon", paymentCount: 1 });
    expect(rows[1]).toMatchObject({ remainingCents: 1500000, nextDue: "2026-09-15", status: "due_soon" });
  });
  it("lenders, totals by currency and lender", () => {
    seedDebts(db);
    createDebt(db, ok); // Flexiti, 120000
    expect(lenders(db)).toEqual(["Affirm", "Flexiti", "OSAP"]);
    expect(totalsRemainingByCurrency(db)).toEqual([{ currency: "CAD", remainingCents: 30000 + 1500000 + 120000, open: 3 }]);
    expect(totalsByLender(db).find((t) => t.lender === "Affirm")).toEqual({ lender: "Affirm", currency: "CAD", remainingCents: 30000, count: 1 });
  });
  it("excludes closed debts from totals and clamps overpayment at zero", () => {
    const { couchId, loanId } = seedDebts(db);
    addPayment(db, { debtId: couchId, paidOn: "2026-09-08", amountCents: 50000 });
    setDebtClosed(db, loanId, true);
    expect(totalsRemainingByCurrency(db)).toEqual([{ currency: "CAD", remainingCents: 0, open: 1 }]);
    expect(listDebtsWithStatus(db, { today: TODAY })[0].status).toBe("paid_off");
  });
  it("upcoming debts within the window", () => {
    seedDebts(db);
    createDebt(db, ok); // payoff 2027-09-01, not upcoming
    const items = upcomingDebts(db, { today: TODAY, days: 7 });
    expect(items.map((i) => [i.name, i.dueOn, i.amountCents])).toEqual([["Couch", "2026-09-15", 10000], ["Student loan", "2026-09-15", 0]]);
    expect(upcomingDebts(db, { today: TODAY, days: 2 })).toEqual([]);
  });
});
```

Append to `tests/integration/queries.test.ts`:

```ts
import { seedDebts } from "../helpers/seed2b";
import { linkTransaction } from "@/lib/queries/debts";

describe("transactions know which debt they pay", () => {
  it("joins the debt name", () => {
    const { couchId } = seedDebts(db);
    linkTransaction(db, { debtId: couchId, transactionId: "t4" });
    const rows = listTransactions(db, { pageSize: 100 }).rows;
    expect(rows.find((r) => r.id === "t4")).toMatchObject({ debtId: couchId, debtName: "Couch" });
    expect(rows.find((r) => r.id === "t1")).toMatchObject({ debtId: null, debtName: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/debts.test.ts tests/integration/queries.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/queries/debts.ts`**

```ts
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, CADENCES, DEBT_KINDS, debtPayments, externalDebts, transactions, type Cadence, type DebtKind, type DebtPaymentRow, type ExternalDebtRow } from "../db/schema";
import { addDays, isDateString } from "../time";
import { debtStatus, hasSchedule, nextDue, projectedInstalments, remainingCents as rawRemaining, type DebtStatus } from "../debts/schedule";

export type DebtInput = {
  name: string;
  lender: string;
  currency: string;
  kind: DebtKind;
  principalCents: number;
  openedOn: string;
  interestFreeUntil?: string | null;
  payoffDueOn?: string | null;
  aprBps?: number | null;
  dueDay?: number | null;
  instalmentAmountCents?: number | null;
  cadence?: Cadence | null;
  intervalDays?: number | null;
  firstInstalmentOn?: string | null;
  instalmentCount?: number | null;
  notes?: string | null;
};

export class DebtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebtError";
  }
}

const now = () => new Date().toISOString();

export function validateDebtInput(i: DebtInput): string | null {
  if (!i.name.trim()) return "A debt needs a name.";
  if (!i.lender.trim()) return "Say who the lender is.";
  if (!i.currency.trim()) return "Choose a currency.";
  if (!(DEBT_KINDS as readonly string[]).includes(i.kind)) return "Choose the kind of debt.";
  if (!Number.isInteger(i.principalCents) || i.principalCents <= 0) return "The principal must be more than zero.";
  if (!isDateString(i.openedOn)) return "The opened date must be a real date (YYYY-MM-DD).";
  for (const [label, v] of [["interest-free-until", i.interestFreeUntil], ["payoff due", i.payoffDueOn], ["first instalment", i.firstInstalmentOn]] as const) {
    if (v && !isDateString(v)) return `The ${label} date must be a real date (YYYY-MM-DD).`;
  }
  if (i.aprBps != null && (!Number.isInteger(i.aprBps) || i.aprBps < 0)) return "APR cannot be negative.";
  if (i.dueDay != null && (!Number.isInteger(i.dueDay) || i.dueDay < 1 || i.dueDay > 31)) return "The due day must be a day of the month, 1 to 31.";
  const scheduleParts = [i.instalmentAmountCents != null, i.cadence != null, i.firstInstalmentOn != null];
  const some = scheduleParts.some(Boolean);
  const all = scheduleParts.every(Boolean);
  if (some && !all) return "A schedule needs the instalment amount, how often, and the first instalment date together.";
  if (all) {
    if (!Number.isInteger(i.instalmentAmountCents) || i.instalmentAmountCents! <= 0) return "The instalment amount must be more than zero.";
    if (!(CADENCES as readonly string[]).includes(i.cadence!)) return "Choose how often instalments fall.";
    if (i.cadence === "custom_days" && (!i.intervalDays || i.intervalDays <= 0)) return "A custom cadence needs an interval in days.";
    if (i.instalmentCount != null && (!Number.isInteger(i.instalmentCount) || i.instalmentCount <= 0)) return "The instalment count must be a positive whole number, or blank for until paid off.";
  }
  return null;
}

function toRow(i: DebtInput, nowIso: string) {
  const scheduled = i.instalmentAmountCents != null && i.cadence != null && i.firstInstalmentOn != null;
  return {
    name: i.name.trim(),
    lender: i.lender.trim(),
    currency: i.currency.trim(),
    kind: i.kind,
    principalCents: i.principalCents,
    openedOn: i.openedOn,
    interestFreeUntil: i.interestFreeUntil || null,
    payoffDueOn: i.payoffDueOn || null,
    aprBps: i.aprBps ?? null,
    dueDay: i.dueDay ?? null,
    instalmentAmountCents: scheduled ? i.instalmentAmountCents! : null,
    cadence: scheduled ? i.cadence! : null,
    intervalDays: scheduled && i.cadence === "custom_days" ? (i.intervalDays ?? null) : null,
    firstInstalmentOn: scheduled ? i.firstInstalmentOn! : null,
    instalmentCount: scheduled ? (i.instalmentCount ?? null) : null,
    notes: i.notes?.trim() || null,
    updatedAt: nowIso,
  };
}

export function listDebts(db: Db, opts: { includeClosed?: boolean } = {}): ExternalDebtRow[] {
  const q = db.select().from(externalDebts);
  return (opts.includeClosed ? q : q.where(isNull(externalDebts.closedAt))).orderBy(asc(sql`lower(${externalDebts.lender})`), asc(externalDebts.name)).all();
}

export function getDebt(db: Db, id: number): ExternalDebtRow | undefined {
  return db.select().from(externalDebts).where(eq(externalDebts.id, id)).get();
}

export function createDebt(db: Db, input: DebtInput, nowIso = now()): ExternalDebtRow {
  const problem = validateDebtInput(input);
  if (problem) throw new DebtError(problem);
  return db.insert(externalDebts).values({ ...toRow(input, nowIso), createdAt: nowIso }).returning().get();
}

export function updateDebt(db: Db, id: number, input: DebtInput, nowIso = now()): void {
  const problem = validateDebtInput(input);
  if (problem) throw new DebtError(problem);
  db.update(externalDebts).set(toRow(input, nowIso)).where(eq(externalDebts.id, id)).run();
}

export function setDebtClosed(db: Db, id: number, closed: boolean, nowIso = now()): void {
  db.update(externalDebts).set({ closedAt: closed ? nowIso : null, updatedAt: nowIso }).where(eq(externalDebts.id, id)).run();
}

export function deleteDebt(db: Db, id: number): void {
  db.delete(externalDebts).where(eq(externalDebts.id, id)).run();
}

export function listPayments(db: Db, debtId: number): DebtPaymentRow[] {
  return db.select().from(debtPayments).where(eq(debtPayments.debtId, debtId)).orderBy(asc(debtPayments.paidOn), asc(debtPayments.id)).all();
}

export function addPayment(db: Db, input: { debtId: number; paidOn: string; amountCents: number; note?: string | null; transactionId?: string | null }, nowIso = now()): DebtPaymentRow {
  if (!isDateString(input.paidOn)) throw new DebtError("The payment date must be a real date (YYYY-MM-DD).");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new DebtError("The payment amount must be more than zero.");
  if (!getDebt(db, input.debtId)) throw new DebtError("That debt no longer exists.");
  return db
    .insert(debtPayments)
    .values({ debtId: input.debtId, paidOn: input.paidOn, amountCents: input.amountCents, note: input.note?.trim() || null, transactionId: input.transactionId ?? null, createdAt: nowIso })
    .returning()
    .get();
}

export function deletePayment(db: Db, paymentId: number): void {
  db.delete(debtPayments).where(eq(debtPayments.id, paymentId)).run();
}

/** Set a bank transaction against a debt. Amount and date default to the transaction's; one transaction pays at most one debt. */
export function linkTransaction(db: Db, input: { debtId: number; transactionId: string; amountCents?: number; paidOn?: string; note?: string | null }, nowIso = now()): DebtPaymentRow {
  const tx = db.select({ amountCents: transactions.amountCents, localDate: transactions.localDate }).from(transactions).where(eq(transactions.id, input.transactionId)).get();
  if (!tx) throw new DebtError("That transaction was not found.");
  const existing = db
    .select({ name: externalDebts.name })
    .from(debtPayments)
    .innerJoin(externalDebts, eq(externalDebts.id, debtPayments.debtId))
    .where(eq(debtPayments.transactionId, input.transactionId))
    .get();
  if (existing) throw new DebtError(`That transaction already pays ${existing.name}.`);
  return addPayment(
    db,
    { debtId: input.debtId, paidOn: input.paidOn ?? tx.localDate ?? nowIso.slice(0, 10), amountCents: input.amountCents ?? Math.abs(tx.amountCents), note: input.note, transactionId: input.transactionId },
    nowIso,
  );
}

export type CandidateTx = { id: string; localDate: string | null; payee: string | null; description: string; amountCents: number; currency: string; accountName: string };

/** Recent non-hidden outflows not yet set against any debt. */
export function candidateTransactions(db: Db, opts: { q?: string; amountCents?: number; limit?: number }): CandidateTx[] {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 20));
  const q = opts.q?.trim().toLowerCase();
  const parts = [
    eq(accounts.hidden, false),
    sql`${transactions.amountCents} < 0`,
    isNull(debtPayments.id),
    q ? sql`(lower(coalesce(${transactions.payee}, '')) like ${"%" + q + "%"} or lower(${transactions.description}) like ${"%" + q + "%"})` : undefined,
    opts.amountCents ? sql`abs(-${transactions.amountCents} - ${opts.amountCents}) <= ${Math.ceil(opts.amountCents / 100)}` : undefined,
  ];
  return db
    .select({
      id: transactions.id,
      localDate: transactions.localDate,
      payee: transactions.payee,
      description: transactions.description,
      amountCents: transactions.amountCents,
      currency: accounts.currency,
      accountName: sql<string>`coalesce(nullif(trim(${accounts.nickname}), ''), ${accounts.name})`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(debtPayments, eq(debtPayments.transactionId, transactions.id))
    .where(and(...parts))
    .orderBy(desc(transactions.localDate), desc(transactions.id))
    .limit(limit)
    .all();
}

export type DebtWithStatus = ExternalDebtRow & { paidCents: number; remainingCents: number; nextDue: string | null; status: DebtStatus; paymentCount: number };

export function listDebtsWithStatus(db: Db, opts: { today: string; includeClosed?: boolean }): DebtWithStatus[] {
  const rows = listDebts(db, { includeClosed: opts.includeClosed }).map((d) => {
    const payments = listPayments(db, d.id);
    const paid = payments.reduce((n, p) => n + p.amountCents, 0);
    return { ...d, paidCents: paid, remainingCents: Math.max(0, rawRemaining(d, payments)), nextDue: nextDue(d, payments, opts.today), status: debtStatus(d, payments, opts.today), paymentCount: payments.length };
  });
  return rows.sort((a, b) => {
    const l = a.lender.toLowerCase().localeCompare(b.lender.toLowerCase());
    if (l !== 0) return l;
    if (a.nextDue !== b.nextDue) {
      if (a.nextDue === null) return 1;
      if (b.nextDue === null) return -1;
      return a.nextDue < b.nextDue ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function lenders(db: Db): string[] {
  return db.selectDistinct({ lender: externalDebts.lender }).from(externalDebts).orderBy(asc(externalDebts.lender)).all().map((r) => r.lender);
}

export function totalsRemainingByCurrency(db: Db): { currency: string; remainingCents: number; open: number }[] {
  const out = new Map<string, { remainingCents: number; open: number }>();
  for (const d of listDebts(db)) {
    const payments = listPayments(db, d.id);
    const cur = out.get(d.currency) ?? { remainingCents: 0, open: 0 };
    cur.remainingCents += Math.max(0, rawRemaining(d, payments));
    cur.open += 1;
    out.set(d.currency, cur);
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, ...v }));
}

export function totalsByLender(db: Db): { lender: string; currency: string; remainingCents: number; count: number }[] {
  const out = new Map<string, { lender: string; currency: string; remainingCents: number; count: number }>();
  for (const d of listDebts(db)) {
    const key = `${d.lender.toLowerCase()}|${d.currency}`;
    const cur = out.get(key) ?? { lender: d.lender, currency: d.currency, remainingCents: 0, count: 0 };
    cur.remainingCents += Math.max(0, rawRemaining(d, listPayments(db, d.id)));
    cur.count += 1;
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => a.lender.toLowerCase().localeCompare(b.lender.toLowerCase()) || a.currency.localeCompare(b.currency));
}

export type UpcomingDebt = { kind: "debt"; id: number; name: string; lender: string; currency: string; amountCents: number; dueOn: string; status: DebtStatus };

export function upcomingDebts(db: Db, opts: { today: string; days: number }): UpcomingDebt[] {
  const horizon = addDays(opts.today, opts.days);
  const items: UpcomingDebt[] = [];
  for (const d of listDebtsWithStatus(db, { today: opts.today })) {
    if (d.status === "paid_off" || !d.nextDue || d.nextDue > horizon) continue;
    let amountCents = 0;
    if (hasSchedule(d)) {
      const open = projectedInstalments(d, listPayments(db, d.id), opts.today).find((i) => i.paidCents < i.amountCents);
      amountCents = open ? open.amountCents - open.paidCents : 0;
    } else if (d.payoffDueOn && d.nextDue === d.payoffDueOn) {
      amountCents = d.remainingCents;
    }
    items.push({ kind: "debt", id: d.id, name: d.name, lender: d.lender, currency: d.currency, amountCents, dueOn: d.nextDue, status: d.status });
  }
  return items.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.name.localeCompare(b.name)));
}
```

`selectDistinct` exists on Drizzle's SQLite builder; if it does not type-check in this version, use `db.select({ lender: externalDebts.lender }).from(externalDebts).groupBy(externalDebts.lender)`.

- [ ] **Step 4: Join the debt name into `TxRow`**

In `src/lib/queries/transactions.ts`: import `debtPayments`, `externalDebts`; `TxRow` gains `debtId: number | null; debtName: string | null`; the rows query adds `.leftJoin(debtPayments, eq(debtPayments.transactionId, transactions.id)).leftJoin(externalDebts, eq(externalDebts.id, debtPayments.debtId))`, selects `debtId: debtPayments.debtId, debtName: externalDebts.name`, and maps `debtId: r.debtId ?? null, debtName: r.debtName ?? null`. The count query does not need the join (one payment per transaction, so no row multiplication either way).

- [ ] **Step 5: Run all tests, type-check, commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS. Check the `candidateTransactions` ordering assertion against the seed (`t7` pending snack has `localDate` today; `t1` day 1; `t2` day 2; `t8` day 5; `t4` day 10; `t5` day 40) — if `t8` (USD) should be excluded by a currency rule, note that the picker is deliberately currency-agnostic and the page shows the currency.

```bash
git add src/lib/queries/debts.ts src/lib/queries/transactions.ts tests/integration/debts.test.ts tests/integration/queries.test.ts
git commit -m "feat(debts): queries, payments, transaction linking, status and totals"
```

---

### Task 7: Budget month

**Files:**
- Create: `src/lib/budget/month.ts`
- Test: `tests/integration/budget.test.ts`

**Interfaces:**
- Consumes: `monthBounds`, `monthKey`, `daysInMonth`, `daysBetween` (Task 1); `categories`, `transactions`, `transactionMeta`, `accounts`; `notTransfer` from `queries/transactions`.
- Produces:
  - `PaceState = "on_pace" | "over_pace" | "over_cap"`; `PACE_WORDS: Record<PaceState, string>` = on pace / ahead of pace / over.
  - `BudgetMonth = { year: number; month: number; key: string; startDate: string; endDate: string; daysInMonth: number; daysElapsed: number; capped: { categoryId: number; name: string; currency: string; capCents: number; spentCents: number; remainingCents: number; paceCents: number; paceState: PaceState }[]; uncapped: { categoryId: number; name: string; currency: string; spentCents: number }[]; uncategorised: { currency: string; spentCents: number; count: number }[]; income: { categoryId: number; name: string; currency: string; inflowCents: number }[]; totals: { currency: string; capCents: number; spentCents: number }[] }`
  - `budgetMonth(db, opts: { year: number; month: number; tz: string; today: string }): BudgetMonth`
  - `budgetMonthRange(db, today: string): { earliest: string; latest: string }` (month keys; `earliest` = month of the earliest `local_date`, or the current month when there are no transactions).

- [ ] **Step 1: Write the failing tests**

`tests/integration/budget.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "../helpers/db";
import { seedBasic, seedTransferPair } from "../helpers/seed";
import type { Db } from "@/lib/db/client";
import { createCategory, updateCategory } from "@/lib/queries/categories";
import { setCategory, setTransfer } from "@/lib/queries/meta";
import { budgetMonth, budgetMonthRange } from "@/lib/budget/month";

let db: Db;
let groceries: number;
let dining: number;
let income: number;
beforeEach(() => {
  db = makeTestDb();
  seedBasic(db);
  groceries = createCategory(db, { name: "Groceries", kind: "expense" }).id;
  dining = createCategory(db, { name: "Dining", kind: "expense" }).id;
  income = createCategory(db, { name: "Income", kind: "income" }).id;
  updateCategory(db, groceries, { monthlyCapCents: 10000, capCurrency: "CAD" });
  setCategory(db, "t1", groceries); // -4510 on 2026-09-08
  setCategory(db, "t2", dining); // -1200 on 2026-09-07
  setCategory(db, "t3", income); // +250000 on 2026-09-06
});
const TZ = "America/Toronto";

describe("budgetMonth", () => {
  it("reports caps, spend, pace, uncapped, uncategorised, income, totals", () => {
    const b = budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" });
    expect(b).toMatchObject({ key: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30", daysInMonth: 30, daysElapsed: 9 });
    expect(b.capped).toEqual([{ categoryId: groceries, name: "Groceries", currency: "CAD", capCents: 10000, spentCents: 4510, remainingCents: 5490, paceCents: 3000, paceState: "over_pace" }]);
    expect(b.uncapped).toEqual([{ categoryId: dining, name: "Dining", currency: "CAD", spentCents: 1200 }]);
    // t7 pending snack (-500, 09-09) and t4 gas (-8000, 08-30 → not this month) → uncategorised this month is just t7
    expect(b.uncategorised).toEqual([{ currency: "CAD", spentCents: 500, count: 1 }]);
    expect(b.income).toEqual([{ categoryId: income, name: "Income", currency: "CAD", inflowCents: 250000 }]);
    expect(b.totals).toEqual([{ currency: "CAD", capCents: 10000, spentCents: 4510 }]);
  });
  it("pace states", () => {
    updateCategory(db, groceries, { monthlyCapCents: 4000, capCurrency: "CAD" });
    expect(budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" }).capped[0].paceState).toBe("over_cap");
    updateCategory(db, groceries, { monthlyCapCents: 20000, capCurrency: "CAD" });
    expect(budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" }).capped[0].paceState).toBe("on_pace"); // pace 6000 ≥ 4510
  });
  it("past months use the full month for pace; future months have zero days elapsed", () => {
    expect(budgetMonth(db, { year: 2026, month: 8, tz: TZ, today: "2026-09-09" }).daysElapsed).toBe(31);
    expect(budgetMonth(db, { year: 2026, month: 10, tz: TZ, today: "2026-09-09" }).daysElapsed).toBe(0);
  });
  it("excludes transfers and hidden accounts", () => {
    seedTransferPair(db);
    setTransfer(db, "xfer-out", true);
    const b = budgetMonth(db, { year: 2026, month: 9, tz: TZ, today: "2026-09-09" });
    expect(b.uncategorised).toEqual([{ currency: "CAD", spentCents: 500, count: 1 }]); // xfer-out (-75000) and t6 (hidden) absent
  });
  it("month range", () => {
    expect(budgetMonthRange(db, "2026-09-09")).toEqual({ earliest: "2026-07", latest: "2026-09" }); // t5 is 2026-07-31
    expect(budgetMonthRange(makeTestDb(), "2026-09-09")).toEqual({ earliest: "2026-09", latest: "2026-09" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/budget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/budget/month.ts`**

```ts
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, categories, transactionMeta, transactions } from "../db/schema";
import { notTransfer } from "../queries/transactions";
import { daysBetween, daysInMonth, monthBounds, monthKey } from "../time";

export type PaceState = "on_pace" | "over_pace" | "over_cap";
export const PACE_WORDS: Record<PaceState, string> = { on_pace: "on pace", over_pace: "ahead of pace", over_cap: "over" };

export type BudgetMonth = {
  year: number;
  month: number;
  key: string;
  startDate: string;
  endDate: string;
  daysInMonth: number;
  daysElapsed: number;
  capped: { categoryId: number; name: string; currency: string; capCents: number; spentCents: number; remainingCents: number; paceCents: number; paceState: PaceState }[];
  uncapped: { categoryId: number; name: string; currency: string; spentCents: number }[];
  uncategorised: { currency: string; spentCents: number; count: number }[];
  income: { categoryId: number; name: string; currency: string; inflowCents: number }[];
  totals: { currency: string; capCents: number; spentCents: number }[];
};

export function budgetMonth(db: Db, opts: { year: number; month: number; tz: string; today: string }): BudgetMonth {
  const b = monthBounds(opts.year, opts.month, opts.tz);
  const dim = daysInMonth(opts.year, opts.month);
  const daysElapsed = opts.today < b.startDate ? 0 : opts.today > b.endDate ? dim : daysBetween(b.startDate, opts.today) + 1;

  const inMonth = and(eq(accounts.hidden, false), notTransfer, gte(transactions.localDate, b.startDate), lte(transactions.localDate, b.endDate));
  const outflow = sql<number>`sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end)`.mapWith(Number);
  const inflow = sql<number>`sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end)`.mapWith(Number);
  const outCount = sql<number>`sum(case when ${transactions.amountCents} < 0 then 1 else 0 end)`.mapWith(Number);

  const sums = db
    .select({ categoryId: transactionMeta.categoryId, currency: accounts.currency, outflowCents: outflow, inflowCents: inflow, outCount })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionMeta, eq(transactionMeta.transactionId, transactions.id))
    .where(inMonth)
    .groupBy(transactionMeta.categoryId, accounts.currency)
    .all();

  const cats = db.select().from(categories).orderBy(categories.sortOrder, categories.id).all();
  const capped: BudgetMonth["capped"] = [];
  const uncapped: BudgetMonth["uncapped"] = [];
  const income: BudgetMonth["income"] = [];
  const totals = new Map<string, { capCents: number; spentCents: number }>();

  for (const c of cats) {
    const rows = sums.filter((s) => s.categoryId === c.id);
    if (c.kind === "income") {
      for (const r of rows) if (r.inflowCents > 0) income.push({ categoryId: c.id, name: c.name, currency: r.currency, inflowCents: r.inflowCents });
      continue;
    }
    if (c.monthlyCapCents !== null && c.capCurrency) {
      const spent = rows.filter((r) => r.currency === c.capCurrency).reduce((n, r) => n + r.outflowCents, 0);
      const paceCents = Math.round((c.monthlyCapCents * daysElapsed) / dim);
      const paceState: PaceState = spent > c.monthlyCapCents ? "over_cap" : spent > paceCents ? "over_pace" : "on_pace";
      capped.push({ categoryId: c.id, name: c.name, currency: c.capCurrency, capCents: c.monthlyCapCents, spentCents: spent, remainingCents: c.monthlyCapCents - spent, paceCents, paceState });
      const t = totals.get(c.capCurrency) ?? { capCents: 0, spentCents: 0 };
      t.capCents += c.monthlyCapCents;
      t.spentCents += spent;
      totals.set(c.capCurrency, t);
      // Spend in other currencies under a capped category is still spend: list it as uncapped.
      for (const r of rows) if (r.currency !== c.capCurrency && r.outflowCents > 0) uncapped.push({ categoryId: c.id, name: c.name, currency: r.currency, spentCents: r.outflowCents });
    } else {
      for (const r of rows) if (r.outflowCents > 0) uncapped.push({ categoryId: c.id, name: c.name, currency: r.currency, spentCents: r.outflowCents });
    }
  }
  uncapped.sort((a, b) => a.currency.localeCompare(b.currency) || b.spentCents - a.spentCents);

  const uncategorised = sums
    .filter((s) => s.categoryId === null && s.outflowCents > 0)
    .map((s) => ({ currency: s.currency, spentCents: s.outflowCents, count: s.outCount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    year: opts.year,
    month: opts.month,
    key: monthKey(b.startDate),
    startDate: b.startDate,
    endDate: b.endDate,
    daysInMonth: dim,
    daysElapsed,
    capped,
    uncapped,
    uncategorised,
    income,
    totals: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, t]) => ({ currency, ...t })),
  };
}

/** Navigable months: from the earliest transaction's month to the current month. */
export function budgetMonthRange(db: Db, today: string): { earliest: string; latest: string } {
  const row = db.select({ min: sql<string | null>`min(${transactions.localDate})` }).from(transactions).get();
  const latest = monthKey(today);
  const earliest = row?.min ? monthKey(row.min) : latest;
  return { earliest: earliest < latest ? earliest : latest, latest };
}
```

- [ ] **Step 4: Run tests, type-check, commit**

Run: `npx vitest run tests/integration/budget.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS. `daysElapsed` for 2026-09-09 is 9 (the 1st through the 9th inclusive); pace = round(10000 × 9 / 30) = 3000.

```bash
git add src/lib/budget/month.ts tests/integration/budget.test.ts
git commit -m "feat(budget): month caps, spend, pace"
```

---

### Task 8: API — summary additions and `GET /api/v1/upcoming`

**Files:**
- Modify: `src/lib/api/summary.ts`, `src/app/api/v1/summary/route.ts`
- Create: `src/app/api/v1/upcoming/route.ts`
- Test: `tests/api/routes.test.ts`, `tests/api/handlers.test.ts`

**Interfaces:**
- Consumes: `totalsRemainingByCurrency`, `upcomingDebts` (Task 6); `upcomingRecurring` (Task 4); `budgetMonth`, `parseMonthKey` (Tasks 7, 1).
- Produces:
  - `buildSummary(db, opts: { tz: string; nowMs?: number }): SummaryPayload` where `SummaryPayload` gains `debts: { remaining: { currency: string; remainingCents: number }[]; open: number }` and `budget: { month: string; totals: { currency: string; capCents: number; spentCents: number }[] }`.
  - `UPCOMING_MAX_DAYS = 60`, `UPCOMING_DEFAULT_DAYS = 7`; `UpcomingItem = UpcomingRecurring | UpcomingDebt`; `UpcomingPayload = { generatedAt: string; today: string; days: number; items: UpcomingItem[] }` sorted by `dueOn` then name; `buildUpcoming(db, opts: { tz: string; days: number; nowMs?: number }): UpcomingPayload`.
  - `GET /api/v1/upcoming?days=N`: 400 `{ error: "days must be a whole number from 1 to 60" }` when invalid; default 7.

- [ ] **Step 1: Write the failing tests**

In `tests/api/routes.test.ts`, change every `buildSummary(db, T0)` / `buildSummary(makeTestDb(), T0)` call to `buildSummary(db, { tz: "UTC", nowMs: T0 })` and add:

```ts
import { seedDebts, seedRecurring } from "../helpers/seed2b";
import { createCategory, updateCategory } from "@/lib/queries/categories";
import { setCategory } from "@/lib/queries/meta";
import { buildUpcoming } from "@/lib/api/summary";

describe("buildSummary phase 2", () => {
  it("adds debts and the budget month", () => {
    const db = makeTestDb();
    seedBasic(db);
    seedDebts(db);
    const g = createCategory(db, { name: "Groceries", kind: "expense" }).id;
    updateCategory(db, g, { monthlyCapCents: 10000, capCurrency: "CAD" });
    setCategory(db, "t1", g);
    const s = buildSummary(db, { tz: "UTC", nowMs: T0 });
    expect(s.debts).toEqual({ remaining: [{ currency: "CAD", remainingCents: 1530000 }], open: 2 });
    expect(s.budget).toEqual({ month: "2026-09", totals: [{ currency: "CAD", capCents: 10000, spentCents: 4510 }] });
  });
  it("empty database", () => {
    const s = buildSummary(makeTestDb(), { tz: "UTC", nowMs: T0 });
    expect(s.debts).toEqual({ remaining: [], open: 0 });
    expect(s.budget.totals).toEqual([]);
  });
});

describe("buildUpcoming", () => {
  it("merges recurring and debt items sorted by due date", () => {
    const db = makeTestDb();
    seedBasic(db);
    seedRecurring(db);
    seedDebts(db);
    const u = buildUpcoming(db, { tz: "UTC", days: 7, nowMs: T0 });
    expect(u.today).toBe("2026-09-09");
    expect(u.days).toBe(7);
    expect(u.items.map((i) => [i.kind, i.name, i.dueOn])).toEqual([
      ["recurring", "Rent", "2026-09-01"],
      ["recurring", "Spotify", "2026-09-05"],
      ["debt", "Couch", "2026-09-15"],
      ["debt", "Student loan", "2026-09-15"],
    ]);
    expect(Object.keys(u)).toEqual(["generatedAt", "today", "days", "items"]);
  });
});
```

In `tests/api/handlers.test.ts`, following the existing mock pattern (mock `@/lib/api/summary`'s `buildUpcoming` **or** use a real in-memory db via the mocked `getDb`; the real db is simpler here):

```ts
import { GET as upcomingGET } from "@/app/api/v1/upcoming/route";

describe("GET /api/v1/upcoming", () => {
  it("rejects without a key", async () => {
    vi.mocked(loadConfig).mockReturnValue(baseConfig);
    expect((await upcomingGET(req("http://x/api/v1/upcoming"))).status).toBe(401);
  });
  it("validates days", async () => {
    vi.mocked(loadConfig).mockReturnValue(baseConfig);
    vi.mocked(getDb).mockReturnValue(createDb(":memory:"));
    for (const bad of ["0", "61", "abc", "2.5"]) {
      const res = await upcomingGET(req(`http://x/api/v1/upcoming?days=${bad}`, { headers: { "x-api-key": "k" } }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "days must be a whole number from 1 to 60" });
    }
  });
  it("defaults to 7 days and returns the payload", async () => {
    vi.mocked(loadConfig).mockReturnValue(baseConfig);
    vi.mocked(getDb).mockReturnValue(createDb(":memory:"));
    const res = await upcomingGET(req("http://x/api/v1/upcoming", { headers: { "x-api-key": "k" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ days: 7, items: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/api/summary.ts`:

```ts
import { totalsRemainingByCurrency, upcomingDebts, type UpcomingDebt } from "../queries/debts";
import { upcomingRecurring, type UpcomingRecurring } from "../queries/recurring";
import { budgetMonth } from "../budget/month";
import { parseMonthKey, monthKey } from "../time";

export type SummaryPayload = {
  generatedAt: string;
  lastSync: { finishedAt: string | null; status: string } | null;
  credentialsInvalid: boolean;
  totals: { currency: string; balanceCents: number }[];
  accounts: { id: string; name: string; type: string | null; currency: string; balanceCents: number; balanceDate: number }[];
  debts: { remaining: { currency: string; remainingCents: number }[]; open: number };
  budget: { month: string; totals: { currency: string; capCents: number; spentCents: number }[] };
};

export function buildSummary(db: Db, opts: { tz: string; nowMs?: number }): SummaryPayload {
  const nowMs = opts.nowMs ?? Date.now();
  const today = todayLocal(opts.tz, nowMs);
  const { year, month } = parseMonthKey(monthKey(today))!;
  const status = getSyncStatus(db);
  const debtTotals = totalsRemainingByCurrency(db);
  const b = budgetMonth(db, { year, month, tz: opts.tz, today });
  return {
    generatedAt: new Date(nowMs).toISOString(),
    lastSync: status.latest ? { finishedAt: status.latest.finishedAt, status: status.latest.status } : null,
    credentialsInvalid: Boolean(status.credentialsInvalid),
    totals: totalsByCurrency(db),
    accounts: listAccounts(db).map((a) => ({ id: a.id, name: displayName(a), type: a.type, currency: a.currency, balanceCents: a.balanceCents, balanceDate: a.balanceDate })),
    debts: { remaining: debtTotals.map(({ currency, remainingCents }) => ({ currency, remainingCents })), open: debtTotals.reduce((n, t) => n + t.open, 0) },
    budget: { month: b.key, totals: b.totals },
  };
}

export const UPCOMING_MAX_DAYS = 60;
export const UPCOMING_DEFAULT_DAYS = 7;
export type UpcomingItem = UpcomingRecurring | UpcomingDebt;
export type UpcomingPayload = { generatedAt: string; today: string; days: number; items: UpcomingItem[] };

export function buildUpcoming(db: Db, opts: { tz: string; days: number; nowMs?: number }): UpcomingPayload {
  const nowMs = opts.nowMs ?? Date.now();
  const today = todayLocal(opts.tz, nowMs);
  const items: UpcomingItem[] = [...upcomingRecurring(db, { today, days: opts.days }), ...upcomingDebts(db, { today, days: opts.days })];
  items.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.name.localeCompare(b.name)));
  return { generatedAt: new Date(nowMs).toISOString(), today, days: opts.days, items };
}
```

(Keep the existing spending code in the file; adjust imports.) `src/app/api/v1/summary/route.ts`: pass `{ tz: config.timezone }`.

`src/app/api/v1/upcoming/route.ts`:

```ts
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { authorise, unauthorised } from "@/lib/api/auth";
import { withApiErrors } from "@/lib/api/handler";
import { buildUpcoming, UPCOMING_DEFAULT_DAYS, UPCOMING_MAX_DAYS } from "@/lib/api/summary";

export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (req: Request) => {
  const config = loadConfig();
  const auth = authorise(req, config);
  if (!auth.ok) return unauthorised(auth);
  const raw = new URL(req.url).searchParams.get("days");
  let days = UPCOMING_DEFAULT_DAYS;
  if (raw !== null) {
    if (!/^\d+$/.test(raw)) return Response.json({ error: `days must be a whole number from 1 to ${UPCOMING_MAX_DAYS}` }, { status: 400 });
    days = Number(raw);
    if (days < 1 || days > UPCOMING_MAX_DAYS) return Response.json({ error: `days must be a whole number from 1 to ${UPCOMING_MAX_DAYS}` }, { status: 400 });
  }
  return Response.json(buildUpcoming(getDb(), { tz: config.timezone, days }));
});
```

- [ ] **Step 4: Run all tests, type-check, commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS. The debts total in the summary test is 30000 (couch remaining) + 1500000 (loan).

```bash
git add src/lib/api/summary.ts src/app/api/v1 tests/api
git commit -m "feat(api): summary debts and budget, GET /api/v1/upcoming"
```

---

### Task 9: Nav, Budget page, fill rule, month switcher

**Files:**
- Modify: `src/components/Nav.tsx`, `src/app/globals.css`
- Create: `src/components/FillRule.tsx`, `src/components/MonthSwitcher.tsx`, `src/app/budget/page.tsx`, `src/app/budget/actions.ts`

**Interfaces:**
- Consumes: `budgetMonth`, `budgetMonthRange`, `PACE_WORDS` (Task 7); `parseMonthKey`, `monthKey`, `addMonths`, `todayLocal` (Task 1 / 2a); `updateCategory`, `listCategories`, `dominantCurrency`; `StatusWord`, `Amount`, `EmptyState`.
- Produces: `FillRule({ spentCents, capCents })`; `MonthSwitcher({ current, earliest, latest, basePath })`; server action `setCategoryCapAction(formData)` (fields `id`, `cap` dollars or blank, `capCurrency`, `month`); URL `/budget?month=YYYY-MM`.

- [ ] **Step 1: Nav and CSS**

`src/components/Nav.tsx` `links`:

```ts
const links = [
  ["/", "Overview"],
  ["/transactions", "Transactions"],
  ["/spending", "Spending"],
  ["/budget", "Budget"],
  ["/recurring", "Recurring"],
  ["/debts", "Debts"],
  ["/explorer", "Explorer"],
  ["/settings", "Settings"],
] as const;
```

Append to `src/app/globals.css`:

```css
/* Phase 2b: month switcher, lender group rows, fill rule cell. */
.month-switcher {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin: 0.5rem 0 0;
}
.month-switcher .button[aria-disabled="true"] {
  opacity: 0.4;
  pointer-events: none;
}
.ledger-group td {
  font-weight: 600;
  border-top: 1px solid var(--ink-2);
}
.ledger-fill {
  min-width: 10rem;
  vertical-align: middle;
}
```

- [ ] **Step 2: Components**

`src/components/FillRule.tsx`:

```tsx
/** Budget progress as a 3px rule: paper track, ink for the spent fraction, oxblood for spend past the cap. */
export function FillRule({ spentCents, capCents }: { spentCents: number; capCents: number }) {
  if (capCents <= 0) return null;
  const within = Math.min(spentCents, capCents) / capCents;
  const over = spentCents > capCents ? Math.min((spentCents - capCents) / capCents, 1) : 0;
  // Over-cap spend is drawn from the right edge back toward the cap tick, capped at the full width.
  return (
    <div className="fill-rule" role="img" aria-label={`${Math.round((spentCents / capCents) * 100)}% of cap`}>
      <span className="fill-rule-bar" style={{ width: `${(within * (1 - over)) * 100}%` }} />
      {over > 0 ? <span className="fill-rule-over" style={{ width: `${over * 100}%` }} /> : null}
    </div>
  );
}
```

`src/components/MonthSwitcher.tsx`:

```tsx
import Link from "next/link";
import { addMonths } from "@/lib/time";

function label(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function MonthSwitcher({ current, earliest, latest, basePath }: { current: string; earliest: string; latest: string; basePath: string }) {
  const prev = addMonths(`${current}-01`, -1).slice(0, 7);
  const next = addMonths(`${current}-01`, 1).slice(0, 7);
  const canPrev = prev >= earliest;
  const canNext = next <= latest;
  return (
    <nav className="month-switcher" aria-label="Month">
      <Link className="button" href={canPrev ? `${basePath}?month=${prev}` : "#"} aria-disabled={!canPrev}>
        Previous month
      </Link>
      <span>{label(current)}</span>
      <Link className="button" href={canNext ? `${basePath}?month=${next}` : "#"} aria-disabled={!canNext}>
        Next month
      </Link>
    </nav>
  );
}
```

- [ ] **Step 3: Server action**

`src/app/budget/actions.ts`:

```ts
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
```

- [ ] **Step 4: Budget page**

`src/app/budget/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { budgetMonth, budgetMonthRange, PACE_WORDS, type PaceState } from "@/lib/budget/month";
import { listCategories, dominantCurrency } from "@/lib/queries/categories";
import { monthKey, parseMonthKey, todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { FillRule } from "@/components/FillRule";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { StatusWord, type StatusTone } from "@/components/StatusWord";
import { setCategoryCapAction } from "./actions";

export const dynamic = "force-dynamic";

const PACE_TONE: Record<PaceState, StatusTone> = { on_pace: "good", over_pace: "attention", over_cap: "bad" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const tz = loadConfig().timezone;
  const today = todayLocal(tz);
  const range = budgetMonthRange(db, today);
  const requested = first(sp.month);
  const parsed = requested ? parseMonthKey(requested) : null;
  const key = parsed && requested! >= range.earliest && requested! <= range.latest ? requested! : monthKey(today);
  const { year, month } = parseMonthKey(key)!;
  const b = budgetMonth(db, { year, month, tz, today });
  const currency = dominantCurrency(db) ?? "CAD";
  const categories = listCategories(db).filter((c) => c.kind === "expense");
  const error = first(sp.error);
  const saved = first(sp.saved);
  const isCurrent = key === monthKey(today);
  const daysLeft = b.daysInMonth - b.daysElapsed;

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">Budget</h1>
          <p className="section-meta">{isCurrent ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` : b.daysElapsed === 0 ? "not started" : "month closed"}</p>
        </div>
        <MonthSwitcher current={key} earliest={range.earliest} latest={range.latest} basePath="/budget" />
        {b.totals.length > 0 ? (
          b.totals.map((t) => (
            <div key={t.currency} className="hero-figure">
              <p className="stamp">
                <Amount cents={t.spentCents} currency={t.currency} signColour={false} />
                <span className="stamp-currency">{t.currency}</span>
              </p>
              <p className="hero-note">
                of <Amount cents={t.capCents} currency={t.currency} signColour={false} /> capped this month
                {t.spentCents > t.capCents ? ", over by " : ", "}
                <Amount cents={Math.abs(t.capCents - t.spentCents)} currency={t.currency} signColour={false} />
                {t.spentCents > t.capCents ? "." : " left."}
              </p>
            </div>
          ))
        ) : (
          <p className="hero-note">No caps yet. Set a monthly cap on a category below and this becomes your month at a glance.</p>
        )}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Capped categories</h2>
          <p className="section-meta">spent against cap, {PACE_WORDS.on_pace} means under the day-of-month share</p>
        </div>
        {b.capped.length === 0 ? (
          <EmptyState title="No category has a cap.">Add one in the form on any row below.</EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="ledger-num">Spent</th>
                  <th scope="col" className="ledger-num">Cap</th>
                  <th scope="col" className="ledger-num">Left</th>
                  <th scope="col">Pace</th>
                  <th scope="col" className="ledger-fill"><span className="sr-only">Progress</span></th>
                  <th scope="col"><span className="sr-only">Edit cap</span></th>
                </tr>
              </thead>
              <tbody>
                {b.capped.map((c) => (
                  <tr key={c.categoryId}>
                    <td>
                      <Link href={`/transactions?category=${c.categoryId}&from=${b.startDate}&to=${b.endDate}`}>{c.name}</Link>
                    </td>
                    <td className="ledger-num"><Amount cents={c.spentCents} currency={c.currency} signColour={false} /></td>
                    <td className="ledger-num"><Amount cents={c.capCents} currency={c.currency} signColour={false} /></td>
                    <td className="ledger-num"><Amount cents={c.remainingCents} currency={c.currency} /></td>
                    <td><StatusWord tone={PACE_TONE[c.paceState]}>{PACE_WORDS[c.paceState]}</StatusWord></td>
                    <td className="ledger-fill"><FillRule spentCents={c.spentCents} capCents={c.capCents} /></td>
                    <td className="row-actions">
                      <form action={setCategoryCapAction} className="inline-form">
                        <input type="hidden" name="id" value={c.categoryId} />
                        <input type="hidden" name="month" value={key} />
                        <input type="hidden" name="capCurrency" value={c.currency} />
                        <input name="cap" inputMode="decimal" defaultValue={(c.capCents / 100).toFixed(2)} aria-label={`Monthly cap for ${c.name}`} className="inline-select" />
                        <button type="submit" className="row-action">Save cap</button>
                        {saved === String(c.categoryId) ? <span className="small">Saved</span> : null}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Other spending</h2>
          <p className="section-meta">categories without a cap</p>
        </div>
        {b.uncapped.length === 0 && b.uncategorised.length === 0 ? (
          <EmptyState title="Nothing else went out this month." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="ledger-num">Spent</th>
                  <th scope="col"><span className="sr-only">Set cap</span></th>
                </tr>
              </thead>
              <tbody>
                {b.uncapped.map((c) => (
                  <tr key={`${c.categoryId}-${c.currency}`}>
                    <td>
                      <Link href={`/transactions?category=${c.categoryId}&from=${b.startDate}&to=${b.endDate}`}>{c.name}</Link>
                    </td>
                    <td className="ledger-num"><Amount cents={c.spentCents} currency={c.currency} signColour={false} /></td>
                    <td className="row-actions">
                      <form action={setCategoryCapAction} className="inline-form">
                        <input type="hidden" name="id" value={c.categoryId} />
                        <input type="hidden" name="month" value={key} />
                        <input type="hidden" name="capCurrency" value={c.currency} />
                        <input name="cap" inputMode="decimal" placeholder="set a cap" aria-label={`Monthly cap for ${c.name}`} className="inline-select" />
                        <button type="submit" className="row-action">Save cap</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {b.uncategorised.map((u) => (
                  <tr key={`none-${u.currency}`}>
                    <td>
                      <Link href={`/transactions?category=none&from=${b.startDate}&to=${b.endDate}`}>Uncategorised</Link>{" "}
                      <span className="small">{u.count === 1 ? "1 transaction" : `${u.count} transactions`}</span>
                    </td>
                    <td className="ledger-num"><Amount cents={u.spentCents} currency={u.currency} signColour={false} /></td>
                    <td className="row-actions">
                      <Link className="row-action" href="/settings/rules">Add a rule</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {categories.some((c) => !b.capped.find((x) => x.categoryId === c.id) && !b.uncapped.find((x) => x.categoryId === c.id)) ? (
          <p className="small">Categories with no spending this month are not listed; set their caps under <Link href="/settings/categories">Settings</Link>.</p>
        ) : null}
      </section>

      {b.income.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Income</h2>
          </div>
          <div className="ledger-scroll">
            <table className="ledger">
              <tbody>
                {b.income.map((i) => (
                  <tr key={`${i.categoryId}-${i.currency}`}>
                    <td>{i.name}</td>
                    <td className="ledger-num"><Amount cents={i.inflowCents} currency={i.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="footnote">
        Months run from the 1st to the last day in {tz}. Transfers between your own accounts and hidden accounts are left out. Pace compares
        what you have spent so far with the cap scaled to the days elapsed. Caps are per category in {currency} unless you set them otherwise
        under Settings.
      </p>
    </>
  );
}
```

`StatusWord` must export `StatusTone` (it does, from 2a). The inline cap input reuses `.inline-select` for the text-with-bottom-rule look; if an `<input>` needs different padding, add `.inline-input { … }` mirroring `.inline-select` in the CSS step rather than styling inline.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`. Browser check on a scratch DB (port 3100): open `/budget`, set a cap on a category with spend, confirm the row moves to Capped categories with a fill rule and a pace word, navigate to the previous month and back, confirm the switcher disables at the range ends, and the category link opens the filtered transaction list. Screenshot `task-9-budget.png` into the plan workspace. Stop the server, delete the scratch copy and any `.playwright-mcp/`.

```bash
git add src/components/Nav.tsx src/components/FillRule.tsx src/components/MonthSwitcher.tsx src/app/budget src/app/globals.css
git commit -m "feat(budget): month page with caps, pace, fill rule; nav links"
```

---

### Task 10: Recurring page

**Files:**
- Create: `src/app/recurring/page.tsx`, `src/app/recurring/actions.ts`

**Interfaces:**
- Consumes: Task 4 queries; `listCategories`, `listAccounts`, `displayName`; `CADENCES`; `applyTagging`; `formatCents`; `StatusWord`, `EmptyState`, `Amount`.
- Produces: server actions `createRecurringAction`, `updateRecurringAction`, `setRecurringActiveAction`, `deleteRecurringAction` — each re-runs `applyTagging` and revalidates `/`, `/recurring`, `/transactions`, `/budget`; URL params `?edit=N`, `?inactive=1`, `?preview=1&…form fields…`, `?error=`, `?saved=`.

- [ ] **Step 1: Actions**

`src/app/recurring/actions.ts`:

```ts
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
    const existing = getDb();
    updateRecurringCost(existing, id, { ...inputFrom(fd), active: fd.get("active") === "on" });
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
```

- [ ] **Step 2: Page**

`src/app/recurring/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { listRecurringWithStatus, getRecurringCost, previewPatternMatches, type RecurringInput } from "@/lib/queries/recurring";
import { listCategories, dominantCurrency } from "@/lib/queries/categories";
import { listAccounts, displayName } from "@/lib/queries/accounts";
import { CADENCES, type Cadence } from "@/lib/db/schema";
import { formatCents } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import type { RecurringStatus } from "@/lib/recurring/schedule";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { StatusWord, type StatusTone } from "@/components/StatusWord";
import { createRecurringAction, updateRecurringAction, setRecurringActiveAction, deleteRecurringAction } from "./actions";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<Cadence, string> = { weekly: "every week", biweekly: "every two weeks", monthly: "every month", yearly: "every year", custom_days: "every N days" };
const TONE: Record<RecurringStatus, StatusTone> = { paid: "good", due: "neutral", overdue: "bad" };

function previewInputFrom(sp: SearchParams): (RecurringInput & { active?: boolean }) | null {
  if (first(sp.preview) !== "1") return null;
  const cadence = first(sp.cadence) ?? "monthly";
  const money = (v?: string) => (v ? Math.round(Number(v.replace(/[,$\s]/g, "")) * 100) : 0);
  const tol = first(sp.tolerance);
  return {
    name: first(sp.name) ?? "",
    provider: first(sp.provider) ?? null,
    currency: first(sp.currency) ?? "CAD",
    amountCents: money(first(sp.amount)),
    cadence: (CADENCES as readonly string[]).includes(cadence) ? (cadence as Cadence) : "monthly",
    intervalDays: first(sp.intervalDays) ? Number(first(sp.intervalDays)) : null,
    anchorOn: first(sp.anchorOn) ?? "",
    categoryId: first(sp.category) ? Number(first(sp.category)) : null,
    accountId: first(sp.account) ?? null,
    matchPattern: first(sp.matchPattern) ?? null,
    matchToleranceBps: tol ? Math.round(Number(tol) * 100) : 1000,
    notes: first(sp.notes) ?? null,
    active: first(sp.active) === "on",
  };
}

export default async function RecurringPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const today = todayLocal(loadConfig().timezone);
  const showInactive = first(sp.inactive) === "1";
  const rows = listRecurringWithStatus(db, { today, includeInactive: showInactive });
  const categories = listCategories(db);
  const catName = new Map(listCategories(db, { includeArchived: true }).map((c) => [c.id, c.name]));
  const accounts = listAccounts(db, { includeHidden: true });
  const currency = dominantCurrency(db) ?? "CAD";
  const error = first(sp.error);
  const saved = first(sp.saved);
  const editId = first(sp.edit) && /^\d+$/.test(first(sp.edit)!) ? Number(first(sp.edit)) : null;
  const editing = editId !== null ? getRecurringCost(db, editId) : undefined;
  const previewInput = previewInputFrom(sp);
  const preview = previewInput ? previewPatternMatches(db, previewInput) : null;

  const totals = new Map<string, number>();
  for (const r of rows) if (r.active) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.monthlyEquivalentCents);

  const d: RecurringInput & { active?: boolean } =
    previewInput ??
    (editing
      ? { name: editing.name, provider: editing.provider, currency: editing.currency, amountCents: editing.amountCents, cadence: editing.cadence, intervalDays: editing.intervalDays, anchorOn: editing.anchorOn, categoryId: editing.categoryId, accountId: editing.accountId, matchPattern: editing.matchPattern, matchToleranceBps: editing.matchToleranceBps, notes: editing.notes, active: editing.active }
      : { name: "", currency, amountCents: 0, cadence: "monthly", anchorOn: today, matchToleranceBps: 1000 });
  const dollars = (c: number | null | undefined) => (c ? (c / 100).toFixed(2) : "");
  const formKey = editing ? `edit-${editing.id}${previewInput ? "-preview" : ""}` : previewInput ? "preview" : "new";

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">Recurring</h1>
          <p className="section-meta">{rows.filter((r) => r.active).length === 1 ? "1 commitment" : `${rows.filter((r) => r.active).length} commitments`}</p>
        </div>
        {[...totals.entries()].map(([cur, cents]) => (
          <div key={cur} className="hero-figure">
            <p className="stamp">
              <Amount cents={cents} currency={cur} signColour={false} />
              <span className="stamp-currency">{cur}</span>
            </p>
            <p className="hero-note">a month, with every commitment normalised to a monthly amount.</p>
          </div>
        ))}
        {totals.size === 0 ? <p className="hero-note">Add your subscriptions and bills below and fineants will tell you what they cost a month and which are paid.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Commitments</h2>
          <p className="section-meta">
            <Link href={showInactive ? "/recurring" : "/recurring?inactive=1"}>{showInactive ? "hide inactive" : "show inactive"}</Link>
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Nothing recurring yet.">Add a subscription or bill below.</EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Commitment</th>
                  <th scope="col" className="ledger-num">Expected</th>
                  <th scope="col">Cadence</th>
                  <th scope="col" className="ledger-date">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">Seen as</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {r.provider ? <span className="ledger-quiet"> {r.provider}</span> : null}
                      {!r.active ? <span className="small"> inactive</span> : null}
                      {r.categoryId ? <span className="small"> {catName.get(r.categoryId)}</span> : null}
                    </td>
                    <td className="ledger-num"><Amount cents={r.amountCents} currency={r.currency} signColour={false} /></td>
                    <td className="ledger-quiet">{r.cadence === "custom_days" ? `every ${r.intervalDays} days` : CADENCE_LABEL[r.cadence]}</td>
                    <td className="ledger-date">{r.dueOn}</td>
                    <td><StatusWord tone={TONE[r.status]}>{r.status}</StatusWord></td>
                    <td className="ledger-quiet">
                      {r.matched ? (
                        <Link href={`/transactions?q=${encodeURIComponent(r.matchPattern ?? r.name)}&from=${r.matched.localDate}&to=${r.matched.localDate}`}>
                          {r.matched.localDate} {formatCents(r.matched.amountCents, r.currency)}
                        </Link>
                      ) : (
                        "not seen"
                      )}
                    </td>
                    <td className="row-actions">
                      <Link className="row-action" href={`/recurring?edit=${r.id}`}>Edit</Link>
                      <form action={setRecurringActiveAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                        <button className="row-action" type="submit">{r.active ? "Deactivate" : "Activate"}</button>
                      </form>
                      <form action={deleteRecurringAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="row-action" type="submit">Delete</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{editing ? `Edit ${editing.name}` : "Add a recurring cost"}</h2>
          {editing ? (
            <p className="section-meta"><Link href="/recurring">Add a new one instead</Link></p>
          ) : null}
        </div>
        <form key={formKey} action={editing ? updateRecurringAction : createRecurringAction} className="form">
          {editing ? (
            <>
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="edit" value={editing.id} />
            </>
          ) : null}
          <div className="form-row">
            <label className="form-field">
              <span>Name</span>
              <input name="name" defaultValue={d.name} required placeholder="Phone" />
            </label>
            <label className="form-field">
              <span>Provider (optional)</span>
              <input name="provider" defaultValue={d.provider ?? ""} placeholder="Rogers" />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Expected amount</span>
              <input name="amount" inputMode="decimal" defaultValue={dollars(d.amountCents)} required />
            </label>
            <label className="form-field">
              <span>Currency</span>
              <input name="currency" defaultValue={d.currency} />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>How often</span>
              <select name="cadence" defaultValue={d.cadence}>
                {CADENCES.map((c) => (
                  <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Every N days (custom only)</span>
              <input name="intervalDays" inputMode="numeric" defaultValue={d.intervalDays ?? ""} />
            </label>
          </div>
          <label className="form-field">
            <span>A due date you know</span>
            <input type="date" name="anchorOn" defaultValue={d.anchorOn} required />
          </label>
          <div className="form-row">
            <label className="form-field">
              <span>Category (optional)</span>
              <select name="category" defaultValue={d.categoryId ?? ""}>
                <option value="">none</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Only in account (optional)</span>
              <select name="account" defaultValue={d.accountId ?? ""}>
                <option value="">any account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{displayName(a)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Matches transactions containing</span>
              <input name="matchPattern" defaultValue={d.matchPattern ?? ""} placeholder={d.provider ?? d.name ?? ""} />
            </label>
            <label className="form-field">
              <span>Amount tolerance (%)</span>
              <input name="tolerance" inputMode="decimal" defaultValue={((d.matchToleranceBps ?? 1000) / 100).toString()} />
            </label>
          </div>
          <label className="form-field">
            <span>Notes (optional)</span>
            <input name="notes" defaultValue={d.notes ?? ""} />
          </label>
          {editing ? (
            <label className="form-field">
              <span><input type="checkbox" name="active" value="on" defaultChecked={d.active ?? true} /> Active</span>
            </label>
          ) : null}
          <div className="form-actions">
            <button className="button button-primary" type="submit">{editing ? "Save recurring cost" : "Add recurring cost"}</button>
            <button className="button" type="submit" formAction="/recurring" formMethod="get" name="preview" value="1">Preview matches</button>
            {saved ? <span className="small">Saved</span> : null}
          </div>
          {preview ? (
            <div className="preview">
              <p>Would match {preview.count === 1 ? "1 transaction" : `${preview.count} transactions`}{preview.sample.length ? ", most recent first:" : "."}</p>
              {preview.sample.length ? (
                <table className="ledger">
                  <tbody>
                    {preview.sample.map((s) => (
                      <tr key={s.id}>
                        <td className="ledger-date">{s.localDate ?? ""}</td>
                        <td>{s.payee ?? s.description}</td>
                        <td className="ledger-num">{formatCents(s.amountCents, s.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </form>
      </section>

      <p className="footnote">
        A commitment is paid for a period when a matching transaction lands from a week before its due date until a week before the next one.
        Matching uses the text and a tolerance around the expected amount. Monthly figures normalise weekly and yearly costs to a month.
      </p>
    </>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`. Browser check on a scratch DB: open `/recurring`, add a commitment whose pattern matches something in the scratch data (preview first, confirm count and rows, then Add), confirm the ledger shows it with a status word and "Seen as" filled if the current period has a match, Edit → Preview keeps the edit heading and Save does not duplicate, Deactivate hides it until "show inactive". Screenshot `task-10-recurring.png` into the workspace. Stop the server, delete the scratch copy and `.playwright-mcp/`. No payees or amounts in the report.

```bash
git add src/app/recurring
git commit -m "feat(recurring): commitments page with status, add/edit with preview"
```

---

### Task 11: Debts pages, transaction picker, and the transactions-row link

**Files:**
- Create: `src/app/debts/page.tsx`, `src/app/debts/actions.ts`, `src/app/debts/[id]/page.tsx`, `src/app/debts/link/page.tsx`
- Modify: `src/components/TransactionsTable.tsx`

**Interfaces:**
- Consumes: Task 6 queries; `DEBT_KINDS`, `CADENCES`; `projectedInstalments`, `DEBT_STATUS_WORDS` (Task 3); `TxRow.debtId/debtName`; `formatCents`; `StatusWord`, `Amount`, `EmptyState`.
- Produces: server actions `createDebtAction`, `updateDebtAction`, `setDebtClosedAction`, `deleteDebtAction`, `addPaymentAction`, `deletePaymentAction`, `linkTransactionAction` (fields `debtId`, `transactionId`, optional `amount`, `paidOn`, `note`, `returnTo`); URLs `/debts`, `/debts/[id]?q=&amount=` (picker search), `/debts/link?tx=<id>&returnTo=<path>`.

- [ ] **Step 1: Actions**

`src/app/debts/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { CADENCES, DEBT_KINDS, type Cadence, type DebtKind } from "@/lib/db/schema";
import { createDebt, updateDebt, setDebtClosed, deleteDebt, addPayment, deletePayment, linkTransaction, DebtError, type DebtInput } from "@/lib/queries/debts";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function intOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function moneyOrNull(fd: FormData, k: string): number | null {
  const s = str(fd, k).replace(/[,$\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function safeReturn(raw: FormDataEntryValue | null, fallback: string): string {
  const s = String(raw ?? "");
  return /^\/(?![/\\])/.test(s) ? s : fallback;
}
function revalidate(id?: number): void {
  for (const p of ["/", "/debts", "/transactions"]) revalidatePath(p);
  revalidatePath("/accounts/[id]", "page");
  if (id) revalidatePath(`/debts/${id}`);
}
function fail(path: string, err: unknown): never {
  const message = err instanceof DebtError ? err.message : "Something went wrong saving that.";
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

function inputFrom(fd: FormData): DebtInput {
  const kind = str(fd, "kind");
  const cadence = str(fd, "cadence");
  const apr = str(fd, "apr");
  return {
    name: str(fd, "name"),
    lender: str(fd, "lender"),
    currency: str(fd, "currency") || "CAD",
    kind: (DEBT_KINDS as readonly string[]).includes(kind) ? (kind as DebtKind) : "other",
    principalCents: moneyOrNull(fd, "principal") ?? 0,
    openedOn: str(fd, "openedOn"),
    interestFreeUntil: str(fd, "interestFreeUntil") || null,
    payoffDueOn: str(fd, "payoffDueOn") || null,
    aprBps: apr ? Math.round(Number(apr) * 100) : null,
    dueDay: intOrNull(fd, "dueDay"),
    instalmentAmountCents: moneyOrNull(fd, "instalmentAmount"),
    cadence: cadence && (CADENCES as readonly string[]).includes(cadence) ? (cadence as Cadence) : null,
    intervalDays: intOrNull(fd, "intervalDays"),
    firstInstalmentOn: str(fd, "firstInstalmentOn") || null,
    instalmentCount: intOrNull(fd, "instalmentCount"),
    notes: str(fd, "notes") || null,
  };
}

export async function createDebtAction(fd: FormData): Promise<void> {
  let id = 0;
  try {
    id = createDebt(getDb(), inputFrom(fd)).id;
  } catch (e) {
    fail("/debts", e);
  }
  revalidate(id);
  redirect(`/debts/${id}`);
}

export async function updateDebtAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id)) redirect("/debts");
  try {
    updateDebt(getDb(), id, inputFrom(fd));
  } catch (e) {
    fail(`/debts/${id}?edit=1`, e);
  }
  revalidate(id);
  redirect(`/debts/${id}?saved=1`);
}

export async function setDebtClosedAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) {
    setDebtClosed(getDb(), id, str(fd, "closed") === "1");
    revalidate(id);
  }
  redirect(`/debts/${id}`);
}

export async function deleteDebtAction(fd: FormData): Promise<void> {
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) {
    deleteDebt(getDb(), id);
    revalidate();
  }
  redirect("/debts");
}

export async function addPaymentAction(fd: FormData): Promise<void> {
  const debtId = Number(str(fd, "debtId"));
  if (!Number.isInteger(debtId)) redirect("/debts");
  try {
    addPayment(getDb(), { debtId, paidOn: str(fd, "paidOn"), amountCents: moneyOrNull(fd, "amount") ?? 0, note: str(fd, "note") || null });
  } catch (e) {
    fail(`/debts/${debtId}`, e);
  }
  revalidate(debtId);
  redirect(`/debts/${debtId}?saved=payment`);
}

export async function deletePaymentAction(fd: FormData): Promise<void> {
  const debtId = Number(str(fd, "debtId"));
  const paymentId = Number(str(fd, "paymentId"));
  if (Number.isInteger(paymentId)) {
    deletePayment(getDb(), paymentId);
    revalidate(debtId);
  }
  redirect(`/debts/${debtId}`);
}

export async function linkTransactionAction(fd: FormData): Promise<void> {
  const debtId = Number(str(fd, "debtId"));
  const transactionId = str(fd, "transactionId");
  const back = safeReturn(fd.get("returnTo"), `/debts/${debtId}`);
  if (!Number.isInteger(debtId) || !transactionId) redirect(back);
  try {
    linkTransaction(getDb(), { debtId, transactionId, amountCents: moneyOrNull(fd, "amount") ?? undefined, paidOn: str(fd, "paidOn") || undefined, note: str(fd, "note") || null });
  } catch (e) {
    fail(back, e);
  }
  revalidate(debtId);
  redirect(`${back}${back.includes("?") ? "&" : "?"}saved=link`);
}
```

- [ ] **Step 2: Debts list page**

`src/app/debts/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { listDebtsWithStatus, lenders, totalsRemainingByCurrency, totalsByLender } from "@/lib/queries/debts";
import { dominantCurrency } from "@/lib/queries/categories";
import { DEBT_KINDS, CADENCES, type Cadence, type DebtKind } from "@/lib/db/schema";
import { DEBT_STATUS_WORDS, type DebtStatus } from "@/lib/debts/schedule";
import { todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { StatusWord, type StatusTone } from "@/components/StatusWord";
import { createDebtAction } from "./actions";
import { DEBT_TONE, KIND_LABEL, CADENCE_LABEL } from "./labels";

export const dynamic = "force-dynamic";

export default async function DebtsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const today = todayLocal(loadConfig().timezone);
  const showClosed = first(sp.closed) === "1";
  const rows = listDebtsWithStatus(db, { today, includeClosed: showClosed });
  const totals = totalsRemainingByCurrency(db);
  const byLender = totalsByLender(db);
  const knownLenders = lenders(db);
  const currency = dominantCurrency(db) ?? "CAD";
  const error = first(sp.error);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.lender.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">Debts</h1>
          <p className="section-meta">{totals.reduce((n, t) => n + t.open, 0) === 1 ? "1 open" : `${totals.reduce((n, t) => n + t.open, 0)} open`}</p>
        </div>
        {totals.map((t) => (
          <div key={t.currency} className="hero-figure">
            <p className="stamp">
              <Amount cents={t.remainingCents} currency={t.currency} signColour={false} />
              <span className="stamp-currency">{t.currency}</span>
            </p>
            <p className="hero-note">still owed outside your bank accounts. Not counted in net worth.</p>
          </div>
        ))}
        {totals.length === 0 ? <p className="hero-note">Nothing owed outside your accounts. Add a plan or loan below to track it.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">By lender</h2>
          <p className="section-meta">
            <Link href={showClosed ? "/debts" : "/debts?closed=1"}>{showClosed ? "hide closed" : "show closed"}</Link>
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No debts recorded." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Debt</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="ledger-num">Remaining</th>
                  <th scope="col" className="ledger-date">Next due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...groups.values()].map((list) => {
                  const lender = list[0].lender;
                  const subtotal = byLender.filter((t) => t.lender.toLowerCase() === lender.toLowerCase());
                  return (
                    <Fragment key={lender}>
                      {list.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link href={`/debts/${r.id}`}>{r.name}</Link> <span className="ledger-quiet">{r.lender}</span>
                            {r.closedAt ? <span className="small"> closed</span> : null}
                          </td>
                          <td className="ledger-quiet">{KIND_LABEL[r.kind]}</td>
                          <td className="ledger-num"><Amount cents={r.remainingCents} currency={r.currency} signColour={false} /></td>
                          <td className="ledger-date">{r.nextDue ?? ""}</td>
                          <td><StatusWord tone={DEBT_TONE[r.status]}>{DEBT_STATUS_WORDS[r.status]}</StatusWord></td>
                        </tr>
                      ))}
                      {list.length > 1
                        ? subtotal.map((t) => (
                            <tr key={`${lender}-${t.currency}`} className="ledger-group">
                              <td colSpan={2}>{lender} total</td>
                              <td className="ledger-num"><Amount cents={t.remainingCents} currency={t.currency} signColour={false} /></td>
                              <td colSpan={2} />
                            </tr>
                          ))
                        : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Add a debt</h2>
        </div>
        <form action={createDebtAction} className="form">
          <div className="form-row">
            <label className="form-field">
              <span>What it is for</span>
              <input name="name" required placeholder="Couch" />
            </label>
            <label className="form-field">
              <span>Lender</span>
              <input name="lender" required list="lenders" placeholder="Affirm" />
              <datalist id="lenders">
                {knownLenders.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Kind</span>
              <select name="kind" defaultValue="bnpl">
                {DEBT_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Currency</span>
              <input name="currency" defaultValue={currency} />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Principal</span>
              <input name="principal" inputMode="decimal" required />
            </label>
            <label className="form-field">
              <span>Opened on</span>
              <input type="date" name="openedOn" defaultValue={today} required />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Interest-free until (optional)</span>
              <input type="date" name="interestFreeUntil" />
            </label>
            <label className="form-field">
              <span>Must be paid in full by (optional)</span>
              <input type="date" name="payoffDueOn" />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>APR % (optional, shown only)</span>
              <input name="apr" inputMode="decimal" />
            </label>
            <label className="form-field">
              <span>Payment day of month (loans, optional)</span>
              <input name="dueDay" inputMode="numeric" />
            </label>
          </div>
          <p className="form-note">Instalment plans: fill in all three of amount, how often, and first instalment date. Leave them blank for a deferred plan or an open loan.</p>
          <div className="form-row">
            <label className="form-field">
              <span>Instalment amount</span>
              <input name="instalmentAmount" inputMode="decimal" />
            </label>
            <label className="form-field">
              <span>How often</span>
              <select name="cadence" defaultValue="">
                <option value="">no schedule</option>
                {CADENCES.map((c) => (
                  <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>First instalment on</span>
              <input type="date" name="firstInstalmentOn" />
            </label>
            <label className="form-field">
              <span>Number of instalments (blank = until paid off)</span>
              <input name="instalmentCount" inputMode="numeric" />
            </label>
          </div>
          <label className="form-field">
            <span>Every N days (custom cadence only)</span>
            <input name="intervalDays" inputMode="numeric" />
          </label>
          <label className="form-field">
            <span>Notes (optional)</span>
            <input name="notes" />
          </label>
          <div className="form-actions">
            <button className="button button-primary" type="submit">Add debt</button>
          </div>
        </form>
      </section>
    </>
  );
}
```

Import `Fragment` from `react` at the top. The label constants live in `src/app/debts/labels.ts` (plain constants, no `"use server"`), because pages must not export non-page symbols:

```ts
import type { Cadence, DebtKind } from "@/lib/db/schema";
import type { DebtStatus } from "@/lib/debts/schedule";
import type { StatusTone } from "@/components/StatusWord";

export const DEBT_TONE: Record<DebtStatus, StatusTone> = { paid_off: "good", on_track: "good", due_soon: "attention", interest_starts_soon: "attention", overdue: "bad" };
export const KIND_LABEL: Record<DebtKind, string> = { bnpl: "buy now, pay later", loan: "loan", other: "other" };
export const CADENCE_LABEL: Record<Cadence, string> = { weekly: "every week", biweekly: "every two weeks", monthly: "every month", yearly: "every year", custom_days: "every N days" };
```

Drop the now-unused imports of `DEBT_KINDS`/`CADENCES` types that the constants needed from the list page if the page no longer references them directly (it still uses `DEBT_KINDS` and `CADENCES` for the form options).

- [ ] **Step 3: Debt detail page**

`src/app/debts/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { getDebt, listPayments, candidateTransactions } from "@/lib/queries/debts";
import { debtStatus, nextDue, projectedInstalments, remainingCents, hasSchedule, DEBT_STATUS_WORDS } from "@/lib/debts/schedule";
import { CADENCES, DEBT_KINDS } from "@/lib/db/schema";
import { formatCents } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { StatusWord } from "@/components/StatusWord";
import { DEBT_TONE, KIND_LABEL, CADENCE_LABEL } from "../labels";
import { addPaymentAction, deletePaymentAction, linkTransactionAction, setDebtClosedAction, deleteDebtAction, updateDebtAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DebtPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const sp = await searchParams;
  const db = getDb();
  const debt = getDebt(db, Number(id));
  if (!debt) notFound();
  const today = todayLocal(loadConfig().timezone);
  const payments = listPayments(db, debt.id);
  const remaining = Math.max(0, remainingCents(debt, payments));
  const status = debtStatus(debt, payments, today);
  const due = nextDue(debt, payments, today);
  const schedule = projectedInstalments(debt, payments, today);
  const error = first(sp.error);
  const saved = first(sp.saved);
  const editing = first(sp.edit) === "1";
  const q = first(sp.q) ?? "";
  const amountParam = first(sp.amount);
  const amountCents = amountParam ? Math.round(Number(amountParam.replace(/[,$\s]/g, "")) * 100) : undefined;
  const candidates = candidateTransactions(db, { q: q || undefined, amountCents: amountCents && Number.isFinite(amountCents) ? amountCents : undefined, limit: 20 });
  const self = `/debts/${debt.id}`;
  const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

  return (
    <>
      <section className="section hero">
        <p className="small"><Link href="/debts">All debts</Link></p>
        <div className="section-head">
          <h1 className="section-title">{debt.name} <span className="ledger-quiet">{debt.lender}</span></h1>
          <p className="section-meta"><StatusWord tone={DEBT_TONE[status]}>{DEBT_STATUS_WORDS[status]}</StatusWord></p>
        </div>
        <div className="hero-figure">
          <p className="stamp">
            <Amount cents={remaining} currency={debt.currency} signColour={false} />
            <span className="stamp-currency">{debt.currency}</span>
          </p>
          <p className="hero-note">
            remaining of <Amount cents={debt.principalCents} currency={debt.currency} signColour={false} />
            {due ? `, next due ${due}.` : "."}
            {remainingCents(debt, payments) < 0 ? ` Overpaid by ${formatCents(-remainingCents(debt, payments), debt.currency)}.` : ""}
          </p>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {saved === "link" ? <p className="small">Transaction linked.</p> : saved === "payment" ? <p className="small">Payment added.</p> : saved === "1" ? <p className="small">Saved.</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Terms</h2>
          <p className="section-meta"><Link href={editing ? self : `${self}?edit=1`}>{editing ? "Stop editing" : "Edit"}</Link></p>
        </div>
        {!editing ? (
          <dl className="facts">
            <dt>Kind</dt><dd>{KIND_LABEL[debt.kind]}</dd>
            <dt>Opened</dt><dd>{debt.openedOn}</dd>
            {debt.interestFreeUntil ? <><dt>Interest-free until</dt><dd>{debt.interestFreeUntil}</dd></> : null}
            {debt.payoffDueOn ? <><dt>Pay in full by</dt><dd>{debt.payoffDueOn}</dd></> : null}
            {debt.aprBps !== null ? <><dt>APR</dt><dd>{(debt.aprBps / 100).toFixed(2)}% (shown only; interest is not calculated)</dd></> : null}
            {debt.dueDay ? <><dt>Payment day</dt><dd>the {debt.dueDay}th of each month</dd></> : null}
            {hasSchedule(debt) ? <><dt>Schedule</dt><dd>{formatCents(debt.instalmentAmountCents!, debt.currency)} {debt.cadence === "custom_days" ? `every ${debt.intervalDays} days` : CADENCE_LABEL[debt.cadence!]} from {debt.firstInstalmentOn}{debt.instalmentCount ? `, ${debt.instalmentCount} instalments` : ", until paid off"}</dd></> : null}
            {debt.notes ? <><dt>Notes</dt><dd>{debt.notes}</dd></> : null}
          </dl>
        ) : (
          <form action={updateDebtAction} className="form">
            <input type="hidden" name="id" value={debt.id} />
            <div className="form-row">
              <label className="form-field"><span>What it is for</span><input name="name" defaultValue={debt.name} required /></label>
              <label className="form-field"><span>Lender</span><input name="lender" defaultValue={debt.lender} required /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Kind</span>
                <select name="kind" defaultValue={debt.kind}>{DEBT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
              </label>
              <label className="form-field"><span>Currency</span><input name="currency" defaultValue={debt.currency} /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Principal</span><input name="principal" inputMode="decimal" defaultValue={dollars(debt.principalCents)} required /></label>
              <label className="form-field"><span>Opened on</span><input type="date" name="openedOn" defaultValue={debt.openedOn} required /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Interest-free until</span><input type="date" name="interestFreeUntil" defaultValue={debt.interestFreeUntil ?? ""} /></label>
              <label className="form-field"><span>Must be paid in full by</span><input type="date" name="payoffDueOn" defaultValue={debt.payoffDueOn ?? ""} /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>APR %</span><input name="apr" inputMode="decimal" defaultValue={debt.aprBps === null ? "" : (debt.aprBps / 100).toString()} /></label>
              <label className="form-field"><span>Payment day of month</span><input name="dueDay" inputMode="numeric" defaultValue={debt.dueDay ?? ""} /></label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>Instalment amount</span><input name="instalmentAmount" inputMode="decimal" defaultValue={dollars(debt.instalmentAmountCents)} /></label>
              <label className="form-field"><span>How often</span>
                <select name="cadence" defaultValue={debt.cadence ?? ""}><option value="">no schedule</option>{CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}</select>
              </label>
            </div>
            <div className="form-row">
              <label className="form-field"><span>First instalment on</span><input type="date" name="firstInstalmentOn" defaultValue={debt.firstInstalmentOn ?? ""} /></label>
              <label className="form-field"><span>Number of instalments</span><input name="instalmentCount" inputMode="numeric" defaultValue={debt.instalmentCount ?? ""} /></label>
            </div>
            <label className="form-field"><span>Every N days (custom only)</span><input name="intervalDays" inputMode="numeric" defaultValue={debt.intervalDays ?? ""} /></label>
            <label className="form-field"><span>Notes</span><input name="notes" defaultValue={debt.notes ?? ""} /></label>
            <div className="form-actions">
              <button className="button button-primary" type="submit">Save debt</button>
            </div>
          </form>
        )}
        <div className="row-actions">
          <form action={setDebtClosedAction}>
            <input type="hidden" name="id" value={debt.id} />
            <input type="hidden" name="closed" value={debt.closedAt ? "0" : "1"} />
            <button className="row-action" type="submit">{debt.closedAt ? "Reopen" : "Close this debt"}</button>
          </form>
          <form action={deleteDebtAction}>
            <input type="hidden" name="id" value={debt.id} />
            <button className="row-action" type="submit">Delete this debt and its payments</button>
          </form>
        </div>
      </section>

      {hasSchedule(debt) ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Schedule</h2>
            <p className="section-meta">{schedule.filter((s) => s.state === "paid").length} of {schedule.length} paid</p>
          </div>
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr><th scope="col" className="ledger-date">Due</th><th scope="col" className="ledger-num">Amount</th><th scope="col" className="ledger-num">Paid</th><th scope="col">State</th></tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.index}>
                    <td className="ledger-date">{s.dueOn}</td>
                    <td className="ledger-num"><Amount cents={s.amountCents} currency={debt.currency} signColour={false} /></td>
                    <td className="ledger-num"><Amount cents={s.paidCents} currency={debt.currency} signColour={false} /></td>
                    <td><StatusWord tone={s.state === "paid" ? "good" : s.state === "overdue" ? "bad" : s.state === "partial" ? "attention" : "neutral"}>{s.state}</StatusWord></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : debt.payoffDueOn ? (
        <section className="section">
          <div className="section-head"><h2 className="section-title">Payoff</h2></div>
          <p>
            <Amount cents={remaining} currency={debt.currency} signColour={false} /> must be paid by {debt.payoffDueOn}
            {debt.interestFreeUntil ? `; interest starts ${debt.interestFreeUntil}.` : "."}
          </p>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Payments</h2>
          <p className="section-meta">{payments.length === 1 ? "1 payment" : `${payments.length} payments`}</p>
        </div>
        {payments.length === 0 ? (
          <EmptyState title="No payments recorded." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr><th scope="col" className="ledger-date">Paid on</th><th scope="col" className="ledger-num">Amount</th><th scope="col">Source</th><th scope="col">Note</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="ledger-date">{p.paidOn}</td>
                    <td className="ledger-num"><Amount cents={p.amountCents} currency={debt.currency} signColour={false} /></td>
                    <td className="ledger-quiet">{p.transactionId ? <Link href={`/transactions?q=&from=${p.paidOn}&to=${p.paidOn}`}>bank transaction</Link> : "entered by hand"}</td>
                    <td className="ledger-quiet">{p.note ?? ""}</td>
                    <td className="row-actions">
                      <form action={deletePaymentAction}>
                        <input type="hidden" name="debtId" value={debt.id} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button className="row-action" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form action={addPaymentAction} className="form">
          <input type="hidden" name="debtId" value={debt.id} />
          <div className="form-row">
            <label className="form-field"><span>Paid on</span><input type="date" name="paidOn" defaultValue={today} required /></label>
            <label className="form-field"><span>Amount</span><input name="amount" inputMode="decimal" required defaultValue={hasSchedule(debt) ? dollars(debt.instalmentAmountCents) : ""} /></label>
          </div>
          <label className="form-field"><span>Note (optional)</span><input name="note" /></label>
          <div className="form-actions"><button className="button button-primary" type="submit">Add payment</button></div>
        </form>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Link a transaction</h2>
          <p className="section-meta">recent outflows not yet set against a debt</p>
        </div>
        <form action={self} method="get" className="filters">
          <label className="filter-field filter-search"><span className="small">Search</span><input name="q" defaultValue={q} placeholder="payee or description" /></label>
          <label className="filter-field"><span className="small">Amount</span><input name="amount" inputMode="decimal" defaultValue={amountParam ?? ""} /></label>
          <div className="filter-actions"><button className="button" type="submit">Search</button></div>
        </form>
        {candidates.length === 0 ? (
          <EmptyState title="No unlinked outflows match." />
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr><th scope="col" className="ledger-date">Date</th><th scope="col">Account</th><th scope="col">Payee</th><th scope="col" className="ledger-num">Amount</th><th scope="col"><span className="sr-only">Link</span></th></tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td className="ledger-date">{c.localDate ?? ""}</td>
                    <td className="ledger-quiet">{c.accountName}</td>
                    <td>{c.payee ?? c.description}</td>
                    <td className="ledger-num"><Amount cents={c.amountCents} currency={c.currency} /></td>
                    <td className="row-actions">
                      <form action={linkTransactionAction}>
                        <input type="hidden" name="debtId" value={debt.id} />
                        <input type="hidden" name="transactionId" value={c.id} />
                        <input type="hidden" name="returnTo" value={self} />
                        <button className="row-action" type="submit">Link transaction</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
```

The `.row-actions > * + *` spacing rule applies to this div as it does to table cells (it targets `.row-actions` children, not `td`).

- [ ] **Step 4: Picker from the transactions side**

`src/app/debts/link/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { accounts, transactions } from "@/lib/db/schema";
import { listDebtsWithStatus } from "@/lib/queries/debts";
import { todayLocal } from "@/lib/time";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { linkTransactionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LinkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const txId = first(sp.tx);
  if (!txId) notFound();
  const db = getDb();
  const tx = db
    .select({ id: transactions.id, localDate: transactions.localDate, payee: transactions.payee, description: transactions.description, amountCents: transactions.amountCents, currency: accounts.currency })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactions.id, txId))
    .get();
  if (!tx) notFound();
  const today = todayLocal(loadConfig().timezone);
  const debts = listDebtsWithStatus(db, { today }).filter((d) => d.status !== "paid_off");
  const returnTo = first(sp.returnTo) && /^\/(?![/\\])/.test(first(sp.returnTo)!) ? first(sp.returnTo)! : "/transactions";
  const error = first(sp.error);

  return (
    <>
      <section className="section section-lead">
        <p className="small"><Link href={returnTo}>Back</Link></p>
        <h1 className="section-title">Set against a debt</h1>
        <dl className="facts">
          <dt>Transaction</dt><dd>{tx.payee ?? tx.description}</dd>
          <dt>Date</dt><dd>{tx.localDate ?? ""}</dd>
          <dt>Amount</dt><dd><Amount cents={tx.amountCents} currency={tx.currency} /></dd>
        </dl>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Open debts</h2>
          <p className="section-meta">the payment date and amount are taken from the transaction</p>
        </div>
        {debts.length === 0 ? (
          <EmptyState title="No open debts."><Link href="/debts">Add one first.</Link></EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <tbody>
                {debts.map((d) => (
                  <tr key={d.id}>
                    <td><Link href={`/debts/${d.id}`}>{d.name}</Link> <span className="ledger-quiet">{d.lender}</span></td>
                    <td className="ledger-num"><Amount cents={d.remainingCents} currency={d.currency} signColour={false} /> <span className="small">remaining</span></td>
                    <td className="row-actions">
                      <form action={linkTransactionAction}>
                        <input type="hidden" name="debtId" value={d.id} />
                        <input type="hidden" name="transactionId" value={tx.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="row-action" type="submit">Link to {d.name}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 5: Transactions row action**

In `src/components/TransactionsTable.tsx`, inside the `row-actions` cell, before the transfer form:

```tsx
                {t.debtId ? (
                  <Link className="row-action" href={`/debts/${t.debtId}`}>Pays {t.debtName}</Link>
                ) : t.amountCents < 0 ? (
                  <Link className="row-action" href={`/debts/link?tx=${encodeURIComponent(t.id)}&returnTo=${encodeURIComponent(returnTo)}`}>Set against a debt</Link>
                ) : null}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`. Browser check on a scratch DB: `/debts` add a pay-in-4 plan and a deferred plan (Affirm/Flexiti names), confirm grouping and subtotal when two share a lender; open the pay-in-4, confirm the schedule ledger, add a payment, link a transaction from the picker and confirm the payment row says "bank transaction" and the schedule updates; from `/transactions` click "Set against a debt" on an outflow, link it, confirm the row now reads "Pays <name>" and linking it again from the picker is refused with the message naming the debt. Screenshots `task-11-debts.png`, `task-11-debt.png`, `task-11-link.png`. Stop the server, delete the scratch copy and `.playwright-mcp/`. No payees, amounts, or lender names from real data in the report.

```bash
git add src/app/debts src/components/TransactionsTable.tsx
git commit -m "feat(debts): debts pages, payments, transaction picker, row action"
```

---

### Task 12: Overview lines, README, design doc, spec status

**Files:**
- Modify: `src/app/page.tsx`, `README.md`, `docs/superpowers/specs/2026-09-09-fineants-design-direction.md`, `docs/superpowers/specs/2026-09-10-fineants-phase2-design.md`

**Interfaces:**
- Consumes: `totalsRemainingByCurrency`, `upcomingDebts` (Task 6); `upcomingRecurring` (Task 4); `budgetMonth`, `budgetMonthRange` (Task 7); `parseMonthKey`, `monthKey`, `todayLocal`.

- [ ] **Step 1: Overview**

In `src/app/page.tsx`, after the totals in the hero and before `hero-sync`, add three lines as a `.facts` list (only when accounts exist):

```tsx
  const tz = loadConfig().timezone;
  const today = todayLocal(tz);
  const { year, month } = parseMonthKey(monthKey(today))!;
  const debts = totalsRemainingByCurrency(db);
  const upcoming = [...upcomingRecurring(db, { today, days: 7 }), ...upcomingDebts(db, { today, days: 7 })];
  const budget = budgetMonth(db, { year, month, tz, today });
  const upcomingByCurrency = new Map<string, { count: number; cents: number }>();
  for (const u of upcoming) {
    const cur = upcomingByCurrency.get(u.currency) ?? { count: 0, cents: 0 };
    cur.count += 1;
    cur.cents += u.amountCents;
    upcomingByCurrency.set(u.currency, cur);
  }
```

```tsx
        <dl className="facts">
          <dt>Debts</dt>
          <dd>
            {debts.length === 0 ? <Link href="/debts">none recorded</Link> : debts.map((d, i) => (
              <span key={d.currency}>{i > 0 ? "; " : ""}<Link href="/debts"><Amount cents={d.remainingCents} currency={d.currency} signColour={false} /> {d.currency}</Link> across {d.open === 1 ? "1 debt" : `${d.open} debts`}</span>
            ))}
          </dd>
          <dt>Due in 7 days</dt>
          <dd>
            {upcoming.length === 0 ? <Link href="/recurring">nothing due</Link> : [...upcomingByCurrency.entries()].map(([cur, v], i) => (
              <span key={cur}>{i > 0 ? "; " : ""}<Link href="/recurring">{v.count === 1 ? "1 item" : `${v.count} items`}</Link>, <Amount cents={v.cents} currency={cur} signColour={false} /> {cur}</span>
            ))}
          </dd>
          <dt>Budget</dt>
          <dd>
            {budget.totals.length === 0 ? <Link href="/budget">no caps set</Link> : budget.totals.map((t, i) => (
              <span key={t.currency}>{i > 0 ? "; " : ""}<Link href="/budget"><Amount cents={t.spentCents} currency={t.currency} signColour={false} /> of <Amount cents={t.capCents} currency={t.currency} signColour={false} /></Link> this month</span>
            ))}
          </dd>
        </dl>
```

Imports: `loadConfig`, `todayLocal`, `parseMonthKey`, `monthKey`, `totalsRemainingByCurrency`, `upcomingDebts`, `upcomingRecurring`, `budgetMonth`. The page is a server component without `searchParams`; keep it synchronous as it is.

- [ ] **Step 2: README**

Add under the phase 2 sections: "Budget" (caps per category per calendar month, pace explained in one sentence, `/budget`), "Recurring costs" (cadence, anchor date, match pattern and tolerance, paid/due/overdue, monthly equivalent, `/recurring`), "Debts" (kinds, schedule or payoff date, payments by hand or by linking a transaction from either side, grouped by lender, not in net worth, `/debts`). API: `GET /api/v1/summary` now includes `debts` and `budget`; document `GET /api/v1/upcoming?days=7` with a two-item example (`kind`, `id`, `name`, `currency`, `amountCents`, `dueOn`, `status`). Note that the tagging pass now also links recurring costs (`recurringMatched` in the report).

- [ ] **Step 3: Design direction and spec**

Design direction "Phase 2 additions": add a line "Month switcher: two plain buttons and the month name in body type; a disabled end is faded, never hidden." and "Lender group rows: a 1px ink-2 top rule and weight 600, no background." Spec §17: mark phase 2 done with the date; §6.3 no change; §12 note that `/settings` sections were split (already amended in 2a).

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npm run build && npm test`. Browser check on a scratch DB: open `/`, confirm the three lines render with links, and each link lands on its page. Screenshot `task-12-overview.png`. Stop the server, delete the scratch copy and `.playwright-mcp/`.

```bash
git add src/app/page.tsx README.md docs/superpowers/specs
git commit -m "feat(overview): debts, upcoming, budget lines; phase 2b docs"
```

---

## Self-review

**Spec coverage (plan 2b scope):**
- §5 `monthBounds`, `addMonths` → Task 1. ✔
- §6.3 recurring matching (candidates, tolerance, one per period nearest due, manual wins, category with source `recurring`) → Task 5. ✔
- §7 budget month (spent, cap, remaining, pace, uncategorised, income, totals, navigable range) → Task 7; page → Task 9. ✔
- §8 recurring schedule (projection per cadence with clamping, current period with 7-day lead, status, monthly equivalent) → Task 2; queries (CRUD, `listWithStatus`, `previewPatternMatches`, `upcoming`) → Task 4; page → Task 10. Custom cadence `interval_days` handled. ✔
- §9 debts (remaining, projected instalments with spill-over, next due for scheduled/deferred/due-day, status precedence, CRUD, payments, `linkTransaction` with rejection message, `candidateTransactions`, `lenders`, totals by currency and lender, sorted by lender) → Tasks 3, 6; pages incl. `/debts/link` → Task 11; debts not in net worth → stated in Global Constraints and on the Debts hero. ✔
- §12 Nav → Task 9; `/budget`, `/recurring`, `/debts`, `/debts/[id]`, `/debts/link` → Tasks 9–11; Transactions "Set against a debt" / "Pays …" → Task 11; Overview three lines → Task 12. ✔
- §13 `summary.debts/budget`, `upcoming` with 1–60 validation → Task 8. ✔
- §15 tests: unit (schedule projection per cadence incl. clamping, period window, statuses, equivalents; debt math; matcher), integration (recurring queries and upcoming; debts incl. link rejection; budget month with transfers/hidden excluded; tagging 6.3 idempotence, manual precedence, category source, deletion), API (`upcoming` validation/payload, `summary` additions). ✔ Browser screenshots per UI task.
- §16 errors: invalid dates/amounts → typed errors surfaced via `?error=`; double link → message naming the debt; overpayment allowed and shown. ✔

**Placeholder scan:** none of "TBD", "TODO", "similar to Task N".

**Type consistency:** `CadenceLike` (Task 2) is what `debts/schedule.ts` (Task 3), `recurringMatch.ts` (Task 5), and `queries/recurring.ts` (Task 4) pass; `RecurringCostRow` satisfies it structurally. `RecurringStatus` used by Tasks 4, 10; `DebtStatus`/`DEBT_STATUS_WORDS` by Tasks 6, 11; `PaceState`/`PACE_WORDS` by Tasks 7, 9. `UpcomingRecurring`/`UpcomingDebt` union in Task 8 matches Tasks 4 and 6 exactly (`kind` discriminator). `buildSummary(db, { tz, nowMs })` matches Task 8's route and tests. `TxRow.debtId/debtName` (Task 6) matches Task 11's table. `StatusTone` is exported from `StatusWord.tsx` since 2a.
