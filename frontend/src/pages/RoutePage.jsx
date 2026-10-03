import { lazy, Suspense, useMemo, useState } from 'react'
import {
  useConfig, useLogTree, useMe, useRoutes, useStops, useTeamMap, useTeamTrees, useTrips, useWallet,
} from '../api/hooks'
import CommuteTracker from '../components/CommuteTracker'
import Icon from '../components/Icon'
import Query from '../components/Query'
import { fmtAgo, fmtGbp, fmtInt, fmtOne, fmtSigned } from '../lib/format'
import './RoutePage.css'

// Leaflet only loads on the pages with a map.
const RouteMap = lazy(() => import('../components/RouteMap'))

const CATEGORIES = [
  { id: 'coffee', label: 'Coffee' },
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'scenic', label: 'Scenic' },
]
const LAYERS = [
  { id: 'stops', icon: 'coffee', label: 'Stops' },
  { id: 'trees', icon: 'tree', label: 'Team trees' },
  { id: 'team', icon: 'people', label: 'Teammates' },
]
const STOPS_SHOWN = 6
const KM_PER_MI = 1.609344

const firstNames = (people) => people.map((p) => p.name.split(' ')[0]).join(', ').replace(/, ([^,]*)$/, ' and $1')

function MapBar({ layers, toggle, counts, team }) {
  const near = (team?.homes ?? []).filter((h) => h.near_me).flatMap((h) => h.people)
  const live = team?.live ?? []
  return (
    <div className="map-bar">
      <div className="layer-toggles" role="group" aria-label="Show on the map">
        {LAYERS.map((l) => (
          <button key={l.id} aria-pressed={layers[l.id]} onClick={() => toggle(l.id)}>
            <Icon name={l.icon} size={16} /> {l.label} <span className="count">{counts[l.id]}</span>
          </button>
        ))}
      </div>
      {live.length > 0 && (
        <p className="map-note"><span className="pulse" aria-hidden="true" /> {firstNames(live.map((l) => l.user))} on the way in now</p>
      )}
      {live.length === 0 && near.length > 0 && (
        <p className="map-note">{firstNames(near)} {near.length > 1 ? 'live' : 'lives'} near you. Commute in together?</p>
      )}
    </div>
  )
}

function StopIcon({ category }) {
  return <span className={`stop-icon ${category}`}><Icon name={category} size={14} /></span>
}

function StopList({ stops, category, setCategory, selectedStop, onSelect }) {
  const [all, setAll] = useState(false)
  const filtered = stops.filter((s) => !category || s.category === category)
  const shown = all ? filtered : filtered.slice(0, STOPS_SHOWN)
  return (
    <section className="panel" aria-labelledby="stops-title">
      <div className="panel-head">
        <h2 id="stops-title">Stops on the way</h2>
        <div className="segmented" role="group" aria-label="Filter stops">
          <button aria-pressed={!category} onClick={() => setCategory(null)}>All {stops.length}</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label} {stops.filter((s) => s.category === c.id).length}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="muted">Nothing in this category within a short detour of the route.</p>
      ) : (
        <>
          <ol className="stops">
            {shown.map((s) => (
              <li key={s.id}>
                <button className={s.id === selectedStop ? 'stop-row selected' : 'stop-row'} onClick={() => onSelect(s.id)}>
                  <StopIcon category={s.category} />
                  <span className="stop-name">{s.name}</span>
                  <span className="stop-meta">{s.subtype}, {fmtOne(s.along_km / KM_PER_MI)} mi in</span>
                  <span className="stop-detour">{s.detour_min ? `+${s.detour_min} min` : 'On route'}</span>
                </button>
              </li>
            ))}
          </ol>
          {filtered.length > STOPS_SHOWN && (
            <button className="link-btn" onClick={() => setAll(!all)}>
              {all ? 'Show fewer stops' : `Show all ${filtered.length} stops`}
            </button>
          )}
        </>
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
        <span className="muted mode-label"><Icon name={route.mode} size={16} /> {config.modes[route.mode].label}, {route.distance_mi} mi</span>
      </div>
      <p className="trip-credits gain">{fmtSigned(route.credits)} <span>credits each way</span></p>
      <dl className="facts">
        <div><dt>Time</dt><dd>{s.active_min} min</dd><dd className="sub">{s.car_min} min by car at rush hour</dd></div>
        <div><dt>Saved vs driving</dt><dd>{fmtGbp(s.money_day_gbp * 100)} a day</dd><dd className="sub">charge, parking, fuel</dd></div>
        <div><dt>CO₂ avoided</dt><dd>{fmtOne(s.co2_kg_day)} kg a day</dd></div>
        <div><dt>Energy</dt><dd>{fmtInt(s.kcal_trip)} kcal</dd></div>
      </dl>
      <p className="muted small">Earnings are capped at {config.credits.daily_cap} credits a day.</p>
    </section>
  )
}

function Wallet({ wallet }) {
  const w = wallet.week
  const rows = [
    ['Carried over', w.carried_over],
    ['Weekly allowance', w.allowance],
    ['Earned', w.earned],
    ['Parking penalties', -w.penalties],
    ['Bought', w.bought],
    ['Sold', -w.sold],
    ['Converted', -w.converted],
  ].filter(([, n]) => n !== 0)
  return (
    <section className="panel" aria-labelledby="wallet-title">
      <div className="panel-head">
        <h2 id="wallet-title">My credits</h2>
        <span className="muted">This week</span>
      </div>
      <span className="dot-readout big">{fmtInt(wallet.balance)}<small>credits</small></span>
      <dl className="split">
        <div><dt>Free to sell</dt><dd>{fmtInt(wallet.sellable)}</dd></div>
        <div><dt>Listed for sale</dt><dd>{fmtInt(wallet.listed)}</dd></div>
      </dl>
      <ul className="ledger compact">
        {rows.map(([label, n]) => (
          <li key={label}>
            <span>{label}</span>
            <span className={`amount ${n > 0 ? 'gain' : 'loss'}`}>{fmtSigned(n)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Only credits you earn can be sold. The allowance is for spending.</p>
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
    <details className="panel fold">
      <summary className="panel-head">
        <h2><Icon name="tree" size={20} /> Planted a tree?</h2>
        <span className="gain">{fmtSigned(config.credits.tree_planted)}</span>
      </summary>
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
    </details>
  )
}

const TRIPS_SHOWN = 5

function Trips({ data, config }) {
  const { trips, week } = data
  return (
    <section className="panel" aria-labelledby="trips-title">
      <div className="panel-head">
        <h2 id="trips-title">Recent commutes</h2>
      </div>
      {week.commutes > 0 && (
        <p className="saved">
          This week {week.commutes} commutes saved <strong>{fmtGbp(week.money_saved_gbp * 100)}</strong> and{' '}
          <strong>{fmtOne(week.co2_kg_avoided)} kg</strong> of CO₂ compared with driving.
        </p>
      )}
      {trips.length === 0 ? (
        <p className="muted">No commutes logged yet. Start one above when you set off.</p>
      ) : (
        <ul className="ledger">
          {trips.slice(0, TRIPS_SHOWN).map((t) => (
            <li key={t.id}>
              <span className={`mode-icon ${t.mode}`} title={(config.modes[t.mode] ?? config.flat_trips[t.mode]).label}>
                <Icon name={t.mode} size={15} />
              </span>
              <span>
                {t.route_name}
                <span className="sub">
                  {' '}{t.distance_mi != null && `${fmtOne(t.distance_mi)} mi, `}{fmtAgo(t.at)}
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
  const [category, setCategory] = useState(null)
  const [layers, setLayers] = useState({ stops: true, trees: true, team: false })
  const [replay, setReplay] = useState(null)
  const me = useMe()
  const route = data.routes.find((r) => r.id === routeId)
  const stops = useStops(routeId)
  const wallet = useWallet()
  const teamTrees = useTeamTrees()
  const team = useTeamMap()
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
  const shownStops = (stops.data ?? []).filter((s) => !category || s.category === category)
  const counts = {
    stops: shownStops.length,
    trees: trees.reduce((n, t) => n + t.count, 0),
    team: (team.data?.homes ?? []).reduce((n, h) => n + h.people.length, 0),
  }

  const pickRoute = (id) => {
    setRouteId(id)
    setSelectedStop(null)
    setReplay(null)
  }
  const pickStop = (id) => {
    setSelectedStop(id)
    setLayers((l) => ({ ...l, stops: true }))
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
              <span className="mode-label"><Icon name={r.mode} size={15} /> {config.modes[r.mode].label}</span>
              <span>{r.duration_min} min</span>
              <span>{r.distance_mi} mi</span>
              <span className="gain">{fmtSigned(r.credits)} cr</span>
            </span>
          </button>
        ))}
      </div>

      <div className="route-grid">
        <div className="route-main">
          <div className="map-wrap">
            <MapBar layers={layers} toggle={(id) => setLayers((l) => ({ ...l, [id]: !l[id] }))} counts={counts}
              team={team.data} />
            <Suspense fallback={<div className="osm" />}>
              <RouteMap
                office={config.office}
                homeLabel={data.home_label}
                routes={data.routes}
                selected={route}
                onPickRoute={pickRoute}
                stops={shownStops}
                trees={trees}
                team={team.data}
                layers={layers}
                replay={replay && me.data ? { ...replay, person: me.data, mode: route.mode } : null}
                selectedStop={selectedStop}
                onSelectStop={pickStop}
              />
            </Suspense>
          </div>
          <Query q={stops} loading="Finding cafés and sights along the route…">
            {(s) => (
              <StopList key={routeId} stops={s} category={category} setCategory={setCategory}
                selectedStop={selectedStop} onSelect={pickStop} />
            )}
          </Query>
        </div>
        <aside className="route-side">
          <CommuteTracker config={config} route={route} routes={data.routes} onPickRoute={pickRoute} onReplay={setReplay} />
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
