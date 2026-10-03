# Backend

FastAPI + SQLite for Street Miles.

## Run

Needs [uv](https://docs.astral.sh/uv/) (`brew install uv`).

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000   # API docs: http://localhost:8000/docs
uv run python -m app.seed                          # rebuild data/street_miles.db (a few minutes, calls OSRM and Overpass)
```

Demo login: `first.last` (e.g. `priya.shah`), password `streetmiles`.

## Layout

- `app/main.py`: the HTTP API (auth, config, routes and stops, trips and tracking, team, leaderboard, wallet, market)
- `app/economy.py`: ledger, weekly allowance, trip awards, team scores and bonus
- `app/market.py`: listings, buying (409 on stale price or quantity), conversions
- `app/trips.py`: commute tracking checks and the rotating door code
- `app/seed.py`: builds the demo database from real OpenStreetMap data
- `app/config.py`: constants with their sources

## Environment

- `SESSION_SECRET`, `OFFICE_TOTP_SECRET`, `STAFF_KEY`: override the demo secrets stored in the DB
- `TRACKING_OFFICE="lat,lon"`: move the commute finish line (for demos away from the office)
- `DATABASE_PATH`: use another SQLite file

## Data sources

- Routes: OpenStreetMap via FOSSGIS OSRM (`routing.openstreetmap.de`)
- Places: OpenStreetMap via the Overpass API
