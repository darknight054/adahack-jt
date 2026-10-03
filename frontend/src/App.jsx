import { Route, Routes } from 'react-router'
import Layout from './components/Layout'
import Door from './pages/Door'
import Exchange from './pages/Exchange'
import Home from './pages/Home'
import Leaderboard from './pages/Leaderboard'
import Login from './pages/Login'
import RoutePage from './pages/RoutePage'

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="door" element={<Door />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="route" element={<RoutePage />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="exchange" element={<Exchange />} />
      </Route>
    </Routes>
  )
}
