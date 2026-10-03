# Backend

- Use uv only: `uv add <pkg>` for dependencies, `uv run ...` to run things. Never create requirements.txt or use pip.
- Run: `uv run uvicorn app.main:app --reload --port 8000`. There are no tests (by choice); check changes against http://localhost:8000/docs.
- External APIs must be free and keyless.
- Constants (emission factors, prices, credit rates) live in `app/config.py` with their source. The frontend reads them from `/api/config`, so never duplicate them there. The floor and Jane Street (house) prices live in the `settings` table, not in config.

## Database
- SQLite at `data/street_miles.db`, committed to git on purpose (Vercel free plan, no hosted DB).
- `uv run python -m app.seed` rebuilds it from scratch:
  - it takes a few minutes and calls OSRM and Overpass
  - Overpass often returns 504; the seed retries
  - its history is relative to when it was run, so re-seed if "this week" looks empty
- There are no migrations. Change `app/schema.sql` and re-seed.
- On Vercel (`VERCEL` env set), `db.py` copies the DB to `/tmp`. Writes are per instance and vanish when the instance is recycled. That's fine for a demo, but not for real use.
- Every write goes through `with write(conn)` (`BEGIN IMMEDIATE`). Connections are autocommit otherwise.

## Rules that live in code
- **Credits:**
  - every movement is a `ledger` row; balance is the sum
  - allowance and team bonus rows use `ref` plus the UNIQUE `(user_id, kind, ref)` constraint, so they can't be paid twice
  - the weekly allowance and last week's team bonus are granted lazily in `economy.ensure_current`, which runs on every authenticated request
- **Trips:** compute credits from the OSRM routed distance, never a client distance. Trips under 0.5 mi earn 0; earnings cap at 300 a day; parking that day voids the credit.
- **Selling:** only earned credits are sellable (`economy.sellable`). Listings need floor ≤ teammate price ≤ global price < house price.
- **Prices** are stored in tenths of a penny (`*_dp`). The API speaks pence.
- **Buys:** `POST /api/market/buy` re-checks quantity and price inside the write transaction and returns 409 on any change.

## Auth and secrets
- Sessions are HMAC-signed cookies (`app/auth.py`) rather than a table, because Vercel instances don't share writes.
- Secrets come from the env (`SESSION_SECRET`, `OFFICE_TOTP_SECRET`, `STAFF_KEY`), falling back to the `settings` table that the seed fills. The repo DB holds those fallbacks, so set the env vars for anything public.
- `TRACKING_OFFICE="lat,lon"` moves the commute finish line, for demos away from London.
