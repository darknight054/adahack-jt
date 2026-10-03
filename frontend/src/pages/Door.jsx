import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import './Door.css'

/** The screen on the office door. Shows the rotating finish code as a QR that opens the Route page. */
export default function Door() {
  const key = useSearchParams()[0].get('key')
  const [state, setState] = useState({})
  useEffect(() => {
    let timer
    const load = async () => {
      const res = await fetch('/api/office/code', { headers: { 'X-Staff-Key': key ?? '' } })
      const data = await res.json()
      if (!res.ok) return setState({ error: data.detail })
      const qr = await QRCode.toDataURL(`${location.origin}/route?c=${data.code}`, { margin: 1, width: 480 })
      setState({ code: data.code, qr })
      timer = setTimeout(load, data.expires_in * 1000 + 300)
    }
    load()
    return () => clearTimeout(timer)
  }, [key])
  return (
    <main className="door">
      {state.error ? <p className="note error">{state.error}</p> : state.code && (
        <>
          <h1>Finish your commute here</h1>
          <img src={state.qr} alt={`QR code for door code ${state.code}`} />
          <p className="door-code">{state.code}</p>
          <p>Scan with your phone camera, or type the code on the Route page.</p>
        </>
      )}
    </main>
  )
}
