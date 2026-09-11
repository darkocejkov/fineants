# fineants

Personal finance dashboard fed by [SimpleFin Bridge](https://beta-bridge.simplefin.org). Syncs accounts and transactions into a local SQLite file on a schedule, shows balances, net worth, transactions and spending, and exposes a small JSON API for a Magic Frame display.

## Setup

1. `cp .env.example .env` and generate an API key: `openssl rand -hex 32`. Set `TIMEZONE` if you are not in Eastern time.
2. Get a **setup token** from SimpleFin Bridge, then exchange it once:
   ```bash
   npm install
   npm run claim -- <setup-token>
   ```
   Paste the printed `SIMPLEFIN_ACCESS_URL=…` line into `.env`. The setup token is dead after this; the access URL is the credential. Keep it private.
3. First sync (about 5 requests for a year of history):
   ```bash
   npm run sync
   ```
4. Run the app: `npm run dev` and open http://localhost:3000.

## Docker (home server)

```bash
docker compose up -d --build
```
Data lives in `./data/fineants.db`. Back that file up. The scheduler runs inside the container every `SYNC_INTERVAL_HOURS` at a fixed random minute.

The container starts as root only long enough to make `/data` writable by its own user, then drops privileges. Under a runtime that forbids root, run it with `--user` and make `./data` writable by that uid yourself.

## API

All routes need header `x-api-key: $API_KEY`.

- `POST /api/sync[?force=1]` — run a sync now (409 if one ran under 30 minutes ago, 503 if credentials are invalid or missing).
- `GET /api/v1/summary` — balances per account and per currency, last sync status, debts remaining by currency, and this month's budget totals (spent vs cap). Amounts are integer cents.
- `GET /api/v1/spending?range=today|7d|30d` — daily outflow/inflow, top payees and outflow by category, one row per local day per currency:
  ```json
  {
    "range": "7d",
    "days": [{ "date": "2026-09-09", "currency": "CAD", "outflowCents": 4210, "inflowCents": 0 }],
    "topPayees": [{ "label": "Gas", "currency": "CAD", "outflowCents": 8800, "count": 2 }],
    "byCategory": [{ "categoryId": 3, "name": "Groceries", "currency": "CAD", "outflowCents": 6200 }]
  }
  ```
  Rows are per calendar day in `TIMEZONE`; transfers between your own accounts are excluded; `byCategory` lists outflow per category, `Uncategorised` for none.
- `GET /api/v1/upcoming?days=7` — recurring costs and debts due within `days` (1–60, default 7), sorted by due date:
  ```json
  {
    "generatedAt": "2026-09-11T00:00:00.000Z",
    "today": "2026-09-11",
    "days": 7,
    "items": [
      { "kind": "recurring", "id": 1, "name": "Streaming service", "currency": "CAD", "amountCents": 1599, "dueOn": "2026-09-14", "status": "due" },
      { "kind": "debt", "id": 2, "name": "Laptop", "currency": "CAD", "amountCents": 12000, "dueOn": "2026-09-16", "status": "on_track" }
    ]
  }
  ```
- `POST /api/tag` — re-run categorisation rules, transfer detection and recurring-cost matching; returns counts.

## Scripts

| command | purpose |
| --- | --- |
| `npm run claim -- <token>` | exchange a setup token for an access URL |
| `npm run sync [-- --force]` | sync from the CLI; exits non-zero if the run fails or the access URL is missing or invalid |
| `npm run db:generate` | create a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | apply migrations and data steps to `DATABASE_PATH` |
| `npm run tag` | re-run tagging from the CLI |
| `npm test` | Vitest (no network) |

## Categories and rules

Rules are ordered; the first match wins, and they re-apply to every transaction whenever you add, edit, reorder or delete one. Picking a category by hand in the transaction list pins it, overriding rules until you choose "Use rules again" from the same select. Manage rules, including a "Preview matches" check before saving, under Settings → Rules. The same pass also re-links recurring costs to matching transactions, counted as `recurringMatched` in the tagging report.

## Budget

Set a monthly cap per category, on `/budget` itself or under Settings → Categories. The page shows what each capped category has spent against its cap this month, plus uncapped and uncategorised spend. Pace compares spend so far against the cap times how far the month has run, so a category reads on pace, ahead of pace, or over before the month is out.

## Recurring costs

Add a recurring cost with a cadence (weekly, every two weeks, monthly, yearly, or a custom number of days), an anchor date, and an optional match pattern with a tolerance so matching transactions link to it automatically and, when a transaction has no category of its own, hand it one. `/recurring` lists each cost's cadence, next due date, and status — paid, due, or overdue — with the monthly-equivalent cost so weekly and yearly commitments compare on one footing.

## Debts

Record a debt as buy now pay later, a loan, or other, with either an instalment schedule or a payoff date. Log a payment by hand, or link an existing transaction to it — from the debt's own page or from the transaction's row — and a transaction can pay at most one debt. `/debts` groups debts by lender and totals what's still owed by currency; debts are never counted in net worth.

## Per-bank sync state

Settings → Connections lists each bank's watermark — the date its sync is caught up to — and whether it is clear or held on an error. Explorer's Held column names, per sync run, which bank's watermark did not move, so you know whose window gets fetched again next time.

## Notes

- SimpleFin limits each request to 90 days and asks for ≤24 requests/day. fineants overlaps windows by 5 days and refuses to sync twice within 30 minutes unless forced.
- Transfers between your own accounts are detected automatically (same amount, opposite sign, different accounts, within 3 days) and can be overridden per transaction.
- The dashboard has no login; keep it on your LAN or behind your own reverse-proxy auth.
- The dashboard's design and the phase 2/3 roadmap are documented under `docs/superpowers/specs/`.
