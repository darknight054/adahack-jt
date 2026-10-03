# adahack-jt
AdaHack 2026, Jane Street challenge: encourage staff who drive to the London office to walk or cycle instead.

## Street Miles

Everyone at Jane Street London gets a weekly allowance of credits. Walking or cycling in, or planting a tree, earns more. Parking a car costs credits. Credits convert to AI coding tokens or cash. Anyone who runs short buys credits from colleagues on an internal exchange, below Jane Street's own price. Teams compete weekly, and every member of the winning team gets a bonus.

Pages:
- **Home:** how it works, with every colleague's commute drawn as a line into the office.
- **Route:** your usual routes, cafés and sights along them, teammates' trees, what not driving saved you, and your credits.
- **Leaderboard:** this week's standings for every team, searchable, with your team's recent activity.
- **Exchange:** buy, sell (with a teammate price and a global price) or convert credits.

## Run

```bash
# backend (needs uv: brew install uv)
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000   # API docs at http://localhost:8000/docs
uv run python -m app.seed                          # optional: rebuild data/street_miles.db (a few minutes)

# frontend
cd frontend
npm install
npm run dev                                        # http://localhost:5173, proxies /api to :8000
```

**Demo login:** any seeded user as `first.last`, e.g. `priya.shah`, with password `streetmiles`.

The door screen for finishing a tracked commute is `/door?key=<staff key>`; the seed prints the key.

## How it works

- FastAPI with SQLite. The database file is committed so it deploys with the code.
- Routes are cached from OSRM and places are imported from OpenStreetMap, so the stops near a route come from a database query.
- Every credit movement is a ledger row. Balances, team standings, prices and weekly stats are all computed from the data.
- Commute tracking is a foreground GPS track plus a rotating code on the office door. The server credits the routed distance, never what the phone reports (see the tracking notes in `docs/`).

## Data sources

All free and keyless:
- routes: OpenStreetMap via FOSSGIS OSRM
- places: the Overpass API

Constants and their sources are in `backend/app/config.py`.
