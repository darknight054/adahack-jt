import { createElement } from 'react'
import { ICONS } from '../lib/icons'

export default function Icon({ name, size = 18, className = '' }) {
  const node = ICONS[name]
  if (!node) return null
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  )
}
