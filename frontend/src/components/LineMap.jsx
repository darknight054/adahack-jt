import { useMemo } from 'react'
import { layoutLines, roundedPath } from '../lib/schematic'

const unit = ([x, y]) => {
  const len = Math.hypot(x, y) || 1
  return [x / len, y / len]
}

function startLabel(pts, office, gap) {
  const [x, y] = pts[0]
  const [dx, dy] = unit([x - office[0], y - office[1]])
  const anchor = dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle'
  return { x: x + dx * gap, y: y + dy * gap + (dy > 0.35 ? gap * 0.6 : dy < -0.35 ? 0 : 6), anchor }
}

/**
 * A transit-style diagram of lines that all end at the office.
 * lines: [{ id, coords, colour, width, opacity, label, labelClass }]
 */
export default function LineMap({
  office, lines, animate = false, tolerance = 80, labelSize = 22, title,
}) {
  const layout = useMemo(
    () => layoutLines(lines.map((l) => l.coords), office, { tolerance }),
    [lines, office, tolerance],
  )
  const officePt = layout.office
  const labels = useMemo(() => {
    const placed = []
    return lines.map((l, i) => {
      if (!l.label) return null
      const p = startLabel(layout.lines[i], layout.office, l.width + 10)
      const w = l.label.length * labelSize * 0.55
      const box = () => {
        const x0 = p.anchor === 'start' ? p.x : p.anchor === 'end' ? p.x - w : p.x - w / 2
        return [x0, p.y - labelSize, x0 + w, p.y]
      }
      const hits = (a) => placed.some((b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3])
      for (let tries = 0; tries < 4 && hits(box()); tries++) p.y += labelSize * 1.1
      placed.push(box())
      return p
    })
  }, [lines, layout, labelSize])
  return (
    <svg className="line-map" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={title}>
      {lines.map((l, i) => {
        const pts = layout.lines[i]
        const [nx, ny] = unit([-(pts[1][1] - pts[0][1]), pts[1][0] - pts[0][0]])
        const bar = l.width * 1.4
        const delay = animate ? { animationDelay: `${i * 70}ms` } : undefined
        return (
          <g key={l.id} opacity={l.opacity}>
            <path
              className={animate ? 'route draw' : 'route'}
              d={roundedPath(pts, 40)}
              pathLength={animate ? 1 : undefined}
              stroke={l.colour}
              strokeWidth={l.width}
              style={delay}
            />
            <line
              className={animate ? 'fade-in' : undefined}
              style={animate ? { animationDelay: `${1100 + i * 70}ms` } : undefined}
              x1={pts[0][0] - nx * bar} y1={pts[0][1] - ny * bar}
              x2={pts[0][0] + nx * bar} y2={pts[0][1] + ny * bar}
              stroke={l.colour} strokeWidth={l.width * 0.9} strokeLinecap="round"
            />
            {labels[i] && (() => {
              const p = labels[i]
              return (
                <text
                  className={`label ${l.labelClass ?? ''} ${animate ? 'fade-in' : ''}`}
                  style={animate ? { animationDelay: `${1200 + i * 70}ms` } : undefined}
                  x={p.x} y={p.y} textAnchor={p.anchor} fontSize={labelSize}
                >
                  {l.label}
                </text>
              )
            })()}
          </g>
        )
      })}

      <g className={animate ? 'fade-in' : undefined} style={animate ? { animationDelay: '900ms' } : undefined}>
        <circle cx={officePt[0]} cy={officePt[1]} r="22" fill="var(--plate)" stroke="var(--ink)" strokeWidth="9" />
        <text className="label" x={officePt[0] + 36} y={officePt[1] - 30} fontSize={labelSize * 1.15}>
          {office.short_name}
        </text>
      </g>
    </svg>
  )
}
