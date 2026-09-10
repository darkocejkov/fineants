# fineants — Phase 2 design: categories, transfers, budgets, recurring costs, debts

**Date:** 2026-09-10
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-09-09-fineants-phase1-design.md` (data model,
sync engine, API, packaging) and `docs/superpowers/specs/2026-09-09-fineants-design-direction.md`
(visual system, binding for all UI).

## 1. Purpose

Phase 1 syncs bank data from SimpleFin and shows it. Phase 2 adds the owner's own knowledge
about that data and the money that never touches a synced account:

- **Categories** on transactions, assigned by ordered payee/description rules with per-transaction
  manual overrides.
- **Transfers** between the owner's own accounts, auto-detected and excluded from spending,
  income, and budgets, with manual override.
- **Budgets**: an optional monthly cap per category, tracked against a calendar month.
- **Recurring costs**: subscriptions and bills with a cadence and expected amount, matched to
  bank transactions so each period shows paid, due, or overdue.
- **External debts**: BNPL plans (including deferred "nothing due for 12 months" plans) and open
  loans, with payments recorded by hand or by setting a bank transaction against the debt.
- **Timezone**: day and month bucketing in a configured timezone (default `America/Toronto`)
  instead of UTC.
- **Per-connection sync watermarks**, so one bank needing re-authentication does not stop the
  other from advancing, and its gap is fetched once it recovers.
- **Housekeeping** deferred from phase 1: stale `running` runs, Sync now label reset, 12-month
  spending by month, README gaps.

Out of scope for phase 2: interest accrual on debts (APR is stored and shown only), income
budgeting beyond the `income` category kind, multi-user auth, the Magic Frame module itself
(phase 3 consumes the API added here).

## 2. Decisions already made

| Decision | Choice | Why |
| --- | --- | --- |
| Category assignment | Ordered rules plus manual per-transaction override | Rules fix history the moment they are saved; overrides stick |
| Where derived facts live | Materialised `transaction_meta`, fully recomputed after sync or rule edits (Option A) | Milliseconds at this volume; no drift; one join for dashboards |
| Budget meaning | Recurring commitments plus a monthly cap per category | Owner's choice |
| Budget period | Calendar month in the app timezone | Matches statements |
| Debt payments | Manual: add a payment, or set a bank transaction against a debt | Owner's choice; no auto-matching of debt payments |
| Debt shapes | Scheduled instalments, deferred BNPL, open loans, in one table | Owner has a 12-month no-payment plan today |
| Transfers | Auto-detect equal-and-opposite pairs across own accounts within 3 days, manual override | Owner's choice |
| Timezone | `TIMEZONE` config, default `America/Toronto`; `local_date` column | SQLite cannot do DST; compute once at write time |
| Recurring matching | Each recurring cost owns its own `match_pattern` and amount tolerance | One place to look when a bill is not recognised |

## 3. Architecture

Unchanged from phase 1: a single Next.js app, library-first. Everything in `src/lib/**` has no
`next` or `react` imports and takes `db: Db` explicitly. Pages are server components that call
`lib/queries`; mutations are server actions in `src/app/**/actions.ts` that call `lib/*` write
functions and `revalidatePath`.

New library areas:

```
src/lib/
  time.ts                    toLocalDate, todayLocal, monthBounds, DEFAULT_TIMEZONE
  tagging/
    rules.ts                 matchRule, firstMatch (pure)
    transfers.ts             pairTransfers (pure over candidate rows)
    recurringMatch.ts        matchRecurring (pure)
    apply.ts                 applyTagging(db, opts) — the pass; TaggingReport
  budget/month.ts            budgetMonth(db, {year, month, tz}) — caps, spent, pace
  recurring/schedule.ts      projectDueDates, currentPeriod, monthlyEquivalent, status (pure)
  debts/schedule.ts          remaining, projectedInstalments, nextDue, status (pure)
  queries/
    categories.ts            list/create/update/archive/reorder; seedDefaults
    rules.ts                 list/create/update/delete/reorder; previewRuleMatches
    meta.ts                  setCategory, setTransfer, setRecurring, clearManual (manual writes)
    recurring.ts             CRUD; listWithStatus; previewPatternMatches
    debts.ts                 CRUD; listWithStatus; payments CRUD; linkTransaction
    connectionState.ts       per-connection watermark reads/writes
  db/bootstrap.ts            runDataSteps(db, config): local_date backfill, category seed,
                             watermark migration, timezone recompute — idempotent
```

`getDb()` calls `runDataSteps` once after `migrate`. `scripts/migrate.ts` calls it too.

## 4. Data model

Conventions as phase 1: integer cents plus `currency`; Unix seconds for bank timestamps;
`*_at` ISO-8601 text; owner-entered dates are `YYYY-MM-DD` text (`*_on` columns). Booleans are
integer 0/1. All new tables have integer autoincrement ids unless noted.

### transactions (changed)
| column | type | notes |
| --- | --- | --- |
| local_date | text | `YYYY-MM-DD` of the effective date in the app timezone; not null after bootstrap |

Index `(local_date)`. The effective date is unchanged:
`coalesce(nullif(posted,0), transacted_at, unixepoch(first_seen_at))`. The sync engine writes
`local_date` on every upsert; bootstrap backfills rows where it is null; a timezone change
recomputes all rows.

### categories
| column | type | notes |
| --- | --- | --- |
| id | integer PK | |
| name | text unique (case-insensitive, `COLLATE NOCASE`) | |
| kind | text | `expense`, `income` |
| monthly_cap_cents | integer? | null = no cap |
| cap_currency | text? | required when cap set; the form defaults it to the dominant currency (most non-hidden accounts; ties alphabetical) |
| sort_order | integer | |
| archived | integer | archived categories keep their history, hidden from pickers |
| created_at, updated_at | text | |

Seeded once (bootstrap, only when the table is empty): Groceries, Dining, Transport, Housing,
Utilities, Subscriptions, Shopping, Health, Entertainment, Debt payments, Other (all `expense`);
Income (`income`).

### rules
| column | type | notes |
| --- | --- | --- |
| id | integer PK | |
| name | text | shown in lists; defaults to the pattern |
| priority | integer | ascending; first match wins per field |
| field | text | `payee`, `description`, `any` |
| match | text | `contains`, `regex`; both case-insensitive |
| pattern | text | regex validated on save; invalid regex rejected |
| account_id | text? FK accounts | restrict to one account |
| min_amount_cents, max_amount_cents | integer? | inclusive, signed (negative = outflow) |
| category_id | integer? FK categories | action |
| mark_transfer | integer | action |
| active | integer | |
| created_at, updated_at | text | |

A rule with neither `category_id` nor `mark_transfer` is rejected on save.

### transaction_meta
| column | type | notes |
| --- | --- | --- |
| transaction_id | text PK FK transactions (on delete cascade) | |
| category_id | integer? FK categories | |
| category_source | text? | `rule`, `recurring`, `manual` |
| rule_id | integer? FK rules (on delete set null) | rule that set the category |
| is_transfer | integer | |
| transfer_source | text? | `auto`, `rule`, `manual` |
| counterpart_transaction_id | text? FK transactions | set for auto pairs |
| recurring_cost_id | integer? FK recurring_costs (on delete set null) | |
| recurring_source | text? | `auto`, `manual` |
| note | text? | |
| updated_at | text | |

A row exists only when at least one field is set. A field with source `manual` is never changed
by the tagging pass; `manual` with a null value is a valid state meaning "the owner said none"
(for example `is_transfer = 0, transfer_source = manual` pins "not a transfer").

### external_debts
| column | type | notes |
| --- | --- | --- |
| id | integer PK | |
| name, lender | text | |
| currency | text | |
| kind | text | `bnpl`, `loan`, `other` |
| principal_cents | integer | positive |
| opened_on | text | |
| interest_free_until | text? | |
| payoff_due_on | text? | must be paid in full by |
| apr_bps | integer? | basis points; display only |
| due_day | integer? | 1–31; open loans with a monthly payment date but no fixed schedule |
| instalment_amount_cents | integer? | schedule, all-or-nothing with `cadence` and `first_instalment_on` |
| cadence | text? | `weekly`, `biweekly`, `monthly`, `custom_days` |
| interval_days | integer? | required when `cadence = custom_days` |
| first_instalment_on | text? | |
| instalment_count | integer? | null = until paid off |
| notes | text? | |
| closed_at | text? | set when the owner closes it; remaining may be non-zero (written off) |
| created_at, updated_at | text | |

### debt_payments
| column | type | notes |
| --- | --- | --- |
| id | integer PK | |
| debt_id | integer FK external_debts (on delete cascade) | |
| paid_on | text | |
| amount_cents | integer | positive |
| transaction_id | text? FK transactions, unique | one bank transaction pays at most one debt |
| note | text? | |
| created_at | text | |

### recurring_costs
| column | type | notes |
| --- | --- | --- |
| id | integer PK | |
| name | text | |
| currency | text | |
| amount_cents | integer | expected outflow, positive |
| cadence | text | `weekly`, `biweekly`, `monthly`, `yearly`, `custom_days` |
| interval_days | integer? | required when `custom_days` |
| anchor_on | text | any known due date |
| category_id | integer? FK categories | applied to matched transactions when they have no category |
| account_id | text? FK accounts | restrict matching |
| match_pattern | text? | case-insensitive contains on payee or description |
| match_tolerance_bps | integer | default 1000 (10%) |
| active | integer | |
| notes | text? | |
| created_at, updated_at | text | |

### connection_sync_state
| column | type | notes |
| --- | --- | --- |
| connection_id | text PK FK connections | |
| last_success_end | integer? | Unix seconds; null = never |
| last_error_code, last_error_msg | text? | |
| last_error_at | text? | |

### app_state additions
`timezone` (the tz the current `local_date` values were computed with),
`bootstrap_version` (integer; data steps run when below the code's version),
`last_tagging` (`{at, report}`).
`last_successful_sync_end` is kept as the fallback for connections with no state.

### Migration
`0001_phase2.sql` (drizzle-kit generated): the `local_date` column and index, all new tables,
indexes on `transaction_meta(category_id)`, `transaction_meta(recurring_cost_id)`,
`debt_payments(debt_id)`, `debt_payments(transaction_id)`, `rules(priority)`. Data steps run
from `db/bootstrap.ts` after schema migration, in one SQLite transaction each:

1. `local_date` backfill for null rows, using the configured timezone.
2. Category seed when `categories` is empty.
3. Connection state seed: every connection without a row gets
   `last_success_end = app_state.last_successful_sync_end`.
4. Timezone recompute when `app_state.timezone` differs from config: rewrite every
   `local_date`, store the new tz, then run the tagging pass (pairing and recurring windows
   depend on dates).

## 5. Time

`src/lib/time.ts`:

- `DEFAULT_TIMEZONE = "America/Toronto"`. Config `TIMEZONE` validated with
  `Intl.supportedValuesOf("timeZone")`; a bad value is a `ConfigError`.
- `toLocalDate(unixSeconds, tz): string` via a cached `Intl.DateTimeFormat` (`en-CA` yields
  `YYYY-MM-DD` directly).
- `todayLocal(tz, nowMs): string`.
- `monthBounds(year, month, tz): {startDate, endDate, startSec, endSec}` — first and last
  `local_date` of the month and their instant bounds, used for pace.
- `addDays(date, n)`, `addMonths(date, n)` on `YYYY-MM-DD` strings (calendar arithmetic, no tz).
- `daysBetween(a, b)`.

Bucketing rule for phase 2: **anything grouped by day, week, or month uses `local_date`**.
`spendingByPeriod`, `topPayees`, `buildSpending`, and the net-worth series are converted to it.
The Spending footnote UTC note is replaced by the timezone name.

## 6. Tagging pass

`applyTagging(db, { now?, tz }): TaggingReport` where
`TaggingReport = { categorised, categoryCleared, transfersPaired, transfersCleared, recurringMatched, durationMs }`.

Runs inside one SQLite transaction. Steps:

**6.1 Rules.** Load active rules ordered by `priority, id`. Load all transactions with their
current meta and account. For each transaction, evaluate rules in order; the first rule that
matches and sets `category_id` supplies the category; the first that matches and has
`mark_transfer` supplies the transfer flag. A rule matches when: its account filter is null or
equal; the amount is within `[min, max]` where set; and the pattern matches the chosen field
(`any` = payee or description). `contains` is a case-insensitive substring test; `regex` is
compiled once per pass with flag `i`, and a rule whose regex fails to compile is skipped and
reported.

Writes: if `category_source` is not `manual`, set `category_id`/`rule_id` to the winner with
`category_source = rule`, or null all three when no rule matches (clearing counts as
`categoryCleared` when a value was removed; a `recurring`-sourced category is treated the same
way and may be re-set by step 6.3 in the same pass). If `transfer_source` is not `manual`: when
a rule with `mark_transfer` matches, set `is_transfer = 1, transfer_source = rule, counterpart
null`; when none matches and the previous source was `rule`, clear it. `auto` values are left
for step 6.2, which recomputes them.

**6.2 Transfer pairing.** Candidates: non-hidden accounts' transactions where
`transfer_source` is not `manual` and not `rule`. Clear all previous `auto` pairings first.
Group by currency and absolute amount; within a group, for every outflow, choose the inflow in a
different account with the smallest `|effective date difference| <= 3 days` that is not already
taken; ties break by transaction id. Both rows get `is_transfer = 1, transfer_source = auto`
and each other's id as counterpart. Excludes pending rows.

**6.3 Recurring matching.** For each active recurring cost with a non-empty `match_pattern`:
candidates are outflows (`amount_cents < 0`) in the cost's currency, in the cost's account when
set, whose payee or description contains the pattern (case-insensitive), whose absolute amount is
within `amount * (1 ± tolerance)`, that are not transfers, and whose `recurring_source` is not
`manual`. Clear previous `auto` links for this cost. Project due dates covering the transaction
date range (§8); each candidate is assigned to the nearest due date; when several candidates share
a due date, the one closest to it wins and the others stay unlinked. Linked rows get
`recurring_cost_id, recurring_source = auto`, and, when they have no category after step 6.1,
the cost's `category_id` with `category_source = recurring` and `rule_id = null`.

**Triggers:** end of `runSync` for runs that upserted at least one transaction (failure is
recorded on the run as `partial` with `error = "tagging: <message>"`, never a sync failure);
after any create/update/delete/reorder of rules, categories (archive only), or recurring costs;
the Settings "Re-run tagging" button; `npm run tag` CLI. The report is stored at
`app_state.last_tagging` and shown on Settings.

**Manual writes** (`queries/meta.ts`), each a single upsert and never triggering a full pass:
`setCategory(db, txId, categoryId | null)` (source `manual`), `clearCategoryOverride(db, txId)`
(source back to null, then `applyRulesToOne(db, txId)`, a single-transaction form of step 6.1
exported from `tagging/apply.ts`),
`setTransfer(db, txId, boolean)` (source `manual`; when set to true and an `auto` counterpart
exists it is kept, otherwise counterpart null), `setRecurring(db, txId, costId | null)` (source
`manual`).

## 7. Budget month

`budgetMonth(db, { year, month, tz }): BudgetMonth` with

```
BudgetMonth = {
  year, month, startDate, endDate, daysInMonth, daysElapsed,
  capped: [{ categoryId, name, currency, capCents, spentCents, remainingCents, paceCents, paceState }],
  uncapped: [{ categoryId, name, currency, spentCents }],
  uncategorised: [{ currency, spentCents, count }],
  totals: [{ currency, capCents, spentCents }],
}
```

Spent = sum of `-amount_cents` for transactions with `amount_cents < 0`, `is_transfer = 0` (or
no meta), non-hidden account, `local_date` in the month, and the category. `paceCents = round(cap
* daysElapsed / daysInMonth)`; `paceState` is `over_cap` when spent > cap, else `over_pace` when spent > pace, else
`on_pace`. The UI renders these as "over", "ahead of pace", and "on pace". Income-kind categories are listed under a separate `income` array
with inflow sums and no cap. Months before the earliest `local_date` or after the current month
are not navigable.

## 8. Recurring costs

`recurring/schedule.ts` (pure):

- `projectDueDates(cost, fromDate, toDate): string[]` — from `anchor_on` step by cadence
  (`weekly` 7 days, `biweekly` 14, `custom_days` n, `monthly` same day-of-month clamped to
  month end, `yearly` same month/day clamped) in both directions until the range is covered.
- `currentDue(cost, today)` — the projected due date `d` whose period contains today, where a
  period runs from 7 days before `d` up to (not including) 7 days before the following due date.
- `periodWindow(due, cost) = [due - 7 days, next(due) - 7 days)`; a cost is `paid` for a period
  when a linked transaction's `local_date` lies in the window; `due` when unpaid and
  `today <= due`; `overdue` when unpaid and `today > due`.
- `monthlyEquivalentCents(cost)`: weekly ×52/12, biweekly ×26/12, monthly ×1, yearly ÷12,
  custom_days ×(365.25/interval)/12; rounded.

`queries/recurring.ts`: CRUD; `listWithStatus(db, { today, tz })` returns each active cost with
`nextDue`, `status`, `matchedTransaction?` (for the current period), `monthlyEquivalentCents`;
`previewPatternMatches(db, cost-like)` returns the count and 5 most recent matching
transactions without writing anything (used by the form's live preview);
`upcoming(db, { today, days })` for the API and Overview.

## 9. External debts

`debts/schedule.ts` (pure, takes the debt row and its payments):

- `remainingCents = principal - sum(payments)`, floored at 0 for display, raw value kept.
- `projectedInstalments(debt)`: when a schedule is set, dates from `first_instalment_on` by
  cadence for `instalment_count` entries, or until cumulative amount ≥ principal when count is
  null. Each entry: `{ dueOn, amountCents, paidCents, state }` where payments are applied to
  instalments in date order (a payment larger than one instalment spills into the next).
- `nextDue(debt, payments, today)`: first instalment with `paidCents < amountCents`; when there
  is no schedule, `payoff_due_on`; when neither, `due_day` projected to the next occurrence; else
  null.
- `status(debt, payments, today)`: `paid_off` (remaining ≤ 0 or closed), `overdue` (nextDue <
  today), `due_soon` (nextDue within 14 days), `interest_starts_soon` (`interest_free_until`
  within 30 days and remaining > 0), else `on_track`. When several apply, that order wins.

`queries/debts.ts`: CRUD for debts and payments; `listWithStatus(db, today)`;
`totalsRemainingByCurrency(db)`; `linkTransaction(db, { debtId, transactionId, amountCents?,
paidOn?, note? })` creates a payment with `paid_on = transaction.local_date` and `amount_cents =
|transaction.amount_cents|` unless overridden, and rejects a transaction already linked to any
debt; `candidateTransactions(db, { q?, amountCents?, limit })` returns recent unlinked outflows,
filtered by payee/description text and, when an amount is given, within 1% of it.

Debt balances are **not** added to net worth in phase 2 (they are shown as a separate total
on the Overview); folding them into net worth is a phase 3 decision alongside the Magic Frame
summary.

## 10. Sync engine changes

**Per-connection watermarks.** `computeWindows` is unchanged; its `lastSuccessEnd` input
becomes `min(last_success_end over connections with a row)`, falling back to
`app_state.last_successful_sync_end`, then null (full backfill). `BACKFILL_DAYS` still bounds
the start. After a run finishes (`success` or `partial`), for every connection seen in the
response: if no errlist item is attributed to it, set `last_success_end = window_end` and clear
its last error; otherwise leave the watermark and record the error. Connections in the database
but absent from the response are left untouched. `last_successful_sync_end` keeps being written
for backward compatibility and the rate guard.

**Attribution** (`sync/attribution.ts`, pure): an errlist item with `conn_id` attributes to
that connection; otherwise, if exactly one connection's `name` (case-insensitive) occurs in
`msg`, to that connection; otherwise it is **unattributed** and holds every connection's
watermark for this run. Each item gets `attributedConnectionId?: string` in the stored errlist so
the Explorer can show it.

**Stale runs.** `sweepStaleRuns(db, now)` marks `running` rows started more than 30 minutes ago
as `failed` with `error = "interrupted"`. Called from `startScheduler` and at the start of
`runSync`.

**Tagging after sync.** See §6 triggers. `SyncRunSummary` gains `tagging?: TaggingReport`.

**`local_date`** is written for every upserted transaction from the effective date and the
configured timezone.

## 11. Configuration

`.env.example` gains:

```
# IANA timezone for day and month bucketing (default America/Toronto)
TIMEZONE=America/Toronto
```

`Config` gains `timezone: string`. The Docker image and compose file need no change; README
gains the `db:migrate` row, the `cp .env.example .env` step, `TIMEZONE`, and a phase 2 section
describing categories, rules, budgets, recurring costs, and debts.

## 12. UI

Design direction remains binding. Additions to the direction doc, made before the first UI task:

- **Fill rule**: budget progress is a single 3px rule in `--paper-2` with the spent fraction
  drawn in ink; over-cap spills in oxblood beyond the cap tick. No rounded bars, no gradients.
- **Status words**: `paid`, `due`, `overdue`, `on track`, `due soon`, `interest starts soon`,
  `paid off`, set in sentence case in the existing roles (bottle for good, ochre for attention,
  oxblood for bad, ink-2 for neutral). Never badges or pills.
- **Inline controls in ledgers**: a native `<select>` styled as text with a 1px ink underline
  and no chrome; saves on change via a form with a hidden submit; a visible focus ring.
- **Forms**: one column, labels above fields, ink underline inputs, primary button as in phase 1.
  Live previews ("Would match 14 transactions") are set as `.small` text under the field, updated
  by a server action on blur (no client-side matching logic).

Nav: Overview, Transactions, Spending, Budget, Recurring, Debts, Explorer, Settings.

| route | content |
| --- | --- |
| `/` Overview | adds three ledger lines under totals: debts remaining (by currency), commitments due in the next 7 days (count and sum), budget month position (spent vs total caps); recent transactions gain a category column |
| `/transactions` | category column with inline select (includes "Uncategorised" and "Clear override" when manual); transfer marker word `transfer` in ink-2 with amounts in `.ledger-quiet`; row actions: Mark as transfer / Not a transfer, Set against a debt (links to `/debts/link?tx=`); filters add category (with Uncategorised) and Hide transfers (default on) |
| `/accounts/[id]` | same table changes |
| `/spending` | transfers excluded; by-category ledger for the range; 12m buckets by month; footnote names the timezone |
| `/budget` | month switcher (`?month=YYYY-MM`); capped categories ledger (spent, cap, remaining, pace word, fill rule); uncapped spend; uncategorised total linking to `/transactions?category=none&from&to`; income lines; caps edited inline (amount field per row) |
| `/recurring` | stamp: monthly equivalent total; ledger: name, expected, cadence, next due, status word, matched transaction (date and amount) or "not seen"; add/edit form with live "would match N" preview; deactivate; show inactive toggle |
| `/debts` | stamp: total remaining; ledger: name, lender, kind, remaining, next due or payoff date, status word; add form |
| `/debts/[id]` | terms as `.facts`; schedule ledger (due, amount, paid, state) when scheduled, else the payoff sentence; payments ledger; Add payment form; Link a transaction picker (search text, amount, recent unlinked outflows) |
| `/debts/link?tx=` | picker from the transactions side: shows the transaction, lists open debts, one-click link with prefilled amount and date |
| `/settings` | new sections: Categories (rename, kind, archive, order), Rules (ordered ledger, add/edit form with live preview, move up/down, delete), Timezone (name, note on recompute), Connections (per-bank watermark and last error), Tagging (last run report, Re-run tagging button) |
| `/explorer` | runs table gains "held" column (connections whose watermark did not advance); run detail shows attribution per error |

Empty states follow the phase 1 pattern: each page says what the section is for and offers the
one action that fills it. Copy is sentence case, active voice; buttons name the outcome ("Save
category", "Link transaction", "Add payment").

Keyboard: every inline control reachable and operable without a mouse; forms submit on Enter.
`prefers-reduced-motion` respected (no motion is added).

## 13. API

All under the existing `x-api-key` guard and `withApiErrors`.

- `GET /api/v1/summary` adds
  `debts: { remaining: [{currency, remainingCents}], open: n }` and
  `budget: { month: "YYYY-MM", totals: [{currency, capCents, spentCents}] }`.
- `GET /api/v1/spending?range=` excludes transfers, buckets by `local_date`, and adds
  `byCategory: [{ categoryId|null, name, currency, outflowCents }]`.
- `GET /api/v1/upcoming?days=7` (1–60, default 7) →
  `{ generatedAt, today, items: [{ kind: "recurring"|"debt", id, name, currency, amountCents, dueOn, status }] }`
  sorted by `dueOn`; recurring items are unpaid periods due within the window (including
  overdue ones); debt items are unpaid instalments or payoff dates within the window.
- `POST /api/tag` → runs `applyTagging`, returns the report (same-origin allowed like
  `/api/sync`, used by the Settings button).

## 14. CLI

`npm run tag` → `scripts/tag.ts`: runs `applyTagging` and prints the report; exit 1 on error.
`scripts/sync.ts` prints the tagging report line when present.

## 15. Testing

Vitest, in-memory SQLite via the existing helpers; new seed helpers for categories, rules,
recurring costs, debts.

Unit:
- `time`: `toLocalDate` on both sides of the 2026-03-08 and 2026-11-01 DST transitions in
  `America/Toronto`; `monthBounds` for February in a leap year; `addMonths` clamping (Jan 31 → Feb 28).
- `tagging/rules`: contains vs regex, case folding, `any` field, account and amount filters,
  priority ordering, invalid regex skipped.
- `tagging/transfers`: pairs within 3 days, ignores same-account, ignores different currency,
  nearest-date wins, one partner each, pending excluded.
- `tagging/recurringMatch`: tolerance bounds, account restriction, nearest-to-due wins, transfers excluded.
- `recurring/schedule`: projection for each cadence including month-end clamping; period window;
  paid/due/overdue; monthly equivalents.
- `debts/schedule`: remaining, instalment spill-over, nextDue for scheduled, deferred, and due_day
  debts; status precedence.
- `sync/attribution`: conn_id, unique name match, ambiguous name, no match.
- `config`: `TIMEZONE` default and invalid value.

Integration:
- `applyTagging` idempotence (second run reports zero changes); manual category survives a pass;
  deleting a rule clears its categories; a rule edit re-tags history; recurring auto link
  replaced by a better match; manual recurring link survives.
- Sync engine: watermarks advance per connection; attributed error holds only that connection;
  unattributed error holds all; recovered connection widens the next window to its watermark;
  `local_date` written on upsert; stale run swept; tagging failure marks run partial.
- Bootstrap: backfill, seed once, watermark seed, timezone recompute, versioned so a second boot
  is a no-op.
- Queries: `budgetMonth` spent/pace/uncategorised with transfers excluded and hidden accounts
  excluded; `listWithStatus` for recurring and debts; `upcoming`; `linkTransaction` rejects a
  second link.

API: `upcoming` param validation and payload shape; `summary` and `spending` additions;
`POST /api/tag` auth and same-origin.

UI: each new page rendered with seeded data and reviewed as a screenshot against the design
direction in the task review (as in phase 1).

## 16. Error handling summary

| situation | behaviour |
| --- | --- |
| Invalid regex in a rule | rejected on save with a message; an existing rule that fails to compile is skipped by the pass and listed on Settings |
| Tagging pass throws after sync | run marked `partial`, `error = "tagging: …"`, bank data kept |
| Link a transaction already linked | server action returns a message naming the debt it is linked to |
| Debt payment exceeds remaining | allowed; remaining shows 0 and the overpayment amount in `.small` |
| `TIMEZONE` invalid | `ConfigError` at boot, same handling as other config errors |
| Timezone changed | recompute at boot; Settings shows the active zone and when it was applied |
| Errlist item names no known connection | unattributed; all watermarks held; Explorer shows "not attributed" |

## 17. Phase roadmap (updated)

1. Phase 1: sync, storage, explorer, dashboards, minimal API. Done 2026-09-10.
2. **Phase 2 (this spec)**: categories and rules, transfers, budgets, recurring costs, debts,
   timezone, per-connection watermarks, housekeeping.
3. Phase 3: Magic Frame module polling `/api/v1/summary`, `/api/v1/spending`, `/api/v1/upcoming`;
   reminder texts; decision on debts in net worth; richer daily summary.
