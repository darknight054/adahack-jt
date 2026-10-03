import { useEffect, useRef, useState } from 'react'
import { useDemoReplay, useRefreshAfterTrip } from '../api/hooks'
import { fmtOne, fmtSigned } from '../lib/format'

/**
 * Replays the chosen route as a commute in a few seconds. The server runs the real checks on a simulated clock,
 * so the verdict, wallet, team score and leaderboard all update for real. The map animates via onStart.
 */
export default function DemoReplay({ route, config, onStart, onStop }) {
  const replay = useDemoReplay()
  const refresh = useRefreshAfterTrip()
  const [progress, setProgress] = useState(null)
  const timer = useRef(0)
  useEffect(() => () => clearInterval(timer.current), [])

  const seconds = config.demo.replay_s
  const via = route.name.replace(/^Via /, 'via ')
  const stop = () => {
    clearInterval(timer.current)
    setProgress(null)
    onStop()
  }
  const run = () => {
    const startedAt = performance.now()
    const result = replay.mutateAsync(route.id)
    result.catch(stop)
    onStart({ startedAt, seconds })
    setProgress(0)
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      const p = Math.min(1, (performance.now() - startedAt) / (seconds * 1000))
      setProgress(p)
      if (p === 1) {
        clearInterval(timer.current)
        // Credits, the leaderboard and the rest change when the walk ends, not when the server answers.
        result.then(refresh, () => {})
      }
    }, 200)
  }

  const r = replay.data
  if (progress !== null && (progress < 1 || replay.isPending)) {
    return (
      <div className="demo-replay">
        <p className="tracking-live">
          <span className="pulse" aria-hidden="true" /> Demo replay {via}: {fmtOne(route.distance_mi * progress)} of{' '}
          {route.distance_mi} mi
        </p>
        <progress max="1" value={progress} aria-label="Replay progress" />
        {progress === 1 && <p className="muted small">Checking the track…</p>}
      </div>
    )
  }
  return (
    <div className="demo-replay">
      {r && progress === 1 && (
        <p className={`note ${r.status === 'verified' ? '' : 'error'}`}>
          {r.status === 'verified'
            ? `Verified: ${r.credited_mi} mi, ${fmtSigned(r.credits)} credits. Your wallet, team score and the leaderboard have updated.`
            : r.status === 'review' ? 'Sent for a person to check.' : 'Not credited.'}{r.switch_bonus > 0 && ` Your car-free offer paid ${fmtSigned(r.switch_bonus)} on top.`}{' '}
          {r.capped && `You’ve reached today’s cap of ${config.credits.daily_cap} credits.`} {r.reasons.join(' ')}
        </p>
      )}
      {replay.error && <p className="note error">{replay.error.message}</p>}
      <button type="button" className="link-btn" onClick={run}>Replay this route as a demo ({seconds} seconds)</button>
      <p className="muted small">
        Runs the real checks on a simulated {route.duration_min}-minute {config.modes[route.mode].label.toLowerCase()}.
      </p>
    </div>
  )
}
