# Frontend

- Before finishing, run `npm run lint` and `npm run build`. Both must pass.
- `npm run dev` needs the backend on :8000; Vite proxies `/api`. Sign in as `priya.shah` / `streetmiles` (every seeded user is `first.last` with the same password).

## Data
- Never hardcode data or constants (rates, prices, office, dates) in components. Everything goes through `src/api/hooks.js` → `src/api/client.js`. If a value is missing, add it to the backend.
- Units are mixed:
  - market prices are pence per credit and can have decimals (`price_pence`)
  - route stats are in pounds (`money_day_gbp`, `fuel_gbp_saved`)
  - `fmtGbp()` takes pence, so multiply pounds by 100 first
- After a market or wallet mutation, refetch `['market']` and `['wallet']` (see `useWalletMutation`). A buy sends `price_pence` so the server can reject a stale price with a 409.
- A 401 from `/api/me` sends the user to `/login` (`components/Layout.jsx`). The session is an HttpOnly cookie, so the frontend never sees a token.

## Gotchas
- The root `.gitignore` is the Python template. Its `lib/` rule needs the `!frontend/src/lib/` exception, and `/docs` is ignored on purpose.
- Mode ids and stop categories are also CSS variable names: `var(--walk)`, `var(--cycle)`, `var(--coffee)`, `var(--breakfast)`, `var(--scenic)`. Leaflet needs real colours, so `RouteMap` reads them with `getComputedStyle`.
- OSM tiles come from `tile.openstreetmap.org` (keyless; keep the attribution). The tiles are greyscaled in CSS so the route stands out.
- The Home diagram (`LineMap` + `src/lib/schematic.js`) builds lines outwards from the office and snaps them to 45°, so start points are approximate. Memoize `lines` in the caller.
- Commute tracking (`CommuteTracker`):
  - it only works while the page is visible
  - it holds a screen Wake Lock and posts points every `upload_every_s`
  - the door screen is `/door?key=<staff key>`; its QR opens `/route?c=<code>`
- The Doto dot-matrix font is for large board numbers only.

## Design rules
- London transit look:
  - schematic lines on Home
  - dark sign plates for page titles
  - amber dot-matrix boards for the leaderboard and tickers
- Copy is sentence case, with no all-caps labels and no "→" on buttons. Errors say what happened and what to do.
- Motion only responds to user actions, except the Home map draw-in. `prefers-reduced-motion` is handled globally.
