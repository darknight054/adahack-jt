const int = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })
const rel = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const shortDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export const fmtInt = (n) => int.format(n)
export const fmtOne = (n) => one.format(n)
export const fmtCredits = (n) => `${int.format(n)} cr`
export const fmtSigned = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${int.format(Math.abs(n))}`
export const fmtPence = (p) => `${one.format(p)}p`
export const fmtGbp = (pence) => gbp.format(pence / 100)
export const fmtCompact = (n) => compact.format(n)
export const fmtDay = (iso) => day.format(new Date(iso))
export const fmtShortDay = (iso) => shortDay.format(new Date(iso))

export function fmtAgo(iso) {
  const secs = Math.round((Date.parse(iso) - Date.now()) / 1000)
  if (Math.abs(secs) < 60) return rel.format(secs, 'second')
  const mins = Math.round(secs / 60)
  if (Math.abs(mins) < 60) return rel.format(mins, 'minute')
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 24) return rel.format(hours, 'hour')
  return rel.format(Math.round(hours / 24), 'day')
}

export function fmtCountdown(iso) {
  const mins = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  return d ? `${d}d ${h}h` : `${h}h ${mins % 60}m`
}
