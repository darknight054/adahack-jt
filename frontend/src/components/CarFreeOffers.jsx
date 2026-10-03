import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { useMakeOffer, useRunAuction, useWithdrawOffer } from '../api/hooks'
import { fmtGbp, fmtInt, fmtOne } from '../lib/format'
import Avatar from './Avatar'

const STATUS = { open: null, funded: 'Funded', waitlisted: 'Waitlisted', paid: 'Paid', expired: 'Expired' }
const runTime = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })

/** Which step this person is on: 0 name a price, 1 wait for the auction, 2 commute, 3 done; -1 if they don't drive. */
function stepOf(book) {
  const s = book.mine?.status
  return !book.eligible ? -1 : !s ? 0 : s === 'open' ? 1 : s === 'funded' ? 2 : 3
}

function Steps({ book }) {
  const at = stepOf(book)
  const steps = [
    ['Name your price', 'The bonus you would need to walk or cycle in instead of driving.'],
    [`Auction, ${runTime(book.runs_at)}`,
      `Jane Street funds the lowest asks per mile of driving replaced, until its ${fmtInt(book.budget)}-credit budget runs out.`],
    ['Commute and get paid', 'Walk or cycle in as usual. The bonus is paid once the commute is verified.'],
  ]
  return (
    <ol className="cf-steps">
      {steps.map(([title, body], i) => (
        <li key={title} className={i === at ? 'now' : i < at ? 'done' : undefined}
          aria-current={i === at ? 'step' : undefined}>
          <span className="cf-num" aria-hidden="true">{i + 1}</span>
          <strong>{title}</strong>
          <span>{body}</span>
        </li>
      ))}
    </ol>
  )
}

/** Asks for the next car-free day, fewest credits per mile first, with a line where Jane Street's budget runs out. */
function OfferBook({ book }) {
  const cut = book.offers.findIndex((o) => !o.fits)
  return (
    <div className="book offer-book">
      <div className="book-row head" aria-hidden="true"><span>Per mile</span><span>Ask</span><span>Driver</span></div>
      {book.offers.length === 0 && <p className="muted">No offers for {book.day_label} yet.</p>}
      <div className="book-scroll">
        {book.offers.map((o, i) => (
          <Fragment key={o.id}>
            {i === cut && cut > 0 && (
              <p className="budget-line">{book.decided ? 'The budget ran out here' : 'The budget runs out here'}</p>
            )}
            <div className={`book-row offer${o.fits ? ' fits' : ''}${o.mine ? ' mine' : ''}`}>
              <span className="price">{fmtOne(o.per_mile)}</span>
              <span>{fmtInt(o.ask)}</span>
              <span className="seller">
                <Avatar person={o.person} small />
                <span>{o.mine ? 'You' : o.person.name}<small className="muted"> {o.area}, {fmtOne(o.car_mi)} mi</small></span>
                {STATUS[o.status] && <span className={`tag ${o.status}`}>{STATUS[o.status]}</span>}
              </span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function OfferForm({ book, mine }) {
  const [ask, setAsk] = useState(mine?.ask ?? Math.min(60, book.fund_up_to ?? 60))
  const make = useMakeOffer()
  const withdraw = useWithdrawOffer()
  return (
    <form className="ticket-form" onSubmit={(e) => { e.preventDefault(); make.mutate(ask) }}>
      <div className="field">
        <label htmlFor="ask">Your bonus for walking or cycling in on {book.day_label}</label>
        <div className="suffixed">
          <input id="ask" type="number" inputMode="numeric" min={book.ask_min} max={book.ask_max} value={ask}
            onChange={(e) => setAsk(Number(e.target.value))} required />
          <span>credits</span>
        </div>
      </div>
      {book.fund_up_to && (
        <div className="explain cf-max">
          <p>
            You don't need to be the cheapest: every offer above the dashed line is funded. With your{' '}
            {fmtOne(book.my_car_mi)}-mile drive, you can ask for up to <strong>{fmtInt(book.fund_up_to)} credits</strong>.
          </p>
          {ask !== book.fund_up_to && (
            <button type="button" className="link-btn" onClick={() => setAsk(book.fund_up_to)}>
              Ask for {fmtInt(book.fund_up_to)}
            </button>
          )}
        </div>
      )}
      {make.error && <p className="note error">{make.error.message}</p>}
      <div className="tracker-actions">
        <button className="btn primary" disabled={make.isPending}>{mine ? 'Change my ask' : 'Make offer'}</button>
        {mine && <button type="button" className="link-btn" onClick={() => withdraw.mutate(mine.id)}>Withdraw</button>}
      </div>
    </form>
  )
}

function MyOffer({ book, config }) {
  const run = useRunAuction()
  const mine = book.mine
  if (!book.eligible) {
    return <p className="muted">Offers are for colleagues who usually drive in. You can follow the auction here.</p>
  }
  if (!mine && book.decided) {
    return <p className="muted">The auction for {book.day_label} has already run. Check back for the next one.</p>
  }
  if (!mine || mine.status === 'open') {
    const fits = book.offers.find((o) => o.mine)?.fits
    return (
      <>
        {mine && (
          <p className={`note ${fits ? '' : 'error'}`}>
            You asked for {fmtInt(mine.ask)} credits. {fits
              ? 'If the auction ran now, you would be funded.'
              : 'If the auction ran now, cheaper asks would use up the budget first.'}
          </p>
        )}
        <OfferForm key={mine?.ask} book={book} mine={mine} />
        {mine && config.demo && (
          <p className="muted small">
            The auction runs {runTime(book.runs_at)}.{' '}
            <button type="button" className="link-btn" disabled={run.isPending} onClick={() => run.mutate()}>
              Run it now (demo)
            </button>
          </p>
        )}
      </>
    )
  }
  return {
    funded: (
      <p className="note">
        Funded. Walk or cycle in on {mine.day_label}: once the commute is verified you get its usual credits plus your{' '}
        {fmtInt(mine.ask)}-credit bonus. <Link to="/route">Go to your route</Link>
      </p>
    ),
    waitlisted: <p className="note error">Not funded this time. The {fmtInt(book.budget)} credits went to cheaper asks.</p>,
    paid: (
      <p className="note">
        Paid. Your commute earned {fmtInt(mine.trip_credits)} credits and leaving the car at home added{' '}
        {fmtInt(mine.ask)}, so <strong>{fmtInt(mine.trip_credits + mine.ask)} credits</strong> in all. Both are in your
        balance above and under Recent commutes on your route.
      </p>
    ),
    expired: <p className="note error">Your funded offer for {mine.day_label} expired without a verified commute.</p>,
  }[mine.status]
}

/**
 * A reverse auction for car journeys: drivers name the bonus they'd need to leave the car at home, and Jane Street
 * funds the cheapest asks that fit its daily budget. Each is paid only after the commute is verified.
 */
export default function CarFreeOffers({ book, config }) {
  const { week } = book
  const stats = [
    ['Car journeys replaced this week', fmtInt(week.switches)],
    ['CO₂ avoided', `${fmtOne(week.co2_kg)} kg`],
    ['Bonuses paid', `${fmtInt(week.credits)} credits`],
    ['Cost per journey', week.switches ? fmtGbp((week.credits * week.price_pence) / week.switches) : 'None yet'],
  ]
  return (
    <section className="panel zone car-free" aria-labelledby="car-free-title">
      <div className="panel-head">
        <h2 id="car-free-title">Leave the car at home</h2>
        <span className="muted">Get paid to walk or cycle in on {book.day_label}</span>
      </div>
      <Steps book={book} />
      <div className="cf-grid">
        <div className="car-free-side">
          <MyOffer book={book} config={config} />
          <dl className="your-credits">
            {stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <p className="muted small">Credits valued at the last trade, {fmtOne(week.price_pence)}p.</p>
        </div>
        <div>
          <h3 className="cf-book-title">Offers for {book.day_label}</h3>
          <p className="muted small cf-book-note">
            Ranked by credits asked per mile of driving replaced. A longer drive saves more CO₂, so it can ask for more.
          </p>
          <OfferBook book={book} />
        </div>
      </div>
    </section>
  )
}
