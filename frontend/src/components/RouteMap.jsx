import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { fmtAgo } from '../lib/format'
import { TILES, cssVar, personPin, pin, pointAlong } from '../lib/map'

function FitTo({ points }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(points, { padding: [40, 40], maxZoom: 16 })
  }, [map, points])
  return null
}

/** The demo replay: the user's pin moving along the route, driven directly so the map doesn't re-render. */
function ReplayMarker({ coords, replay }) {
  const marker = useRef(null)
  const icon = useMemo(() => personPin(replay.person, { className: 'live', mode: replay.mode }), [replay])
  useEffect(() => {
    let frame
    const tick = () => {
      const t = (performance.now() - replay.startedAt) / (replay.seconds * 1000)
      marker.current?.setLatLng(pointAlong(coords, t))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [coords, replay])
  return <Marker ref={marker} position={coords[0]} icon={icon} zIndexOffset={1100} interactive={false} />
}

const names = (people) => people.map((p) => p.name.split(' ')[0]).join(', ').replace(/, ([^,]*)$/, ' and $1')

/**
 * The chosen route on a light OpenStreetMap basemap, with the other routes, stops, trees and teammates.
 * `layers` switches stops, trees and teammates on or off.
 */
export default function RouteMap({
  office, homeLabel, routes, selected, onPickRoute, stops, trees, team, layers, replay, selectedStop, onSelectStop,
}) {
  const colours = useMemo(() => ({ walk: cssVar('walk'), cycle: cssVar('cycle'), other: cssVar('ink-soft') }), [])
  const showTeam = layers.team && team
  const fit = useMemo(() => [
    ...selected.coords,
    ...(showTeam ? [...team.homes, ...team.live].map((p) => [p.lat, p.lon]) : []),
  ], [selected, team, showTeam])

  return (
    <MapContainer className="osm" center={[office.lat, office.lon]} zoom={14} scrollWheelZoom={false}>
      <TileLayer {...TILES} maxZoom={19} />
      <FitTo points={fit} />

      {routes.filter((r) => r.id !== selected.id).map((r) => (
        <Polyline key={r.id} positions={r.coords} eventHandlers={{ click: () => onPickRoute(r.id) }}
          pathOptions={{ color: colours.other, weight: 4, opacity: 0.35 }}>
          <Tooltip sticky>Switch to {r.name}</Tooltip>
        </Polyline>
      ))}
      <Polyline positions={selected.coords} interactive={false} pathOptions={{ color: '#fff', weight: 11, opacity: 1 }} />
      <Polyline positions={selected.coords} interactive={false}
        pathOptions={{ color: colours[selected.mode], weight: 6, opacity: 1 }} />

      {layers.stops && (stops ?? []).map((s) => (
        <Marker key={s.id} position={[s.lat, s.lon]}
          icon={pin(s.category, `var(--${s.category})`, { size: s.id === selectedStop ? 34 : 24 })}
          zIndexOffset={s.id === selectedStop ? 500 : 0}
          eventHandlers={{ click: () => onSelectStop(s.id) }}>
          <Tooltip direction="top" permanent={s.id === selectedStop}>{s.name}</Tooltip>
        </Marker>
      ))}

      {layers.trees && trees.map((t) => (
        <Marker key={t.id} position={[t.lat, t.lon]} icon={pin('tree', 'var(--walk)', { size: 28 })}>
          <Tooltip direction="top">{t.label}</Tooltip>
        </Marker>
      ))}

      {showTeam && team.homes.map((h) => (
        <Marker key={h.area} position={[h.lat, h.lon]}
          icon={personPin(h.people[0], { className: 'home', more: h.people.length - 1 })}>
          <Tooltip direction="top">{names(h.people)} {h.people.length > 1 ? 'live' : 'lives'} in {h.area}</Tooltip>
        </Marker>
      ))}
      {showTeam && team.live.map((l) => (
        <Marker key={l.user.id} position={[l.lat, l.lon]} zIndexOffset={800}
          icon={personPin(l.user, { className: l.stale ? 'live stale' : 'live', mode: l.mode })}>
          <Tooltip direction="top" permanent={!l.stale}>{l.user.name.split(' ')[0]}, updated {fmtAgo(l.at)}</Tooltip>
        </Marker>
      ))}

      {replay && <ReplayMarker coords={selected.coords} replay={replay} />}
      <Marker position={selected.coords[0]} icon={pin('home', 'var(--ink)', { size: 30 })} zIndexOffset={600}>
        <Tooltip permanent direction="left" offset={[-14, 0]} className="place-label">{homeLabel}</Tooltip>
      </Marker>
      <Marker position={[office.lat, office.lon]} icon={pin('office', 'var(--ink)', { size: 38, className: 'office' })}
        zIndexOffset={1000}>
        <Tooltip permanent direction="right" offset={[18, 0]} className="place-label">{office.short_name}</Tooltip>
      </Marker>
    </MapContainer>
  )
}
