import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { TILES, crowdPin, cssVar, drawIn, pin } from '../lib/map'

// Neighbourhoods with at least this many colleagues get a permanent name label; the rest show it on hover.
const LABEL_FROM = 5

function FitAll({ points }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(points, { padding: [28, 28] })
  }, [map, points])
  return null
}

/** Each neighbourhood's usual route into the office, with a bubble counting the colleagues who live there. */
export default function NetworkMap({ office, network, modes }) {
  const colours = useMemo(() => ({ walk: cssVar('walk'), cycle: cssVar('cycle') }), [])
  // Smallest first, so the busiest lines sit on top.
  const lines = useMemo(() => [...network].sort((a, b) => a.colleagues - b.colleagues), [network])
  const points = useMemo(() => [[office.lat, office.lon], ...network.map((n) => n.coords[0])], [network, office])
  return (
    <MapContainer className="osm network" center={[office.lat, office.lon]} zoom={12} zoomSnap={0.25}
      scrollWheelZoom={false}>
      <TileLayer {...TILES} maxZoom={18} />
      <FitAll points={points} />
      {lines.map((n, i) => (
        <Polyline key={n.id} positions={n.coords} interactive={false} eventHandlers={drawIn(i * 35)}
          pathOptions={{ color: colours[n.mode], weight: 2 + Math.min(n.colleagues, 8) * 0.6, opacity: 0.75, className: 'draw' }} />
      ))}
      {lines.map((n) => (
        <Marker key={n.id} position={n.coords[0]} icon={crowdPin(n.colleagues, n.mode)}>
          {n.colleagues >= LABEL_FROM ? (
            <Tooltip permanent direction="right" className="area-label">{n.label}</Tooltip>
          ) : (
            <Tooltip direction="right">
              {n.label}: {n.colleagues} {n.colleagues === 1 ? 'colleague' : 'colleagues'}, usually{' '}
              {modes[n.mode].label.toLowerCase()}
            </Tooltip>
          )}
        </Marker>
      ))}
      <Marker position={[office.lat, office.lon]} icon={pin('office', 'var(--ink)', { size: 38, className: 'office' })}
        zIndexOffset={1000}>
        <Tooltip permanent direction="right" offset={[18, 0]} className="place-label">{office.short_name}</Tooltip>
      </Marker>
    </MapContainer>
  )
}
