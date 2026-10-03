# Backend

- Use uv only: `uv add <pkg>` for dependencies, `uv run ...` to run things. Never create requirements.txt or use pip.
- Run: `uv run uvicorn app.main:app --reload --port 8000`. There are no tests (by choice); check changes against http://localhost:8000/docs.
- External APIs must be free and keyless.
- Constants (emission factors, prices, credit rates) live in `app/config.py` with their source. The frontend reads them from `/api/config`, so never duplicate them there. The floor and Jane Street (house) prices live in the `settings` table, not in config.

## Database
- SQLite at `data/street_miles.db`, committed to git on purpose (Vercel free plan, no hosted DB).
- `uv run python -m app.seed` rebuilds people and history in seconds, copying `areas`, `routes`, `places` and `route_stops` from the existing DB:
  - `--refetch` rebuilds those from OSRM and Overpass instead; it takes a few minutes, and Overpass often returns 504 (the seed retries)
  - the seed never uses `rng` while building map data, so reusing it keeps the same people (Priya Shah walks; Petra Shah always drives)
  - its history is relative to when it was run, so re-seed if "this week" looks empty
- There are no migrations. Change `app/schema.sql` and re-seed.
- On Vercel (`VERCEL` env set), `db.py` copies the DB to `/tmp`. Writes are per instance and vanish when the instance is recycled. That's fine for a demo, but not for real use.
- Running the app locally writes to the committed DB (logins pay the allowance lazily; trades and trips add rows). Unless you mean to change the demo data, run `git checkout backend/data/street_miles.db` before committing.
- Every write goes through `with write(conn)` (`BEGIN IMMEDIATE`). Connections are autocommit otherwise.

## Rules that live in code
- **Credits:**
  - every movement is a `ledger` row; balance is the sum
  - allowance and team bonus rows use `ref` plus the UNIQUE `(user_id, kind, ref)` constraint, so they can't be paid twice
  - the weekly allowance and last week's team bonus are granted lazily in `economy.ensure_current`, which runs on every authenticated request
- **Trips:** compute credits from the OSRM routed distance, never a client distance. Trips under 0.5 mi earn 0; earnings cap at 300 a day; parking that day voids the credit.
- **Car-free offers** (`app/switch.py`): only `SWITCH_USUAL_MODES` users can make an offer, with one per day. `tidy()` runs due auctions and expires funded offers lazily on read. Payment goes through `settle()` inside `trips.finish`, never directly. `POST /api/demo/switch/run` runs the next auction early, behind `DEMO_REPLAY`.
- **Demo replay** (`app/demo.py`, on unless `DEMO_REPLAY=0`) drives the real `trips` functions with a simulated `at`. Keep it that way: never add a shortcut that writes credits directly.
- **Selling:** only earned credits are sellable (`economy.sellable`). Listings need floor ≤ teammate price ≤ global price < house price.
- **Prices** are stored in tenths of a penny (`*_dp`). The API speaks pence.
- **Buys:** `POST /api/market/buy` re-checks quantity and price inside the write transaction and returns 409 on any change.

## Auth and secrets
- Sessions are HMAC-signed cookies (`app/auth.py`) rather than a table, because Vercel instances don't share writes.
- Secrets come from the env (`SESSION_SECRET`, `OFFICE_TOTP_SECRET`, `STAFF_KEY`), falling back to the `settings` table that the seed fills. The repo DB holds those fallbacks, so set the env vars for anything public.
- `TRACKING_OFFICE="lat,lon"` moves the commute finish line, for demos away from London.

## Vercel
- The root `vercel.json` uses Services: this folder is the `api` service and gets every `/api/*` request, with the full path.
- Vercel installs from `pyproject.toml` + `uv.lock` and loads `[tool.vercel] entrypoint = "app.main:app"`. Keep runtime deps in `dependencies`; anything else bloats the function.
- The session cookie is `Secure` only when `VERCEL` is set, so local http still works.

## Privacy
- `/api/team/map` shows teammates' home neighbourhoods (area centroids, never addresses). Live positions only come from an *active* tracked trip and disappear `LIVE_HIDE_AFTER_S` after the last point.
