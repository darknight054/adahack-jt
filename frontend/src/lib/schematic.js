// Turns routed [lat, lon] lines into a transit-diagram drawing: simplified, every leg snapped to 45°,
// and built outwards from the office so every line ends at the same station.
const EARTH_R = 6371000
const STEP = Math.PI / 4

function projector([lat0, lon0]) {
  const k = Math.cos((lat0 * Math.PI) / 180)
  return ([lat, lon]) => [
    ((lon - lon0) * Math.PI * EARTH_R * k) / 180,
    (-(lat - lat0) * Math.PI * EARTH_R) / 180,
  ]
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

function simplify(pts, tolerance) {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let best = -1
    let bestDist = tolerance
    for (let i = a + 1; i < b; i++) {
      const dist = distToSegment(pts[i], pts[a], pts[b])
      if (dist > bestDist) [best, bestDist] = [i, dist]
    }
    if (best > 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function octilinear(pts) {
  const rev = [...pts].reverse()
  const out = [rev[0]]
  let prevAngle = null
  for (let i = 1; i < rev.length; i++) {
    const dx = rev[i][0] - rev[i - 1][0]
    const dy = rev[i][1] - rev[i - 1][1]
    const len = Math.hypot(dx, dy)
    if (!len) continue
    const angle = Math.round(Math.atan2(dy, dx) / STEP) * STEP
    const last = out.at(-1)
    const next = [last[0] + Math.cos(angle) * len, last[1] + Math.sin(angle) * len]
    if (angle === prevAngle) out[out.length - 1] = next
    else out.push(next)
    prevAngle = angle
  }
  return out.reverse()
}


/** SVG path through pts with rounded bends. */
export function roundedPath(pts, radius) {
  const f = (n) => n.toFixed(1)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [p0, p1, p2] = [pts[i - 1], pts[i], pts[i + 1]]
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const r = Math.min(radius, l1 / 2, l2 / 2)
    const a = [p1[0] + ((p0[0] - p1[0]) / l1) * r, p1[1] + ((p0[1] - p1[1]) / l1) * r]
    const b = [p1[0] + ((p2[0] - p1[0]) / l2) * r, p1[1] + ((p2[1] - p1[1]) / l2) * r]
    d += ` L${f(a[0])} ${f(a[1])} Q${f(p1[0])} ${f(p1[1])} ${f(b[0])} ${f(b[1])}`
  }
  const last = pts.at(-1)
  return `${d} L${f(last[0])} ${f(last[1])}`
}

/**
 * Lay out several lines that all end at `office`, scaled into a `size`-unit-wide box.
 * `points` are extra [lat, lon] markers placed in the same frame (approximate, since lines are straightened).
 * Returns the lines and points in that box, the office position and the viewBox height.
 */
export function layoutLines(lines, office, { size = 1000, pad = 60, tolerance = 80, points = [] } = {}) {
  const project = projector([office.lat, office.lon])
  const drawn = lines.map((coords) => octilinear(simplify(coords.map(project), tolerance)))
  const marks = points.map(project)
  const all = drawn.flat().concat([[0, 0]], marks)
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const scale = (size - 2 * pad) / Math.max(maxX - minX, maxY - minY, 1)
  const left = pad + (size - 2 * pad - (maxX - minX) * scale) / 2
  const fit = ([x, y]) => [left + (x - minX) * scale, pad + (y - minY) * scale]
  return {
    lines: drawn.map((pts) => pts.map(fit)),
    points: marks.map(fit),
    office: fit([0, 0]),
    width: size,
    height: Math.ceil((maxY - minY) * scale + 2 * pad),
  }
}
