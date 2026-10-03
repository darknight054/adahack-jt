import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { useMakeOffer, useRunAuction, useWithdrawOffer } from '../api/hooks'
import { fmtCountdown, fmtGbp, fmtInt, fmtOne } from '../lib/format'
import Avatar from './Avatar'

const STATUS = { open: null, funded: 'Funded', waitlisted: 'Waitlisted', paid: 'Paid', expired: 'Expired' }

/** Asks for the next car-free day, cheapest first, with a line where Jane Street's budget runs out. */
function OfferBook({ book }) {
  const cut = book.offers.findIndex((o) => !o.fits)
  return (
    <div className="book offer-book">
      <div className="book-row head" aria-hidden="true"><span>Ask</span><span>Driver</span></div>
      {book.offers.length === 0 && <p className="muted">No offers for {book.day_label} yet.</p>}
      <div className="book-scroll">
        {book.offers.map((o, i) => (
          <Fragment key={o.id}>
            {i === cut && cut > 0 && (
              <p className="budget-line">
                {book.decided ? 'The budget ran out here' : 'The budget runs out here if the auction ran now'}
              </p>
            )}
            <div className={`book-row offer${o.fits ? ' fits' : ''}${o.mine ? ' mine' : ''}`}>
              <span className="price">{fmtInt(o.ask)}</span>
              <span className="seller">
                <Avatar person={o.person} small />
                <span>{o.mine ? 'You' : o.person.name}</span>
                {STATUS[o.status] && <span className={`tag ${o.status}`}>{STATUS[o.status]}</span>}
              </span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function OfferForm({ book }) {
  const [ask, setAsk] = useState(book.mine?.status === 'open' ? book.mine.ask : 60)
  const make = useMakeOffer()
  const withdraw = useWithdrawOffer()
  const mine = book.mine?.status === 'open' ? book.mine : null
  return (
    <form className="ticket-form" onSubmit={(e) => { e.preventDefault(); make.mutate(ask) }}>
      <div className="field">
        <label htmlFor="ask">Bonus you'd need to walk or cycle in on {book.day_label}</label>
        <div className="suffixed">
          <input id="ask" type="number" inputMode="numeric" min={book.ask_min} max={book.ask_max} value={ask}
            onChange={(e) => setAsk(Number(e.target.value))} required />
          <span>credits</span>
        </div>
      </div>
      {make.error && <p className="note error">{make.error.message}</p>}
      <div className="tracker-actions">
        <button className="btn primary" disabled={make.isPending}>{mine ? 'Change my ask' : 'Make offer'}</button>
        {mine && <button type="button" className="link-btn" onClick={() => withdraw.mutate(mine.id)}>Withdraw</button>}
      </div>
    </form>
  )
}

function MyOffer({ book }) {
  const mine = book.mine
  const fits = book.offers.find((o) => o.mine)?.fits
  if (!mine || mine.status === 'open') {
    return (
      <>
        {mine && (
          <p className={`note ${fits ? '' : 'error'}`}>
            You asked for {fmtInt(mine.ask)} credits. {fits
              ? 'If the auction ran now, you would be funded.'
              : 'If the auction ran now, cheaper asks would use up the budget. Ask for less to get in.'}
          </p>
        )}
        <OfferForm key={mine?.ask} book={book} />
      </>
    )
  }
  return {
    funded: (
      <p className="note">
        Funded: walk or cycle in on {mine.day_label} and you're paid {fmtInt(mine.ask)} credits once the commute is
        verified. <Link to="/route">Go to your route</Link>
      </p>
    ),
    waitlisted: <p className="note error">Not funded this time: {fmtInt(book.budget)} credits went to cheaper asks.</p>,
    paid: <p className="note">Paid: +{fmtInt(mine.ask)} credits for leaving the car at home on {mine.day_label}.</p>,
    expired: <p className="note error">Your funded offer for {mine.day_label} expired without a verified commute.</p>,
  }[mine.status]
}

/**
 * A reverse auction for car journeys: drivers name the bonus they'd need to leave the car at home, and Jane Street
 * funds the cheapest asks that fit its daily budget. Each is paid only after the commute is verified.
 */
export default function CarFreeOffers({ book, config }) {
  const run = useRunAuction()
  const { week } = book
  const spentPence = week.credits * week.price_pence
  return (
    <section className="panel car-free" aria-labelledby="car-free-title">
      <div className="panel-head">
        <h2 id="car-free-title">Leave the car at home</h2>
        <span className="muted">Car-free offers for {book.day_label}</span>
      </div>
      <div className="ex-grid">
        <OfferBook book={book} />
        <div className="car-free-side">
          <p className="explain">
            Drivers name the bonus they'd need to walk or cycle in instead. Jane Street funds the cheapest asks that fit{' '}
            <strong>{fmtInt(book.budget)} credits a day</strong>, and pays each one only after that commute is verified.
          </p>
          {book.eligible
            ? <MyOffer book={book} />
            : <p className="muted">Offers are for colleagues who usually drive in. You can follow the auction here.</p>}
          {!book.decided && (
            <p className="muted small">
              The auction for {book.day_label} runs in {fmtCountdown(book.runs_at)}.{' '}
              {config.demo && (
                <button type="button" className="link-btn" disabled={run.isPending} onClick={() => run.mutate()}>
                  Run it now (demo)
                </button>
              )}
            </p>
          )}
          <dl className="your-credits">
            <div><dt>Car journeys replaced this week</dt><dd>{fmtInt(week.switches)}</dd></div>
            <div><dt>CO₂ avoided</dt><dd>{fmtOne(week.co2_kg)} kg</dd></div>
            <div><dt>Bonuses paid</dt><dd>{fmtInt(week.credits)} cr</dd></div>
            <div>
              <dt>Cost per journey</dt>
              <dd>{week.switches ? fmtGbp(spentPence / week.switches) : 'None yet'}</dd>
            </div>
          </dl>
          <p className="muted small">Credits valued at the last trade, {fmtOne(week.price_pence)}p.</p>
        </div>
      </div>
    </section>
  )
}
