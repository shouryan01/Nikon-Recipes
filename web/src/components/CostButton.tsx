import React, { useEffect, useState } from 'react'

const COST_URL = 'http://127.0.0.1:4173/cost'

// Running estimated Meta API spend, persisted server-side across restarts.
export const CostButton: React.FC = () => {
  const [usd, setUsd] = useState<number | null>(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch(COST_URL)
        const j = await r.json()
        if (!stop && typeof j?.total?.estimatedUsd === 'number') setUsd(j.total.estimatedUsd)
      } catch {
        /* API down: leave the last value */
      }
    }
    load()
    const t = setInterval(load, 30000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  const label = usd === null ? '$—' : `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`
  return (
    <button
      onClick={() => window.open(COST_URL, '_blank', 'noopener')}
      title="Estimated Meta API spend, cumulative (click for breakdown)"
      className="text-xs font-mono px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
    >
      {label}
    </button>
  )
}
