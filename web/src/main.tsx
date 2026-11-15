import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Honk from './honk/Honk.tsx'
import { startAnalytics, track } from './track'

startAnalytics()
// Wake the city is the front door; the noise map opens from its tab or from any #lens=... link it wrote.
const tabOf = () => (/(^|[#&])(lens=|tab=map)/.test(window.location.hash) ? 'map' : 'honk')

// Two views share the page; the map keeps its own #lens=... links, the other is #tab=honk (plus a honk to replay).
// Links between them set location.hash, which fires hashchange; each view rewrites its own hash with replaceState.
function Shell() {
  const [tab, setTab] = useState<'map' | 'honk'>(tabOf)
  const [key, setKey] = useState(0)
  useEffect(() => {
    const on = () => { setTab(tabOf()); setKey((k) => k + 1); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (t: 'map' | 'honk') => {
    if (t === tab) return
    window.history.replaceState(null, '', t === 'honk' ? '#tab=honk' : '#tab=map')
    setTab(t)
    track('tab', { tab: t })
  }
  return (
    <>
      <nav className="tabs" aria-label="Views">
        <button aria-pressed={tab === 'honk'} onClick={() => go('honk')}>Wake the city</button>
        <button aria-pressed={tab === 'map'} onClick={() => go('map')}>Noise map</button>
      </nav>
      {tab === 'map' ? <App key={key} /> : <Honk key={key} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
