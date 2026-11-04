import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import RouteTracker from './components/RouteTracker'
import { Concierge } from './components/concierge'

export default function App() {
  return (
    <>
      <RouteTracker />
      <Routes>
        <Route path="/" element={<Home />} />
        {/* LeadQuik estimate links land here: the homepage plus a short welcome band. */}
        <Route path="/from-estimate" element={<Home fromEstimate />} />
      </Routes>
      {/* Mounted once at the root so every route gets the chat helper. */}
      <Concierge />
    </>
  )
}
