import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import RouteTracker from './components/RouteTracker'
import { Concierge } from './components/concierge'

// Loaded on demand so the home page does not download the checker.
const WebsiteChecker = lazy(() => import('./pages/WebsiteChecker'))

export default function App() {
  return (
    <>
      <RouteTracker />
      <Routes>
        <Route path="/" element={<Home />} />
        {/* LeadQuik estimate links land here: the homepage plus a short welcome band. */}
        <Route path="/from-estimate" element={<Home fromEstimate />} />
        <Route
          path="/website-checker"
          element={
            <Suspense fallback={null}>
              <WebsiteChecker />
            </Suspense>
          }
        />
      </Routes>
      {/* Mounted once at the root so every route gets the chat helper. */}
      <Concierge />
    </>
  )
}
