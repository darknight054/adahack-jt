import { useState } from 'react'
import {
  useBuy, useCancelListing, useConfig, useConvert, useCreateListing, useListings, useMarket, useMyListings,
  useMyTrades, useRoutes, useWallet,
} from '../api/hooks'
import Avatar from '../components/Avatar'
import Query from '../components/Query'
import { fmtAgo, fmtCompact, fmtGbp, fmtInt, fmtOne, fmtPence, fmtShortDay } from '../lib/format'
import './Exchange.css'

const HOUSE = 'house'

function Ticker({ market }) {
  const items = [
    ['Last trade', fmtPence(market.last_price_pence)],
    ['This week', `${market.change_week_pct >= 0 ? '+' : '−'}${fmtOne(Math.abs(market.change_week_pct))}%`],
    ['Best offer', market.best_ask_pence == null ? 'None' : fmtPence(market.best_ask_pence)],
    ['Jane Street price', fmtPence(market.house_price_pence)],
    ['Floor', fmtPence(market.floor_price_pence)],
    ['Traded this week', `${fmtCompact(market.volume_week)} cr`],
  ]
  return (
    <section className="board ticker" aria-label="Market summary">
      <dl>
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function PriceChart({ market }) {
  const W = 600
  const H = 180
  const pad = { l: 44, r: 12, t: 12, b: 26 }
  if (market.history.length === 0) return <p className="muted">No trades in the past week yet.</p>
  const pts = market.history.map((h) => [Date.parse(h.at), h.price_pence])
  const t0 = pts[0][0]
  const t1 = Math.max(pts.at(-1)[0], t0 + 1)
  const lo = market.floor_price_pence
  const hi = market.house_price_pence
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r)
  const y = (p) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const d = pts.map(([t, p], i) => (i ? `H${x(t).toFixed(1)}V${y(p).toFixed(1)}` : `M${x(t).toFixed(1)} ${y(p).toFixed(1)}`)).join('')
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price per credit over the past week, now ${fmtPence(market.last_price_pence)}`}>
        {[[hi, 'Jane Street'], [lo, 'Floor']].map(([p, label]) => (
          <g key={label}>
            <line x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} className="guide" />
            <text x={pad.l - 6} y={y(p) + 4} textAnchor="end" className="axis">{fmtPence(p)}</text>
            <text x={W - pad.r} y={p === hi ? y(p) + 16 : y(p) - 6} textAnchor="end" className="axis">{label}</text>
          </g>
        ))}
        <path d={d} className="price" />
        <circle cx={x(pts.at(-1)[0])} cy={y(pts.at(-1)[1])} r="5" className="price-dot" />
        <text x={pad.l} y={H - 6} className="axis">{fmtShortDay(market.history[0].at)}</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="axis">Now</text>
      </svg>
    </figure>
  )
}

function OrderBook({ listings, market, selected, onSelect }) {
  const deepest = Math.max(...listings.map((l) => l.qty), 1)
  return (
    <section className="panel" aria-labelledby="book-title">
      <div className="panel-head">
        <h2 id="book-title">Credits for sale</h2>
        <span className="muted">{listings.length} offers, cheapest first</span>
      </div>
      <div className="book" role="listbox" aria-label="Pick a listing to buy from">
        <div className="book-row head" aria-hidden="true">
          <span>Price</span><span>Credits</span><span>Seller</span>
        </div>
        {listings.length === 0 && <p className="muted">No colleague is selling right now. Jane Street’s price is always available.</p>}
        <div className="book-scroll">
          {listings.map((l) => (
            <button
              key={l.id}
              role="option"
              aria-selected={selected === l.id}
              aria-disabled={l.mine || undefined}
              className={l.mine ? 'book-row mine' : 'book-row'}
              style={{ '--depth': `${(l.qty / deepest) * 100}%` }}
              onClick={l.mine ? undefined : () => onSelect(l.id)}
              title={l.mine ? 'Your listing. Cancel it under My listings.' : undefined}
            >
              <span className="price">{fmtPence(l.price_pence)}</span>
              <span>{fmtInt(l.qty)}</span>
              <span className="seller">
                <Avatar person={l.seller} small />
                <span>{l.seller.name}</span>
                {l.mine
                  ? <span className="tag mine">Your listing, {fmtPence(l.teammate_price_pence)} to teammates</span>
                  : l.teammate && <span className="tag">Teammate price</span>}
              </span>
            </button>
          ))}
        </div>
        <button
          role="option"
          aria-selected={selected === HOUSE}
          className="book-row house"
          onClick={() => onSelect(HOUSE)}
        >
          <span className="price">{fmtPence(market.house_price_pence)}</span>
          <span>Any</span>
          <span className="seller">Jane Street, always available</span>
        </button>
      </div>
    </section>
  )
}

function BuyTicket({ listing, market }) {
  const buy = useBuy()
  const [qty, setQty] = useState(listing.qty ? Math.min(50, listing.qty) : 50)
  const max = listing.qty ?? Infinity
  const n = Math.min(Math.max(1, Math.floor(qty) || 1), max)
  const total = n * listing.price_pence

  if (buy.isSuccess) {
    const t = buy.data
    return (
      <div className="receipt" role="status">
        <p className="receipt-title">Bought {fmtInt(t.qty)} credits</p>
        <dl>
          <div><dt>From</dt><dd>{t.counterparty ? t.counterparty.name : 'Jane Street'}</dd></div>
          <div><dt>Price</dt><dd>{fmtPence(t.price_pence)} each</dd></div>
          <div><dt>Total</dt><dd>{fmtGbp(t.qty * t.price_pence)}</dd></div>
        </dl>
        <button className="btn block" onClick={() => buy.reset()}>Buy more</button>
      </div>
    )
  }
  return (
    <form className="ticket-form" onSubmit={(e) => {
      e.preventDefault()
      buy.mutate({ listing_id: listing.id, qty: n, price_pence: listing.price_pence })
    }}>
      <p>
        From <strong>{listing.seller}</strong> at <strong>{fmtPence(listing.price_pence)}</strong> a credit
        {listing.qty ? `, ${fmtInt(listing.qty)} available` : ''}.
        {listing.id !== HOUSE && listing.price_pence < market.house_price_pence && (
          <> That’s {fmtGbp((market.house_price_pence - listing.price_pence) * n)} less than buying from Jane Street.</>
        )}
      </p>
      <Stepper id="buy-qty" label="Credits to buy" value={qty} onChange={setQty} max={max} />
      {buy.error && (
        <p className="note error">
          {buy.error.message}
          {buy.error.status === 409 && ' The list of offers has been refreshed, so pick again.'}
        </p>
      )}
      <button className="btn primary block" disabled={buy.isPending}>
        {buy.isPending ? 'Buying…' : `Buy ${fmtInt(n)} credits for ${fmtGbp(total)}`}
      </button>
    </form>
  )
}

function Stepper({ id, label, value, onChange, max = Infinity, hint }) {
  const set = (v) => onChange(Math.min(max, Math.max(1, v)))
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button type="button" aria-label="Fewer" onClick={() => set(value - 10)}>−</button>
        <input id={id} type="number" inputMode="numeric" min="1" max={Number.isFinite(max) ? max : undefined}
          value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <button type="button" aria-label="More" onClick={() => set(value + 10)}>+</button>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

function SellTicket({ wallet, market }) {
  const create = useCreateListing()
  const [qty, setQty] = useState(Math.min(100, wallet.sellable))
  const [globalPrice, setGlobalPrice] = useState(market.last_price_pence)
  const [teamPrice, setTeamPrice] = useState(market.floor_price_pence)
  const floor = market.floor_price_pence
  const house = market.house_price_pence
  const problem =
    wallet.sellable < 1 ? 'You have no earned credits to sell yet. Walk or cycle in to earn some.'
      : teamPrice < floor ? `Prices start at the ${fmtPence(floor)} floor.`
        : teamPrice > globalPrice ? 'Your teammate price can’t be above your global price.'
          : globalPrice >= house ? `Price below Jane Street’s ${fmtPence(house)}, or nobody will buy.`
            : null

  if (create.isSuccess) {
    return (
      <div className="receipt" role="status">
        <p className="receipt-title">Listed {fmtInt(create.data.qty)} credits</p>
        <dl>
          <div><dt>Everyone</dt><dd>{fmtPence(create.data.global_price_pence)}</dd></div>
          <div><dt>Teammates</dt><dd>{fmtPence(create.data.teammate_price_pence)}</dd></div>
        </dl>
        <button className="btn block" onClick={() => create.reset()}>List more</button>
      </div>
    )
  }
  return (
    <form className="ticket-form" onSubmit={(e) => {
      e.preventDefault()
      create.mutate({ qty, global_price_pence: globalPrice, teammate_price_pence: teamPrice })
    }}>
      <p>You can sell credits you earned, not your weekly allowance. {fmtInt(wallet.sellable)} are free to list.</p>
      <Stepper id="sell-qty" label="Credits to sell" value={qty} onChange={setQty} max={wallet.sellable} />
      <div className="price-pair">
        <PriceField id="global-price" label="Price for everyone" value={globalPrice} onChange={setGlobalPrice} floor={floor} />
        <PriceField id="team-price" label="Price for teammates" value={teamPrice} onChange={setTeamPrice} floor={floor} />
      </div>
      <p className="hint muted">
        Prices sit between the {fmtPence(floor)} floor and Jane Street’s {fmtPence(house)}. Selling all {fmtInt(qty)} to
        others earns {fmtGbp(qty * globalPrice)}.
      </p>
      {(problem || create.error) && <p className="note error">{problem ?? create.error.message}</p>}
      <button className="btn primary block" disabled={!!problem || create.isPending}>
        {create.isPending ? 'Listing…' : `List ${fmtInt(qty)} credits`}
      </button>
    </form>
  )
}

function PriceField({ id, label, value, onChange, floor }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="suffixed">
        <input id={id} type="number" inputMode="decimal" step="0.1" min={floor} value={value}
          onChange={(e) => onChange(Number(e.target.value))} />
        <span>p</span>
      </div>
    </div>
  )
}

function ConvertTicket({ wallet, config }) {
  const convert = useConvert()
  const [to, setTo] = useState('tokens')
  const [credits, setCredits] = useState(100)
  const c = config.conversions
  const free = wallet.balance - wallet.listed
  const tooFewForCash = to === 'gbp' && credits < c.min_cashout_credits

  if (convert.isSuccess) {
    const r = convert.data
    return (
      <div className="receipt" role="status">
        <p className="receipt-title">Converted {fmtInt(r.credits)} credits</p>
        <dl>
          <div><dt>You get</dt><dd>{r.to === 'gbp' ? fmtGbp(r.gbp_pence) : `${fmtInt(r.tokens)} coding tokens`}</dd></div>
        </dl>
        <button className="btn block" onClick={() => convert.reset()}>Convert more</button>
      </div>
    )
  }
  return (
    <form className="ticket-form" onSubmit={(e) => {
      e.preventDefault()
      convert.mutate({ to, credits })
    }}>
      <div className="segmented" role="group" aria-label="Convert to">
        <button type="button" aria-pressed={to === 'tokens'} onClick={() => setTo('tokens')}>Coding tokens</button>
        <button type="button" aria-pressed={to === 'gbp'} onClick={() => setTo('gbp')}>Pounds</button>
      </div>
      <p>
        {to === 'tokens'
          ? `Each credit adds ${fmtInt(c.tokens_per_credit)} tokens to your AI coding account.`
          : `Each credit is worth ${c.pence_per_credit}p. Cash-outs start at ${fmtInt(c.min_cashout_credits)} credits.`}
      </p>
      <Stepper id="convert-qty" label="Credits to convert" value={credits} onChange={setCredits} max={free}
        hint={`${fmtInt(free)} credits not listed for sale`} />
      <p className="convert-result">
        {to === 'tokens' ? `${fmtInt(credits * c.tokens_per_credit)} tokens` : fmtGbp(credits * c.pence_per_credit)}
      </p>
      {(tooFewForCash || convert.error) && (
        <p className="note error">
          {tooFewForCash ? `Convert at least ${fmtInt(c.min_cashout_credits)} credits to cash out.` : convert.error.message}
        </p>
      )}
      <button className="btn primary block" disabled={tooFewForCash || convert.isPending}>
        {convert.isPending ? 'Converting…' : `Convert ${fmtInt(credits)} credits`}
      </button>
    </form>
  )
}

function Ticket({ tab, setTab, listing, market, wallet, config }) {
  const tabs = [['buy', 'Buy'], ['sell', 'Sell'], ['convert', 'Convert']]
  return (
    <section className="ticket" aria-label="Trade ticket">
      <div className="ticket-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="ticket-body" role="tabpanel">
        {tab === 'buy' && <BuyTicket key={listing.id} listing={listing} market={market} />}
        {tab === 'sell' && <SellTicket wallet={wallet} market={market} />}
        {tab === 'convert' && <ConvertTicket wallet={wallet} config={config} />}
      </div>
    </section>
  )
}

function MyListings() {
  const mine = useMyListings()
  const cancel = useCancelListing()
  return (
    <section className="panel" aria-labelledby="mine-title">
      <div className="panel-head"><h2 id="mine-title">My listings</h2></div>
      <Query q={mine}>
        {(rows) => rows.length === 0 ? <p className="muted">You have nothing for sale.</p> : (
          <ul className="ledger">
            {rows.map((l) => (
              <li key={l.id}>
                <span className="amount">{fmtInt(l.qty)} cr</span>
                <span>
                  {fmtPence(l.global_price_pence)} for everyone, {fmtPence(l.teammate_price_pence)} for teammates
                  <span className="sub"> listed {fmtAgo(l.created_at)}</span>
                </span>
                <button className="link-btn" disabled={cancel.isPending} onClick={() => cancel.mutate(l.id)}>Cancel</button>
              </li>
            ))}
          </ul>
        )}
      </Query>
    </section>
  )
}

function MyTrades() {
  const trades = useMyTrades()
  return (
    <section className="panel" aria-labelledby="trades-title">
      <div className="panel-head"><h2 id="trades-title">My trades</h2></div>
      <Query q={trades}>
        {(rows) => rows.length === 0 ? <p className="muted">No trades yet.</p> : (
          <ul className="ledger">
            {rows.map((t) => (
              <li key={t.id}>
                <span className={`tag ${t.side}`}>{t.side === 'buy' ? 'Bought' : 'Sold'}</span>
                <span>
                  {fmtInt(t.qty)} credits at {fmtPence(t.price_pence)} {t.side === 'buy' ? 'from' : 'to'}{' '}
                  {t.counterparty ? t.counterparty.name : 'Jane Street'}
                  <span className="sub"> {fmtAgo(t.at)}</span>
                </span>
                <span className="amount">{fmtGbp(t.qty * t.price_pence)}</span>
              </li>
            ))}
          </ul>
        )}
      </Query>
    </section>
  )
}

function YourCredits({ wallet, config, route }) {
  const { tokens_per_credit: tokens, pence_per_credit: pence } = config.conversions
  const stats = [
    ['Balance', wallet.balance],
    ['Free to sell', wallet.sellable],
    ['Listed for sale', wallet.listed],
    ['Converted this week', wallet.week.converted],
  ]
  return (
    <section className="panel" aria-labelledby="yours-title">
      <div className="panel-head"><h2 id="yours-title">Your credits</h2></div>
      <dl className="your-credits">
        {stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{fmtInt(v)}</dd></div>)}
      </dl>
      {route && (
        <p className="explain">
          Your walk {route.name.replace(/^Via /, 'via ')} earns <strong>{fmtInt(route.credits)} credits</strong>. That converts to{' '}
          {fmtInt(route.credits * tokens)} coding tokens or {fmtGbp(route.credits * pence)}, or you can sell it here.
        </p>
      )}
      <p className="muted small">Only credits you earn can be sold. Cash payouts and trade payments are simulated in this demo.</p>
    </section>
  )
}

function Market({ config, market, listings, wallet, route }) {
  const [tab, setTab] = useState('buy')
  const [selected, setSelected] = useState(listings.find((x) => !x.mine)?.id ?? HOUSE)
  const l = listings.find((x) => x.id === selected)
  const listing = l
    ? { id: l.id, seller: l.seller.name, price_pence: l.price_pence, qty: l.qty }
    : { id: HOUSE, seller: 'Jane Street', price_pence: market.house_price_pence, qty: null }
  const pick = (id) => {
    setSelected(id)
    setTab('buy')
  }
  return (
    <>
      <Ticker market={market} />
      <div className="ex-grid">
        <OrderBook listings={listings} market={market} selected={listing.id} onSelect={pick} />
        <div className="ex-side">
          <YourCredits wallet={wallet} config={config} route={route} />
          <Ticket tab={tab} setTab={setTab} listing={listing} market={market} wallet={wallet} config={config} />
          <section className="panel" aria-labelledby="chart-title">
            <div className="panel-head"><h2 id="chart-title">Price this week</h2></div>
            <PriceChart market={market} />
          </section>
        </div>
      </div>
      <div className="ex-grid even">
        <MyListings />
        <MyTrades />
      </div>
    </>
  )
}

export default function Exchange() {
  const config = useConfig()
  const market = useMarket()
  const listings = useListings()
  const wallet = useWallet()
  const routes = useRoutes()
  const walk = routes.data?.routes.find((r) => r.mode === 'walk')
  return (
    <main className="page exchange">
      <header className="sign" style={{ '--line': 'var(--cycle)' }}>
        <h1>Credit exchange</h1>
        <span className="sign-meta">Buy credits from colleagues, sell what you earned, or convert</span>
      </header>
      <Query q={[config, market, listings, wallet]}>
        {(cfg, m, ls, w) => <Market config={cfg} market={m} listings={ls} wallet={w} route={walk} />}
      </Query>
    </main>
  )
}
