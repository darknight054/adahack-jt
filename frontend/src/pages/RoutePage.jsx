import { useMemo, useState } from 'react'
import { useConfig, useLogTree, useRoutes, useStops, useTeamTrees, useTrips, useWallet } from '../api/hooks'
import CommuteTracker from '../components/CommuteTracker'
import RouteMap from '../components/RouteMap'
import Query from '../components/Query'
import { fmtAgo, fmtGbp, fmtInt, fmtOne, fmtSigned } from '../lib/format'
import './RoutePage.css'

const CATEGORIES = [
  { id: 'coffee', label: 'Coffee' },
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'scenic', label: 'Scenic' },
]
const KM_PER_MI = 1.609344

function StopList({ stops, selectedStop, onSelect }) {
  const [category, setCategory] = useState(null)
  const shown = stops.filter((s) => !category || s.category === category)
  return (
    <section className="panel" aria-labelledby="stops-title">
      <div className="panel-head">
        <h2 id="stops-title">Stops on the way</h2>
        <div className="segmented" role="group" aria-label="Filter stops">
          <button aria-pressed={!category} onClick={() => setCategory(null)}>All {stops.length}</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              <span className={`swatch ${c.id}`} /> {c.label} {stops.filter((s) => s.category === c.id).length}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted">Nothing in this category within a short detour of the route.</p>
      ) : (
        <ol className="stops">
          {shown.map((s) => (
            <li key={s.id}>
              <button className={s.id === selectedStop ? 'stop-row selected' : 'stop-row'} onClick={() => onSelect(s.id)}>
                <span className={`swatch ${s.category}`} aria-hidden="true" />
                <span className="stop-name">{s.name}</span>
                <span className="stop-meta">
                  {s.subtype}, {fmtOne(s.along_km / KM_PER_MI)} mi in
                </span>
                <span className="stop-detour">{s.detour_min ? `+${s.detour_min} min` : 'On route'}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function TripSummary({ route, config }) {
  const s = route.stats
  return (
    <section className="panel trip" aria-labelledby="trip-title">
      <div className="panel-head">
        <h2 id="trip-title">This trip</h2>
        <span className="muted">{config.modes[route.mode].label}, {route.distance_mi} mi</span>
      </div>
      <p className="trip-credits gain">
        {fmtSigned(route.credits)} <span>credits each way</span>
      </p>
      <p className="muted cap">Earnings are capped at {config.credits.daily_cap} credits a day.</p>
      <dl className="facts">
        <div><dt>Time</dt><dd>{s.active_min} min <span className="muted">vs {s.car_min} min driving at rush hour</span></dd></div>
        <div><dt>Not driving saves</dt><dd>{fmtGbp(s.money_day_gbp * 100)} a day <span className="muted">charge, parking, fuel</span></dd></div>
        <div><dt>CO₂ avoided</dt><dd>{fmtOne(s.co2_kg_day)} kg a day</dd></div>
        <div><dt>Energy</dt><dd>{fmtInt(s.kcal_trip)} kcal</dd></div>
      </dl>
    </section>
  )
}

function Wallet({ wallet }) {
  const w = wallet.week
  const rows = [
    ['Carried over from last week', w.carried_over],
    ['Weekly allowance', w.allowance],
    ['Earned walking, cycling and trees', w.earned],
    ['Parking penalties', -w.penalties],
    ['Bought on the exchange', w.bought],
    ['Sold on the exchange', -w.sold],
    ['Converted to tokens or cash', -w.converted],
  ]
  return (
    <section className="panel" aria-labelledby="wallet-title">
      <div className="panel-head">
        <h2 id="wallet-title">My credits</h2>
        <span className="muted">This week</span>
      </div>
      <span className="dot-readout big">{fmtInt(wallet.balance)}<small>credits</small></span>
      <ul className="ledger compact">
        {rows.map(([label, n]) => (
          <li key={label}>
            <span />
            <span>{label}</span>
            <span className={`amount ${n > 0 ? 'gain' : n < 0 ? 'loss' : 'muted'}`}>{fmtSigned(n)}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        {fmtInt(wallet.sellable)} earned credits are free to sell
        {wallet.listed > 0 && <>, and {fmtInt(wallet.listed)} are already listed</>}. The allowance can be spent but not sold.
      </p>
    </section>
  )
}

function TreeLog({ config }) {
  const log = useLogTree()
  const submit = (e) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const send = () => log.mutate(form)
    navigator.geolocation.getCurrentPosition((p) => {
      form.set('lat', p.coords.latitude)
      form.set('lon', p.coords.longitude)
      send()
    }, send, { timeout: 8000 })
  }
  return (
    <section className="panel" aria-labelledby="tree-title">
      <div className="panel-head">
        <h2 id="tree-title">Planted a tree?</h2>
        <span className="gain">{fmtSigned(config.credits.tree_planted)}</span>
      </div>
      {log.isSuccess ? (
        <p className="note">
          Photo sent for review. You’ll get {fmtSigned(log.data.credits)} credits once it’s approved, and your team will
          see the tree on their map.
        </p>
      ) : (
        <form className="tree-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="tree-place">Where you planted it</label>
            <input id="tree-place" name="place" placeholder="Park or street" required />
          </div>
          <div className="field">
            <label htmlFor="tree-photo">Photo of the tree you planted</label>
            <input id="tree-photo" name="photo" type="file" accept="image/*" capture="environment" required />
          </div>
          {log.error && <p className="note error">{log.error.message}</p>}
          <button className="btn" disabled={log.isPending}>{log.isPending ? 'Sending…' : 'Send photo'}</button>
        </form>
      )}
    </section>
  )
}

function Trips({ data, config }) {
  const { trips, week } = data
  return (
    <section className="panel" aria-labelledby="trips-title">
      <div className="panel-head">
        <h2 id="trips-title">My recent commutes</h2>
      </div>
      <p className="saved">
        Not driving this week saved <strong>{fmtGbp(week.money_saved_gbp * 100)}</strong> and{' '}
        <strong>{fmtOne(week.co2_kg_avoided)} kg</strong> of CO₂ over {week.commutes} commutes.
      </p>
      {trips.length === 0 ? (
        <p className="muted">No commutes logged yet this week.</p>
      ) : (
        <ul className="ledger">
          {trips.map((t) => (
            <li key={t.id}>
              <span className={`mode-pip ${t.mode}`} title={(config.modes[t.mode] ?? config.flat_trips[t.mode]).label} />
              <span>
                {t.route_name}
                <span className="sub">
                  {' '}{t.distance_mi != null && `${fmtOne(t.distance_mi)} mi, `}{fmtAgo(t.at)}
                  {t.co2_kg_avoided > 0 && `, ${fmtOne(t.co2_kg_avoided)} kg CO₂ and ${fmtGbp(t.fuel_gbp_saved * 100)} fuel saved`}
                  {t.status !== 'verified' && `, ${t.status === 'review' ? 'being checked' : t.status}`}
                </span>
              </span>
              <span className="amount gain">{fmtSigned(t.credits)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RouteView({ config, data }) {
  const [routeId, setRouteId] = useState(data.routes[0].id)
  const [selectedStop, setSelectedStop] = useState(null)
  const route = data.routes.find((r) => r.id === routeId)
  const stops = useStops(routeId)
  const wallet = useWallet()
  const teamTrees = useTeamTrees()
  const trips = useTrips()

  const trees = useMemo(
    () => (teamTrees.data ?? []).map((t) => ({
      id: `${t.user.id}-${t.place}`,
      lat: t.lat,
      lon: t.lon,
      count: t.trees,
      label: `${t.user.name} planted ${t.trees} ${t.trees === 1 ? 'tree' : 'trees'} at ${t.place}`,
    })),
    [teamTrees.data],
  )

  const pickRoute = (id) => {
    setRouteId(id)
    setSelectedStop(null)
  }

  return (
    <>
      <header className="sign" style={{ '--line': `var(--${route.mode})` }}>
        <h1>{data.home_label} to {config.office.short_name}</h1>
        <span className="sign-meta">{data.routes.length} usual routes</span>
      </header>

      <div className="route-options" role="radiogroup" aria-label="Choose a route">
        {data.routes.map((r) => (
          <button
            key={r.id}
            role="radio"
            aria-checked={r.id === routeId}
            className="route-option"
            style={{ '--line': `var(--${r.mode})` }}
            onClick={() => pickRoute(r.id)}
          >
            <span className="route-name">{r.name}</span>
            <span className="route-facts">
              <span>{config.modes[r.mode].label}</span>
              <span>{r.duration_min} min</span>
              <span>{r.distance_mi} mi</span>
              <span className="gain">{fmtSigned(r.credits)} cr</span>
            </span>
          </button>
        ))}
      </div>

      <div className="route-grid">
        <div className="route-main">
          <RouteMap
            office={config.office}
            homeLabel={data.home_label}
            routes={data.routes}
            selected={route}
            onPickRoute={pickRoute}
            stops={stops.data}
            trees={trees}
            selectedStop={selectedStop}
            onSelectStop={setSelectedStop}
          />
          <Query q={stops} loading="Finding cafés and sights along the route…">
            {(s) => <StopList key={routeId} stops={s} selectedStop={selectedStop} onSelect={setSelectedStop} />}
          </Query>
        </div>
        <aside className="route-side">
          <CommuteTracker config={config} defaultMode={route.mode} />
          <TripSummary route={route} config={config} />
          <Query q={wallet}>{(w) => <Wallet wallet={w} />}</Query>
          <Query q={trips}>{(t) => <Trips data={t} config={config} />}</Query>
          <TreeLog config={config} />
        </aside>
      </div>
    </>
  )
}

export default function RoutePage() {
  const config = useConfig()
  const routes = useRoutes()
  return (
    <main className="page route-page">
      <Query q={[config, routes]}>
        {(cfg, data) =>
          data.routes.length ? (
            <RouteView config={cfg} data={data} />
          ) : (
            <p className="note">Add your home postcode to see your usual routes to the office.</p>
          )
        }
      </Query>
    </main>
  )
}
