import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()

function FitTo({ coords }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(coords, { padding: [36, 36] })
  }, [map, coords])
  return null
}

const treeIcon = (count) => L.divIcon({
  className: 'tree-pin',
  html: `<span>${count > 1 ? count : ''}</span>`,
  iconSize: [30, 30],
  iconAnchor: [15, 28],
})

/** OpenStreetMap with the chosen route, the alternatives, stops along it and teammates' trees. */
export default function RouteMap({ office, homeLabel, routes, selected, onPickRoute, stops, trees, selectedStop, onSelectStop }) {
  const colours = useMemo(() => ({
    walk: cssVar('walk'), cycle: cssVar('cycle'), ink: cssVar('ink'), rule: cssVar('ink-soft'),
    coffee: cssVar('coffee'), breakfast: cssVar('breakfast'), scenic: cssVar('scenic'),
  }), [])
  const start = selected.coords[0]
  return (
    <MapContainer className="osm" center={[office.lat, office.lon]} zoom={14} scrollWheelZoom={false}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <FitTo coords={selected.coords} />
      {routes.filter((r) => r.id !== selected.id).map((r) => (
        <Polyline key={r.id} positions={r.coords} eventHandlers={{ click: () => onPickRoute(r.id) }}
          pathOptions={{ color: colours.rule, weight: 5, opacity: 0.45, dashArray: '2 8' }}>
          <Tooltip sticky>{r.name}</Tooltip>
        </Polyline>
      ))}
      <Polyline positions={selected.coords} pathOptions={{ color: colours[selected.mode], weight: 7, opacity: 0.95 }} />
      {(stops ?? []).map((s) => (
        <CircleMarker key={s.id} center={[s.lat, s.lon]} radius={s.id === selectedStop ? 10 : 7}
          eventHandlers={{ click: () => onSelectStop(s.id) }}
          pathOptions={{ color: '#fff', weight: 2, fillColor: colours[s.category], fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -6]} permanent={s.id === selectedStop}>{s.name}</Tooltip>
        </CircleMarker>
      ))}
      {(trees ?? []).map((t) => (
        <Marker key={t.id} position={[t.lat, t.lon]} icon={treeIcon(t.count)}>
          <Tooltip direction="top" offset={[0, -24]}>{t.label}</Tooltip>
        </Marker>
      ))}
      <CircleMarker center={start} radius={8} pathOptions={{ color: colours.ink, weight: 4, fillColor: '#fff', fillOpacity: 1 }}>
        <Tooltip permanent direction="left" offset={[-10, 0]}>{homeLabel}</Tooltip>
      </CircleMarker>
      <CircleMarker center={[office.lat, office.lon]} radius={11}
        pathOptions={{ color: colours.ink, weight: 6, fillColor: '#fff', fillOpacity: 1 }}>
        <Tooltip permanent direction="right" offset={[12, 0]}>{office.short_name}</Tooltip>
      </CircleMarker>
    </MapContainer>
  )
}
