import { useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useLogout, useMe, useWallet } from '../api/hooks'
import { fmtInt } from '../lib/format'
import Avatar from './Avatar'
import CreditsGuide from './CreditsGuide'

const PAGES = [
  { to: '/', label: 'Home', end: true },
  { to: '/route', label: 'Route' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/exchange', label: 'Exchange' },
]

function AccountMenu({ me }) {
  const [open, setOpen] = useState(false)
  const logout = useLogout()
  const navigate = useNavigate()
  return (
    <div className="account" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button className="account-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <Avatar person={me} colour={me.colour} />
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-name">{me.name}</p>
          <p className="muted">{me.team}, from {me.home_label}</p>
          <p className="muted">Signed in as {me.username}</p>
          <button role="menuitem" className="btn block" disabled={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const me = useMe()
  const wallet = useWallet()
  const { pathname } = useLocation()
  if (me.error?.status === 401) return <Navigate to="/login" replace state={{ from: pathname }} />
  return (
    <>
      <header className="topbar">
        <Link to="/" className="wordmark">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <path d="M3 24 L12 15 L21 15 L27 9" fill="none" stroke="var(--walk)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="27" cy="9" r="3" fill="var(--plate)" stroke="var(--ink)" strokeWidth="2.5" />
          </svg>
          Street Miles
        </Link>
        <nav className="line-nav" aria-label="Pages">
          <ol>
            {PAGES.map((p) => (
              <li key={p.to}>
                <NavLink to={p.to} end={p.end}>
                  <span className="dot" aria-hidden="true" />
                  {p.label}
                </NavLink>
              </li>
            ))}
          </ol>
        </nav>
        <div className="me-chip">
          {wallet.data && (
            <Link to="/exchange" className="dot-readout" aria-label="Your credit balance">
              {fmtInt(wallet.data.balance)}
              <small>credits</small>
            </Link>
          )}
          {me.data && <AccountMenu me={me.data} />}
        </div>
      </header>
      <Outlet />
      {pathname !== '/' && <CreditsGuide />}
    </>
  )
}
