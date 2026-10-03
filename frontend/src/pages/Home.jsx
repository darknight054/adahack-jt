import { lazy, Suspense } from 'react'
import { Link } from 'react-router'
import { useConfig, useLeaderboard, useNetwork, useWeekStats } from '../api/hooks'
import Query from '../components/Query'
import { fmtCompact, fmtInt, fmtOne, fmtSigned } from '../lib/format'
import './Home.css'

// Leaflet only loads on the pages with a map.
const NetworkMap = lazy(() => import('../components/NetworkMap'))

function Week({ config }) {
  const { credits, modes, conversions, flat_trips: flat } = config
  const steps = [
    { when: 'Monday', value: fmtSigned(credits.weekly_allowance), tone: 'gain', title: 'Allowance arrives',
      body: `Jane Street tops everyone up to ${fmtInt(credits.weekly_allowance)} credits for the week ahead.` },
    { when: 'Each commute', value: `${fmtSigned(modes.walk.credits_per_mile)}/mi`, tone: 'gain', title: 'Walk or cycle in',
      body: `Walking earns ${modes.walk.credits_per_mile} credits a mile and cycling ${modes.cycle.credits_per_mile}. A ${flat.bus.label.toLowerCase()} ride earns ${flat.bus.credits} and a ${flat.carshare.label.toLowerCase()} ${flat.carshare.credits}, up to ${credits.daily_cap} a day.` },
    { when: 'Any day', value: fmtSigned(credits.tree_planted), tone: 'gain', title: 'Plant a tree',
      body: `Every tree you plant adds ${credits.tree_planted} credits, and your team sees it on their route page.` },
    { when: 'Each time you drive', value: fmtSigned(-credits.car_park_penalty), tone: 'loss', title: 'Park a car',
      body: `Parking at the office costs ${credits.car_park_penalty} credits. Run out and you buy more from colleagues.` },
    { when: 'Sunday night', value: `${fmtSigned(credits.team_win_bonus)} each`, tone: 'gain', title: 'Top team wins',
      body: `Every member of the team that earned the most gets ${credits.team_win_bonus} bonus credits.` },
  ]
  return (
    <section className="week" aria-labelledby="week-title">
      <div className="week-intro">
        <h2 id="week-title">How a week of credits runs</h2>
        <p className="muted">
          A credit is worth {fmtInt(conversions.tokens_per_credit)} AI coding tokens, or {conversions.pence_per_credit}p
          in cash. Sell what you don’t need on the exchange.
        </p>
      </div>
      <ol className="week-line">
        {steps.map((s) => (
          <li key={s.title}>
            <span className="when">{s.when}</span>
            <span className="stn" aria-hidden="true" />
            <span className={`value ${s.tone}`}>{s.value}</span>
            <h3>{s.title}</h3>
            <p className="muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Winners({ board }) {
  const tie = board.last_winners.length > 1
  return (
    <section className="winners-band" aria-labelledby="winners-title">
      <h2 id="winners-title">{tie ? 'Last week’s joint winners' : 'Last week’s winners'}</h2>
      <ul>
        {board.last_winners.map((w) => (
          <li key={w.id} style={{ '--team': w.colour }}>
            <span className="team-name">{w.name}</span>
            <span className="muted">{fmtInt(w.credits)} credits, {fmtSigned(board.bonus_per_member)} each</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ThisWeek({ stats }) {
  const rows = [
    ['Miles walked', fmtOne(stats.miles_walked)],
    ['Miles cycled', fmtOne(stats.miles_cycled)],
    ['CO₂ avoided', `${fmtInt(stats.co2_kg_avoided)} kg`],
    ['Trees planted', fmtInt(stats.trees_planted)],
    ['Cars parked', fmtInt(stats.car_parks)],
    ['Credits traded', fmtCompact(stats.credits_traded)],
  ]
  return (
    <section className="board this-week" aria-labelledby="tw-title">
      <div className="board-head">
        <span id="tw-title">This week at the office</span>
        <span>{stats.participants} people taking part</span>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function Home() {
  const config = useConfig()
  const network = useNetwork()
  const stats = useWeekStats()
  const board = useLeaderboard()
  return (
    <main className="page home">
      <Query q={config}>
        {(cfg) => (
          <section className="hero">
            <div className="hero-copy">
              <h1>Walk to work. Earn the tokens you code with.</h1>
              <p className="lede">
                Everyone at {cfg.office.name} starts the week with {fmtInt(cfg.credits.weekly_allowance)} credits.
                Walking and cycling in earns more. Parking a car costs {cfg.credits.car_park_penalty}. If you run short,
                you buy credits from colleagues who walked.
              </p>
              <div className="actions">
                <Link className="btn primary" to="/route">See your route</Link>
                <Link className="btn" to="/exchange">Open the exchange</Link>
              </div>
            </div>
            <figure className="hero-map">
              <Query q={network} loading="Drawing this week’s commutes…">
                {(net) => (
                  <Suspense fallback={<div className="osm" />}>
                    <NetworkMap office={cfg.office} network={net} modes={cfg.modes} />
                  </Suspense>
                )}
              </Query>
              <figcaption className="map-key">
                <span><span className="key walk" /> Walking route</span>
                <span><span className="key cycle" /> Cycling route</span>
                <span><span className="crowd-key" /> Colleagues who live there, by count</span>
              </figcaption>
            </figure>
          </section>
        )}
      </Query>
      <Query q={board}>{(b) => <Winners board={b} />}</Query>
      <Query q={stats}>{(s) => <ThisWeek stats={s} />}</Query>
      <Query q={config}>{(cfg) => <Week config={cfg} />}</Query>
    </main>
  )
}
