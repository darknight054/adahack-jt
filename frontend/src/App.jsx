import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import Layout from './components/Layout'
import Exchange from './pages/Exchange'
import Home from './pages/Home'
import Leaderboard from './pages/Leaderboard'
import Login from './pages/Login'
import RoutePage from './pages/RoutePage'

// Only the office door screen needs the QR library, so it loads separately.
const Door = lazy(() => import('./pages/Door'))

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="door" element={<Suspense><Door /></Suspense>} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="route" element={<RoutePage />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="exchange" element={<Exchange />} />
      </Route>
    </Routes>
  )
}
