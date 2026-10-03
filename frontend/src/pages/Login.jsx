import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useLogin, useMe } from '../api/hooks'
import './Login.css'

export default function Login() {
  const me = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const from = useLocation().state?.from ?? '/'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  if (me.data) return <Navigate to={from} replace />
  return (
    <main className="login">
      <form className="login-card" onSubmit={(e) => {
        e.preventDefault()
        login.mutate({ username, password }, { onSuccess: () => navigate(from, { replace: true }) })
      }}>
        <div className="sign" style={{ '--line': 'var(--walk)' }}><h1>Street Miles</h1></div>
        <p className="muted">Sign in with your Jane Street username.</p>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {login.error && <p className="note error">{login.error.message}</p>}
        <button className="btn primary block" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}
