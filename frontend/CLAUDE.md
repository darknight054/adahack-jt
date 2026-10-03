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
- Mode ids and stop categories are also CSS variable names (`var(--walk)`, `var(--cycle)`, `var(--coffee)`, `var(--breakfast)`, `var(--scenic)`) and keys in `src/lib/icons.js`.
- Leaflet lines are SVG attributes, which can't read CSS variables, so use `cssVar()` from `src/lib/map.js`. Marker HTML (`pin`, `personPin`, `crowdPin`) can use `var(--x)`.
- Map tiles:
  - they come from `tile.openstreetmap.org`; keep the attribution
  - CSS washes them out (`.osm .leaflet-tile-pane`) so the routes and pins stand out
  - CARTO, Stadia and similar basemaps now need API keys; the rule is keyless
- Icons are Lucide, imported by name in `src/lib/icons.js` (that keeps tree-shaking working). Use `<Icon name>` in React and `iconSvg()` inside Leaflet HTML.
- `RouteMap` and `NetworkMap` are `React.lazy`-loaded so Leaflet stays out of the main bundle. Keep imports of `leaflet` and `lib/map.js` inside map components.
- Commute tracking (`CommuteTracker`):
  - it only works while the page is visible
  - it holds a screen Wake Lock and posts points every `upload_every_s`
  - the door screen is `/door?key=<staff key>`; its QR opens `/route?c=<code>`
- The Doto dot-matrix font is for large board numbers only.

## Design rules
- London transit look:
  - dark sign plates for page titles
  - amber dot-matrix boards for the leaderboard and tickers
  - quiet maps where only our lines and pins have colour
- Keep pages calm. Show the first few items of a long list with a "Show all" link or a scroll box, and hide zero rows.
- Copy is sentence case, with no all-caps labels and no "→" on buttons. Errors say what happened and what to do.
- Motion only responds to user actions, except the Home map draw-in and the pulse on live teammates. `prefers-reduced-motion` is handled globally.
