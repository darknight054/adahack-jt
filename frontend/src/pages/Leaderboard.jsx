import { useState } from 'react'
import { useLeaderboard, useTeamActivity } from '../api/hooks'
import Avatar from '../components/Avatar'
import Query from '../components/Query'
import { fmtAgo, fmtCountdown, fmtDay, fmtInt, fmtSigned } from '../lib/format'
import './Leaderboard.css'

const FEED_SHOWN = 8
const lastDay = (iso) => new Date(Date.parse(iso) - 1).toISOString()

function Row({ t, board, i }) {
  return (
    <li className={`board-row cols ${i < 12 ? 'flip' : ''} ${t.id === board.my_team_id ? 'mine' : ''}`}
      style={i < 12 ? { animationDelay: `${i * 90}ms` } : undefined}>
      <span>{t.rank}</span>
      <span className="team">
        {t.name}
        {t.id === board.my_team_id && <span className="you">your team</span>}
      </span>
      <span className="num">{fmtInt(t.credits)}</span>
      <span className="status">{t.rank === 1 ? 'Leading' : `${fmtInt(board.leader_credits - t.credits)} behind`}</span>
    </li>
  )
}

function Board({ board, q, setQ }) {
  const mineShown = board.teams.some((t) => t.id === board.my_team_id)
  return (
    <section className="board standings" aria-label="Team standings this week">
      <div className="board-head">
        <span>Week ending <strong>{fmtDay(lastDay(board.week.ends_at))}</strong></span>
        <span>Resets in <strong>{fmtCountdown(board.week.ends_at)}</strong></span>
      </div>
      <div className="board-search">
        <label htmlFor="team-search">Find a team</label>
        <input id="team-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${board.total_teams} teams`} />
      </div>
      <div className="board-row cols dim" aria-hidden="true">
        <span>Pos</span><span>Team</span><span className="num">Credits</span><span className="status">Status</span>
      </div>
      <ol className="board-scroll">
        {board.teams.map((t, i) => <Row key={t.id} t={t} board={board} i={i} />)}
        {board.teams.length === 0 && <li className="board-empty">No team matches “{q}”.</li>}
      </ol>
      {!mineShown && <ol className="board-pinned"><Row t={board.my_team} board={board} i={99} /></ol>}
    </section>
  )
}

function TeamFeed({ activity }) {
  return (
    <section className="panel" aria-labelledby="feed-title">
      <div className="panel-head">
        <h2 id="feed-title">Your team lately</h2>
      </div>
      <ul className="ledger">
        {activity.slice(0, FEED_SHOWN).map((a) => (
          <li key={a.id}>
            <Avatar person={a.user} small />
            <span>
              <strong>{a.user.name.split(' ')[0]}</strong>: {a.detail}
              <span className="sub when">{fmtAgo(a.at)}</span>
            </span>
            <span className={`amount ${a.credits > 0 ? 'gain' : 'loss'}`}>{fmtSigned(a.credits)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Standings({ board, q, setQ }) {
  const activity = useTeamActivity()
  return (
    <>
      <header className="sign" style={{ '--line': 'var(--amber)' }}>
        <h1>Team standings</h1>
        <span className="sign-meta">
          Top team gets {fmtSigned(board.bonus_per_member)} credits each when the week ends
        </span>
      </header>
      <div className="lb-grid">
        <div className="panel">
          <Board board={board} q={q} setQ={setQ} />
          {board.last_winners.length > 0 && (
            <p className="winners muted">
              Last week: {board.last_winners.map((w) => `${w.name} (${fmtInt(w.credits)} credits)`).join(' and ')}{' '}
              {board.last_winners.length > 1 ? 'tied for first.' : 'won.'}
            </p>
          )}
        </div>
        <Query q={activity}>{(a) => <TeamFeed activity={a} />}</Query>
      </div>
    </>
  )
}

export default function Leaderboard() {
  const [q, setQ] = useState('')
  const board = useLeaderboard(q)
  return (
    <main className="page leaderboard">
      <Query q={board}>{(b) => <Standings board={b} q={q} setQ={setQ} />}</Query>
    </main>
  )
}
