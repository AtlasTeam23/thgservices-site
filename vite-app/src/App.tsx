import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import { Concierge } from './components/concierge'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
      {/* Mounted once at the root so every route gets the chat helper. */}
      <Concierge />
    </>
  )
}
