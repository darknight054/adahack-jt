import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '../api/client'
import { useActiveTrip, useCancelTrip, useFinishTrip, useStartTrip } from '../api/hooks'
import { fmtSigned } from '../lib/format'

const toFix = (p) => ({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy, t_ms: p.timestamp })
const here = () => new Promise((resolve, reject) =>
  navigator.geolocation.getCurrentPosition((p) => resolve(toFix(p)), reject, { enableHighAccuracy: true, timeout: 20000 }))

/** Records a live GPS track while the page stays open, then finishes with the code on the office door. */
function Tracking({ trip, finish }) {
  const [sent, setSent] = useState(trip.points)
  const [code, setCode] = useState(useSearchParams()[0].get('c') ?? '')
  const [geoError, setGeoError] = useState(null)
  const cancel = useCancelTrip()
  const buffer = useRef([])

  useEffect(() => {
    let seq = Date.now() % 1_000_000
    let lock
    navigator.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    const watch = navigator.geolocation.watchPosition(
      (p) => buffer.current.push(toFix(p)),
      (e) => setGeoError(e.message),
      { enableHighAccuracy: true, maximumAge: 0 },
    )
    const timer = setInterval(async () => {
      const points = buffer.current.splice(0)
      if (!points.length) return
      const res = await api.post(`/api/trips/${trip.id}/points`, { seq: seq++, points }).catch(() => null)
      if (res) setSent((n) => n + res.accepted)
    }, trip.upload_every_s * 1000)
    return () => {
      navigator.geolocation.clearWatch(watch)
      clearInterval(timer)
      lock?.release()
    }
  }, [trip.id, trip.upload_every_s])

  const submit = async (e) => {
    e.preventDefault()
    try {
      finish.mutate({ id: trip.id, office_code: code, fix: await here() })
    } catch (err) {
      setGeoError(err.message)
    }
  }
  return (
    <form className="tracker" onSubmit={submit}>
      <p className="tracking-live">
        <span className="pulse" aria-hidden="true" /> Tracking your {trip.mode} since{' '}
        {new Date(trip.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, {sent} points sent.
      </p>
      <p className="muted">Keep this page open with the screen on. At the office, scan the code on the door or type it here.</p>
      <div className="field">
        <label htmlFor="door-code">Door code</label>
        <input id="door-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value)} required />
      </div>
      {(geoError || finish.error) && <p className="note error">{geoError ?? finish.error.message}</p>}
      <div className="tracker-actions">
        <button className="btn primary" disabled={finish.isPending}>{finish.isPending ? 'Checking…' : 'Finish commute'}</button>
        <button type="button" className="link-btn" onClick={() => cancel.mutate(trip.id)}>Cancel</button>
      </div>
    </form>
  )
}

export default function CommuteTracker({ config, defaultMode }) {
  const active = useActiveTrip()
  const start = useStartTrip()
  const [mode, setMode] = useState(defaultMode)
  const [geoError, setGeoError] = useState(null)
  const finish = useFinishTrip()
  const result = finish.data

  const begin = async () => {
    setGeoError(null)
    finish.reset()
    try {
      start.mutate({ mode, fix: await here() })
    } catch (err) {
      setGeoError(`Location is needed to track a commute: ${err.message}`)
    }
  }
  return (
    <section className="panel" aria-labelledby="tracker-title">
      <div className="panel-head"><h2 id="tracker-title">Commute now</h2></div>
      {active.data ? <Tracking trip={active.data} finish={finish} /> : (
        <div className="tracker">
          {result && (
            <p className={`note ${result.status === 'verified' ? '' : 'error'}`}>
              {result.status === 'verified'
                ? `Verified: ${result.credited_mi} mi, ${fmtSigned(result.credits)} credits.`
                : result.status === 'review' ? 'Sent for a person to check.' : 'Not credited.'}{' '}
              {result.reasons.join(' ')}
            </p>
          )}
          <div className="segmented" role="group" aria-label="Mode">
            {Object.entries(config.modes).map(([id, m]) => (
              <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>{m.label}</button>
            ))}
          </div>
          {(geoError || start.error) && <p className="note error">{geoError ?? start.error.message}</p>}
          <button className="btn primary" onClick={begin} disabled={start.isPending}>
            {start.isPending ? 'Starting…' : 'Start commute'}
          </button>
        </div>
      )}
    </section>
  )
}
