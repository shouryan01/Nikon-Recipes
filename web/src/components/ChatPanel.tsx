import React, { useRef, useState } from 'react'
import type { PictureControlSettings, RecipeItem } from '../types/recipe'
import { chatWithServer, parseLocalTool } from '../lib/mcpTools'
import { averageFavorites, explainTaste, proposeFilter } from '../lib/taste'

interface Props {
  settings: PictureControlSettings
  recipeName: string
  photoName: string
  onApplyPatch: (patch: Partial<PictureControlSettings>) => void
  favorites: RecipeItem[]
  onMakeFilter: (name: string, settings: PictureControlSettings) => void
}

interface Msg { role: 'user' | 'assistant'; text: string }

export const ChatPanel: React.FC<Props> = ({ settings, recipeName, photoName, onApplyPatch, favorites, onMakeFilter }) => {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: 'Ask me about this recipe or tell me how to change it — "make it softer", "darker", "more punch". Sliders move right here.' },
  ])
  const [input, setInput] = useState('')
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const push = (m: Msg) => setMessages((prev) => [...prev, m])

  const handleLearn = async (note = '') => {
    if (!favorites.length) {
      push({ role: 'assistant', text: 'Star recipes in the library or Cull mode first.' })
      return
    }
    const favSettings = favorites.map((f) => f.settings as PictureControlSettings)
    const avg = averageFavorites(favSettings)
    const lines = favorites.map((f) => {
      const s = f.settings as PictureControlSettings
      return `- "${f.name}" by ${f.creator} [${f.category}]: contrast ${s.contrast ?? 0}, saturation ${s.saturation ?? 0}, clarity ${s.clarity ?? 0}, shadows ${s.shadows ?? 0}, highlights ${s.highlights ?? 0}, blackLevel ${s.blackLevel ?? 0}, whiteLevel ${s.whiteLevel ?? 0}`
    })
    push({ role: 'assistant', text: 'Reading your favorites…' })
    const live = await chatWithServer(
      [{ role: 'user', content: `My ${favorites.length} favorite Nikon recipes:\n${lines.join('\n')}\nWhat do they have in common — colors, shadows, contrast, mood? If they are all black-and-white, say so. 3-4 short plain lines, no JSON.` }],
      undefined,
      settings,
      false,
    )
    if (live) push({ role: 'assistant', text: live.reply })
    else push({ role: 'assistant', text: explainTaste(favorites.length, avg) })
    const proposal = proposeFilter(avg, note)
    onMakeFilter(proposal.name, { ...settings, ...proposal.settings, name: proposal.name })
    push({ role: 'assistant', text: `Created "${proposal.name}" and applied it. Export it as .NP3 from the inspector.` })
  }

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim()
    if (!text) return
    setInput('')
    push({ role: 'user', text })
    const lower = text.toLowerCase()

    const local = parseLocalTool(text, settings)
    if (local) {
      if (local.patch) {
        onApplyPatch(local.patch)
        push({ role: 'assistant', text: `${local.message}. Slider updated.` })
      } else {
        push({ role: 'assistant', text: local.message })
      }
      return
    }

    // Taste summaries and new filters only on an explicit ask — never volunteered.
    const wantsTaste = /make (me |a |me a )?filter|create (a )?filter|new filter|blend.*filter|from my favorites|learn( my)? taste|explain (my )?taste|what.{0,40}(taste|like|common|similar)|my (taste|favorites|favourites|favs?)|fav(ou?rite)?s?\b.*(recipe|filter)|similar.*(recipe|filter)|common.*(recipe|filter)/.test(lower)
    if (wantsTaste) {
      handleLearn(text)
      return
    }

    const starred = favorites.length ? favorites.map((f) => f.name).join(', ') : 'none yet'
    const context = `Photo: ${photoName}. Recipe: "${recipeName}". Current values: contrast ${settings.contrast}, saturation ${settings.saturation}, clarity ${settings.clarity}, shadows ${settings.shadows}, highlights ${settings.highlights}, whiteLevel ${settings.whiteLevel}, blackLevel ${settings.blackLevel}. Starred recipes: ${starred}.`
    const live = await chatWithServer([...messages, { role: 'user', text }].map((m) => ({ role: m.role, content: m.text })), context, settings)
    if (live) {
      if (live.patch) {
        onApplyPatch(live.patch)
        push({ role: 'assistant', text: `${live.reply} Slider updated.` })
      } else {
        const tool = parseLocalTool(live.reply, settings)
        if (tool?.patch) onApplyPatch(tool.patch)
        push({ role: 'assistant', text: live.reply })
      }
      return
    }
    push({ role: 'assistant', text: 'Try "make it softer", "darker", "more contrast", or "make a filter from my favorites".' })
  }

  const toggleRecord = async () => {
    if (recording) {
      mediaRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        setRecording(false)
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        try {
          const r = await fetch('http://127.0.0.1:4173/api/voice/audio', {
            method: 'POST',
            headers: { 'content-type': blob.type || 'audio/webm' },
            body: blob,
          })
          const j = await r.json()
          if (j.transcript) send(j.transcript)
          else push({ role: 'assistant', text: 'Heard nothing. Try typing instead.' })
        } catch {
          push({ role: 'assistant', text: 'Voice server not running. Type your message instead.' })
        }
      }
      mediaRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      push({ role: 'assistant', text: 'Mic blocked. Type your message instead.' })
    }
  }

  return (
    <div className="w-72 shrink-0 border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Muse chat</h2>
          <button
            onClick={() => setMessages([{ role: 'assistant', text: 'Ask me about this recipe or tell me how to change it — "make it softer", "darker", "more punch". Sliders move right here.' }])}
            title="Start a new chat"
            className="text-[11px] px-2 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
          >
            New chat
          </button>
        </div>
        <p className="text-[11px] text-neutral-500">{favorites.length} favorites</p>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`text-xs rounded-lg px-2.5 py-2 whitespace-pre-wrap ${m.role === 'user' ? 'bg-neutral-100 dark:bg-neutral-900 ml-6' : 'bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 mr-4'}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-neutral-200 dark:border-neutral-800 flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder="Ask for slider changes…"
          className="flex-1 min-w-0 text-xs px-2 py-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent"
        />
        <button onClick={toggleRecord} className={`shrink-0 px-2 text-xs rounded-md border ${recording ? 'bg-red-500 text-white border-transparent' : 'border-neutral-300 dark:border-neutral-700'}`}>
          {recording ? 'Stop' : 'Mic'}
        </button>
        <button onClick={() => send()} className="shrink-0 px-2.5 text-xs rounded-md bg-[#FFE100] text-black font-semibold">Send</button>
      </div>
    </div>
  )
}
