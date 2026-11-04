import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecipeItem } from '../types/recipe'
import { Sparkles } from 'lucide-react'
import { shrinkPhotoForUpload } from '../lib/photoUpload'

const API = 'http://127.0.0.1:4173'

interface Frame {
  id: string
  name: string
  total: number
  status: string
  decision: 'keep' | 'reject' | 'star' | null
  previewUrl?: string
  rescueUrl?: string | null
  note?: string
  apiError?: string | null
  fast?: { aesthetic: number; obviousFault?: string | null }
  deep?: {
    scores: Record<string, number | null>
    flags: string[]
    reason: string
    recommendation: { masks: { target: string; operation: string }[]; adjustments: { scope: string; note: string }[] }
  }
  seg?: {
    subject?: { label: string; box: { x: number; y: number; w: number; h: number } } | null
    horizonTiltDeg: number
    distractions: { label: string; box: { x: number; y: number; w: number; h: number } }[]
  }
}

interface Props {
  onToggleFavorite: (recipe: RecipeItem) => void
  favorites: RecipeItem[]
  activeRecipe: RecipeItem
}

function adjusted(f: Frame, userScores: Record<string, number>): number {
  const base = f.total || 0
  const u = userScores[f.id]
  if (u == null) return base
  return Math.round(((base + u) / 2) * 10) / 10
}

// Which composition guide fits this frame, from SAM's own output:
// the subject center votes between rule-of-thirds and golden-ratio points.
type OverlayPick = { grid: 'thirds' | 'phi' | 'center'; point: { x: number; y: number } | null; reason: string }

function nearestPoint(pt: { x: number; y: number }, list: { x: number; y: number }[]) {
  let best = list[0], bd = Infinity
  for (const p of list) {
    const d = Math.hypot(pt.x - p.x, pt.y - p.y)
    if (d < bd) { bd = d; best = p }
  }
  return { point: best, dist: bd }
}

function pickOverlay(seg: Frame['seg']): OverlayPick {
  const thirdsLines = [1 / 3, 2 / 3]
  const phiLines = [0.382, 0.618]
  const gridPts = (xs: number[], ys: number[]) => xs.flatMap((x) => ys.map((y) => ({ x, y })))
  const thirdsPts = gridPts(thirdsLines, thirdsLines)
  const phiPts = [...gridPts(phiLines, phiLines), ...gridPts(phiLines, thirdsLines), ...gridPts(thirdsLines, phiLines)]
  const box = seg?.subject?.box
  if (box) {
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    const t = nearestPoint(c, thirdsPts)
    const p = nearestPoint(c, phiPts)
    if (Math.min(t.dist, p.dist) > 0.2) {
      return { grid: 'center', point: c, reason: 'Subject is central — center cross and diagonals' }
    }
    if (t.dist <= p.dist) return { grid: 'thirds', point: t.point, reason: 'SAM puts the subject on a thirds intersection — rule-of-thirds grid' }
    return { grid: 'phi', point: p.point, reason: 'SAM puts the subject on a golden-ratio point — phi grid' }
  }
  const tilt = seg?.horizonTiltDeg ?? 0
  return {
    grid: 'thirds',
    point: null,
    reason: tilt !== 0 ? 'No dominant subject — thirds grid plus the tilted horizon SAM measured' : 'No dominant subject — thirds grid for landscape balance',
  }
}

export const CullStudio: React.FC<Props> = ({ onToggleFavorite, favorites, activeRecipe }) => {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [userScores, setUserScores] = useState<Record<string, number>>({})
  const [taste, setTaste] = useState('')
  const [guidesOn, setGuidesOn] = useState(true)
  const dirRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (dirRef.current) (dirRef.current as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
  }, [])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [awaitingAnalysis, setAwaitingAnalysis] = useState(false)
  const [analysisRun, setAnalysisRun] = useState(0)
  const [rescuing, setRescuing] = useState(false)

  const ranked = useMemo(() => [...frames].sort((a, b) => adjusted(b, userScores) - adjusted(a, userScores)), [frames, userScores])
  const selected = frames.find((f) => f.id === selectedId) ?? ranked[0] ?? null

  const refresh = useCallback(async (sid: string) => {
    const r = await fetch(`${API}/api/session/${sid}`)
    if (!r.ok) return false
    const j = await r.json()
    setFrames(j.frames)
    return !j.analysing
  }, [])

  useEffect(() => {
    if (!sessionId) return
    let stop = false
    const poll = async () => {
      const done = await refresh(sessionId).catch(() => true)
      if (done) {
        if (!stop) {
          setBusy('')
          if (analysisRun > 0) setAwaitingAnalysis(false)
        }
      } else if (!stop) setTimeout(poll, 3000)
    }
    poll()
    return () => { stop = true }
  }, [sessionId, analysisRun, refresh])

  const load = async (fn: () => Promise<{ sid: string; frames: Frame[] }>): Promise<boolean> => {
    setBusy('Working…')
    setError('')
    try {
      const { sid, frames } = await fn()
      setSessionId(sid)
      setFrames(frames)
      setSelectedId(frames[0]?.id ?? null)
      setUserScores({})
      return true
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      return false
    } finally {
      setBusy('')
    }
  }

  const importDemo = () => load(async () => {
    const r = await fetch(`${API}/api/demo`, { method: 'POST' })
    if (!r.ok) throw new Error(await r.text())
    const j = await r.json()
    return { sid: j.session.id, frames: j.frames }
  })

  // Choosing a folder uploads right away (shrunk working copies) but runs
  // no analysis — Meta scoring waits for the AI analysis button.
  const uploadFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (!list.length || busy) return
    const ok = await load(async () => {
      // Shrink in the browser first: uploads stay fast and API payloads tiny.
      const small: { blob: Blob; name: string }[] = []
      for (const f of list) {
        const prepared = await shrinkPhotoForUpload(f)
        if ('rejection' in prepared) throw new Error(`${prepared.rejection.title}: ${prepared.rejection.message}`)
        small.push(prepared)
      }
      const b = await (await fetch(`${API}/api/upload-begin`, { method: 'POST' })).json()
      for (const f of small) {
        await fetch(`${API}/api/upload?session=${b.sessionId}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f.blob })
      }
      const r = await fetch(`${API}/api/upload-finish`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: b.sessionId, defer: true }),
      })
      if (!r.ok) throw new Error(await r.text())
      const j = await r.json()
      return { sid: j.session.id, frames: j.frames }
    })
    if (ok) {
      setAnalysisRun(0)
      setAwaitingAnalysis(true)
    }
  }

  const runAnalysis = async () => {
    if (!sessionId || busy) return
    setBusy('Analysing…')
    setError('')
    try {
      const r = await fetch(`${API}/api/analyze`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (!r.ok) throw new Error(await r.text())
      setAnalysisRun((n) => n + 1)
    } catch (e) {
      setBusy('')
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const rescuePreview = async (frame: Frame) => {
    if (!sessionId || rescuing) return
    setRescuing(true)
    setError('')
    try {
      const r = await fetch(`${API}/api/image/rescue`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, frameId: frame.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Rescue failed')
      setFrames((prev) => prev.map((f) => (f.id === frame.id ? { ...f, rescue: j.rescue, rescueUrl: j.rescueUrl } : f)))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setRescuing(false)
    }
  }

  const decide = async (frame: Frame, action: 'keep' | 'reject' | 'star', score?: number) => {
    if (score != null) setUserScores((p) => ({ ...p, [frame.id]: score }))
    if (!sessionId) {
      setFrames((prev) => prev.map((f) => (f.id === frame.id ? { ...f, decision: action } : f)))
      return
    }
    const r = await fetch(`${API}/api/decision`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, frameId: frame.id, action }),
    })
    const j = await r.json()
    if (j.frame) setFrames((prev) => prev.map((f) => (f.id === frame.id ? { ...f, ...j.frame } : f)))
    if (j.taste) setTaste(j.taste)
  }

  const step = (dir: 1 | -1) => {
    if (!selected) return
    const i = ranked.findIndex((f) => f.id === selected.id)
    const n = ranked[(i + dir + ranked.length) % ranked.length]
    if (n) setSelectedId(n.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'k') decide(selected, 'keep', userScores[selected.id] ?? 4)
      else if (e.key === 'x') decide(selected, 'reject', userScores[selected.id] ?? 2)
      else if (e.key === 's') decide(selected, 'star', 5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const imgSrc = selected?.previewUrl ? `${API}${selected.previewUrl}` : null
  const seg = selected?.seg
  const overlay = pickOverlay(seg)
  const colorNotes = selected?.deep?.recommendation.adjustments.filter((a) => a.scope === 'color' || a.scope === 'global') ?? []

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-neutral-950">
        <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center gap-2">
          <label className="px-3 py-1.5 text-xs rounded-md bg-[#FFE100] text-black font-semibold cursor-pointer">
            Choose folder…
            <input
              ref={dirRef}
              type="file"
              className="hidden"
              onChange={(e) => { uploadFiles(e.target.files); e.currentTarget.value = '' }}
            />
          </label>
          <button
            onClick={runAnalysis}
            disabled={!awaitingAnalysis || !!busy}
            title="Run Meta AI analysis on the uploaded photos"
            className="px-3 py-1.5 text-xs rounded-md bg-black text-white dark:bg-white dark:text-black font-semibold disabled:opacity-40 flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI analysis</span>
          </button>
          <button onClick={importDemo} className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700">Demo</button>
          <span className="text-[11px] text-neutral-500">Folder uploads are shrunk in-browser to 768px working copies.</span>
          {busy && <span className="text-[11px] text-neutral-500">{busy}</span>}
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>

        {selected ? (
          <div className="flex-1 overflow-auto p-5">
            <div className="flex justify-center">
              <div className="relative inline-block max-w-full">
              {imgSrc && <img src={imgSrc} alt={selected.name} className="max-w-full max-h-[52vh] object-contain rounded-lg border border-neutral-200 dark:border-neutral-800" />}
              {guidesOn && imgSrc && (
                <div className="absolute inset-0 pointer-events-none" aria-hidden>
                  {overlay.grid === 'thirds' && (
                    <>
                      <div className="absolute inset-y-0 left-1/3 w-px bg-[#FFE100]/70" />
                      <div className="absolute inset-y-0 left-2/3 w-px bg-[#FFE100]/70" />
                      <div className="absolute inset-x-0 top-1/3 h-px bg-[#FFE100]/70" />
                      <div className="absolute inset-x-0 top-2/3 h-px bg-[#FFE100]/70" />
                    </>
                  )}
                  {overlay.grid === 'phi' && (
                    <>
                      <div className="absolute inset-y-0 w-px bg-cyan-300/70" style={{ left: '38.2%' }} />
                      <div className="absolute inset-y-0 w-px bg-cyan-300/70" style={{ left: '61.8%' }} />
                      <div className="absolute inset-x-0 h-px bg-cyan-300/70" style={{ top: '38.2%' }} />
                      <div className="absolute inset-x-0 h-px bg-cyan-300/70" style={{ top: '61.8%' }} />
                    </>
                  )}
                  {overlay.grid === 'center' && (
                    <>
                      <div className="absolute inset-y-0 left-1/2 w-px bg-[#FFE100]/70" />
                      <div className="absolute inset-x-0 top-1/2 h-px bg-[#FFE100]/70" />
                      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <line x1="0" y1="0" x2="100" y2="100" stroke="white" strokeOpacity="0.5" strokeWidth="0.3" />
                        <line x1="100" y1="0" x2="0" y2="100" stroke="white" strokeOpacity="0.5" strokeWidth="0.3" />
                      </svg>
                    </>
                  )}
                  {overlay.point && (
                    <div className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-[#FFE100]" style={{ left: `${overlay.point.x * 100}%`, top: `${overlay.point.y * 100}%` }} />
                  )}
                  {(seg?.horizonTiltDeg ?? 0) !== 0 && (
                    <div className="absolute inset-x-0 top-1/2 h-px bg-red-400/80" style={{ transform: `rotate(${seg!.horizonTiltDeg}deg)` }} />
                  )}
                  {seg?.subject && (
                    <div className="absolute border-2 border-emerald-400/90" style={{
                      left: `${seg.subject.box.x * 100}%`, top: `${seg.subject.box.y * 100}%`,
                      width: `${seg.subject.box.w * 100}%`, height: `${seg.subject.box.h * 100}%`,
                    }} />
                  )}
                  {seg?.distractions.map((d, i) => (
                    <div key={i} className="absolute border border-dashed border-red-400/80" style={{
                      left: `${d.box.x * 100}%`, top: `${d.box.y * 100}%`,
                      width: `${d.box.w * 100}%`, height: `${d.box.h * 100}%`,
                    }} />
                  ))}
                </div>
              )}
              </div>
            </div>

            <p className="mt-3 text-xs text-neutral-500">
              {selected.name} · Meta {selected.total ?? '—'} · you {userScores[selected.id] ?? '—'} · adjusted {adjusted(selected, userScores)}
              {selected.apiError ? ` · ${selected.apiError}` : ''}
            </p>
            {guidesOn && <p className="mt-1 text-[11px] text-neutral-500">Overlay: {overlay.reason}.</p>}
            {selected.rescueUrl && (
              <div className="mt-3">
                <p className="text-xs font-semibold mb-1">Muse Image cleanup (tracked in /cost)</p>
                <img src={`${API}${selected.rescueUrl}`} alt={`${selected.name} cleaned`} className="w-full max-h-[52vh] object-contain rounded-lg border border-neutral-200 dark:border-neutral-800" />
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => decide(selected, 'keep', userScores[selected.id] ?? 4)} className="px-3 py-1.5 text-xs rounded-md bg-[#FFE100] text-black font-semibold">Keep (K)</button>
              <button onClick={() => decide(selected, 'reject', userScores[selected.id] ?? 2)} className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700">Reject (X)</button>
              <button onClick={() => decide(selected, 'star', 5)} className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700">Star (S)</button>
              <button onClick={() => setGuidesOn((v) => !v)} className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700">
                {guidesOn ? 'Remove overlay' : 'Show guides'}
              </button>
              {((seg?.distractions?.length ?? 0) > 0 || (selected.deep?.flags?.length ?? 0) > 0) && !selected.rescueUrl && (
                <button onClick={() => rescuePreview(selected)} disabled={rescuing} className="px-3 py-1.5 text-xs rounded-md bg-[#FFE100] text-black font-semibold disabled:opacity-40">
                  {rescuing ? 'Cleaning…' : '✨ Rescue preview'}
                </button>
              )}
              <button onClick={() => step(-1)} className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700">← Prev</button>
              <button onClick={() => step(1)} className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700">Next →</button>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs">
              <span className="text-neutral-500">Your score:</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => decide(selected, selected.decision ?? 'keep', n)}
                  className={`w-7 h-7 rounded-md border ${userScores[selected.id] === n ? 'bg-black text-white dark:bg-white dark:text-black' : 'border-neutral-300 dark:border-neutral-700'}`}
                >
                  {n}
                </button>
              ))}
              <span className="ml-2 text-neutral-500">Rank learns the blend of Meta and you.</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
                <h3 className="font-semibold mb-1">Why this score</h3>
                <p className="text-neutral-600 dark:text-neutral-300">{selected.deep?.reason ?? 'No analysis yet.'}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {selected.deep && Object.entries(selected.deep.scores).map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="text-neutral-500">{k}</span><span>{v ?? '—'}</span></div>
                  ))}
                </div>
                {!!selected.deep?.flags.length && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.deep.flags.map((f, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-900 text-neutral-500">{f}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
                <h3 className="font-semibold mb-1">Composition and color</h3>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Guides: rule-of-thirds grid, golden-section band, diagonals, horizon-tilt line, SAM subject box.
                </p>
                <ul className="mt-2 space-y-1 text-neutral-600 dark:text-neutral-300">
                  {colorNotes.map((a, i) => <li key={i}>· {a.note}</li>)}
                  {selected.deep?.recommendation.masks.map((m, i) => <li key={`m${i}`}>· {m.target}: {m.operation}</li>)}
                </ul>
                {taste && <p className="mt-2 whitespace-pre-wrap text-neutral-500">{taste}</p>}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-neutral-500">
            Import a folder, upload photos, or load the demo to start reviewing one by one.
          </div>
        )}
      </div>

      <div className="w-60 shrink-0 border-l border-neutral-200 dark:border-neutral-800 overflow-auto">
        {ranked.map((f, i) => (
          <button key={f.id} onClick={() => setSelectedId(f.id)} className={`w-full flex items-center gap-2 p-2 text-left ${f.id === selected?.id ? 'bg-neutral-100 dark:bg-neutral-900' : ''}`}>
            <span className="text-[11px] text-neutral-400 w-5">{i + 1}</span>
            {f.previewUrl && <img src={`${API}${f.previewUrl}`} alt={f.name} className="w-14 h-10 object-cover rounded" />}
            <span className="text-[11px]">
              {f.name}
              <span className="block text-neutral-500">{adjusted(f, userScores)} {f.decision ? `· ${f.decision}` : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
