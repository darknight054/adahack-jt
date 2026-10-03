import { useConfig } from '../api/hooks'
import { fmtInt, fmtPence, fmtSigned } from '../lib/format'

/** A round button, bottom right, that shows every way credits are earned and spent on hover or focus. */
export default function CreditsGuide() {
  const config = useConfig()
  if (!config.data) return null
  const { credits: c, modes, flat_trips: flat, conversions: v, market: m } = config.data
  const earn = [
    ...Object.values(modes).map((x) => [`${x.label} to the office`, `${fmtSigned(x.credits_per_mile)} a mile`]),
    ...Object.values(flat).map((x) => [x.label, `${fmtSigned(x.credits)} a trip`]),
    ['Plant a tree (photo checked)', fmtSigned(c.tree_planted)],
    ['Your team wins the week', `${fmtSigned(c.team_win_bonus)} each`],
    ['Every Monday', fmtSigned(c.weekly_allowance)],
  ]
  const spend = [
    ['Park a car at the office', fmtSigned(-c.car_park_penalty)],
    ['Convert to AI coding tokens', `${fmtInt(v.tokens_per_credit)} tokens each`],
    ['Cash out', `${v.pence_per_credit}p each, from ${fmtInt(v.min_cashout_credits)}`],
  ]
  return (
    <div className="guide">
      <button className="guide-btn" aria-describedby="credits-guide" aria-label="How credits work">cr?</button>
      <div className="guide-card" id="credits-guide" role="tooltip">
        <h2>How credits work</h2>
        <h3>Earn</h3>
        <dl>{earn.map(([k, val]) => <div key={k}><dt>{k}</dt><dd className="gain">{val}</dd></div>)}</dl>
        <h3>Spend</h3>
        <dl>{spend.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
        <p className="muted">
          Trips under {c.min_leg_mi} mi earn nothing, and earnings cap at {c.daily_cap} a day. Parking voids that
          day’s commute credit. Only earned credits can be sold, between {fmtPence(m.floor_price_pence)} and
          Jane Street’s {fmtPence(m.house_price_pence)}. Credits carry over; only the leaderboard resets each week.
        </p>
      </div>
    </div>
  )
}
