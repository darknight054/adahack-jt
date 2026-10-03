import L from 'leaflet'
import { iconSvg } from './icons'

// Standard OpenStreetMap tiles (free and keyless, attribution required). CSS washes them out (see .osm in
// styles.css) so the routes and pins carry the colour.
export const TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

/** Leaflet draws lines as SVG attributes, which can't read CSS variables, so resolve them first. */
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()

/** A round pin with a white icon. `colour` is any CSS colour, including var(). */
export const pin = (icon, colour, { size = 26, className = '' } = {}) => L.divIcon({
  className: `pin ${className}`,
  html: `<span style="--c:${colour}">${iconSvg(icon, Math.round(size * 0.56))}</span>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
  tooltipAnchor: [0, -size / 2],
})

/**
 * A person as initials in their team colour. The badge shows how many others share the spot, or a mode icon.
 */
export const personPin = (person, { className = '', more = 0, mode, size = 32 } = {}) => L.divIcon({
  className: `person-pin ${className}`,
  html: `<span style="--team:${person.colour}">${person.initials}</span>` +
    (more ? `<b>+${more}</b>` : mode ? `<b class="mode" style="--c:var(--${mode})">${iconSvg(mode, 11)}</b>` : ''),
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
  tooltipAnchor: [0, -size / 2],
})

/** A neighbourhood's colleagues as a circle sized and labelled by the count. */
export const crowdPin = (count, mode) => {
  const size = 18 + Math.min(count, 8) * 2
  return L.divIcon({
    className: 'crowd-pin',
    html: `<span style="--c:var(--${mode})">${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [size / 2, 0],
  })
}

/** Lets a Leaflet line draw itself in once with the CSS `draw` animation. */
export const drawIn = (delayMs) => ({
  add: (e) => {
    const el = e.target.getElement()
    el?.setAttribute('pathLength', '1')
    if (el) el.style.animationDelay = `${delayMs}ms`
  },
})

/** The point a fraction `t` (0 to 1) of the way along a line, by distance. */
export function pointAlong(coords, t) {
  const k = Math.cos((coords[0][0] * Math.PI) / 180)
  const seg = coords.slice(1).map((b, i) => Math.hypot(b[0] - coords[i][0], (b[1] - coords[i][1]) * k))
  let left = seg.reduce((a, b) => a + b, 0) * Math.min(Math.max(t, 0), 1)
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const f = seg[i] ? left / seg[i] : 0
      const [a, b] = [coords[i], coords[i + 1]]
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    }
    left -= seg[i]
  }
  return coords.at(-1)
}
