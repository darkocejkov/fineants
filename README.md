# fineants

Personal finance dashboard fed by [SimpleFin Bridge](https://beta-bridge.simplefin.org). Syncs accounts and transactions into a local SQLite file on a schedule, shows balances, net worth, transactions and spending, and exposes a small JSON API for a Magic Frame display.

## Setup

1. `cp .env.example .env` and generate an API key: `openssl rand -hex 32`.
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
- `GET /api/v1/summary` — balances per account and per currency, last sync status. Amounts are integer cents.
- `GET /api/v1/spending?range=today|7d|30d` — daily outflow/inflow and top payees, one row per UTC day per currency:
  ```json
  {
    "range": "7d",
    "days": [{ "date": "2026-09-09", "currency": "CAD", "outflowCents": 4210, "inflowCents": 0 }],
    "topPayees": [{ "label": "Gas", "currency": "CAD", "outflowCents": 8800, "count": 2 }]
  }
  ```

## Scripts

| command | purpose |
| --- | --- |
| `npm run claim -- <token>` | exchange a setup token for an access URL |
| `npm run sync [-- --force]` | sync from the CLI; exits non-zero if the run fails or the access URL is missing or invalid |
| `npm run db:generate` | create a migration after editing `src/lib/db/schema.ts` |
| `npm test` | Vitest (no network) |

## Notes

- SimpleFin limits each request to 90 days and asks for ≤24 requests/day. fineants overlaps windows by 5 days and refuses to sync twice within 30 minutes unless forced.
- Transfers between your own accounts count as spending until phase 2 adds transfer detection.
- The dashboard has no login; keep it on your LAN or behind your own reverse-proxy auth.
- The dashboard's design and the phase 2/3 roadmap are documented under `docs/superpowers/specs/`.
