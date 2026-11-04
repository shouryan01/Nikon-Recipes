import type { PictureControlSettings } from '../types/recipe'

// MCP-style tool definitions the chat panel can call.
// Each call echoes in the UI and visibly updates matching sliders.
export interface ToolResult {
  ok: boolean
  message: string
  patch?: Partial<PictureControlSettings>
}

const SLIDER_ALIASES: Record<string, keyof PictureControlSettings>[] = [
  { contrast: 'contrast' },
  { saturation: 'saturation' },
  { clarity: 'clarity' },
  { shadows: 'shadows' },
  { highlights: 'highlights' },
] as unknown as Record<string, keyof PictureControlSettings>[]

function clamp(v: number): number {
  return Math.max(-100, Math.min(100, Math.round(v)))
}

// Qualitative look-words → multi-slider patches, applied relative to current values.
const LOOKS: { words: string[]; label: string; patch: Record<string, number> }[] = [
  { words: ['softer', 'soften', 'soft'], label: 'softer look', patch: { contrast: -10, shadows: 8, blackLevel: 6 } },
  { words: ['sharper', 'sharpen', 'crisper', 'crisp'], label: 'crisper tone (preview has no sharpening engine)', patch: { contrast: 10, shadows: -6, blackLevel: -6 } },
  { words: ['darker', 'moodier', 'moody'], label: 'darker mood', patch: { shadows: -12, blackLevel: -8, highlights: -6 } },
  { words: ['brighter', 'airier', 'airy'], label: 'brighter air', patch: { shadows: 12, whiteLevel: 6, highlights: 6 } },
  { words: ['punchier', 'bolder', 'punch'], label: 'punchier look', patch: { contrast: 12, saturation: 8 } },
  { words: ['muted', 'flatter', 'flat', 'faded', 'fade'], label: 'muted film feel', patch: { contrast: -10, saturation: -10 } },
]

export function parseLook(text: string, settings: PictureControlSettings): ToolResult | null {
  const lower = text.toLowerCase()
  for (const look of LOOKS) {
    if (!look.words.some((w) => lower.includes(w))) continue
    const patch: Record<string, number> = {}
    const parts: string[] = []
    for (const [key, delta] of Object.entries(look.patch)) {
      const cur = Number((settings as unknown as Record<string, unknown>)[key] ?? 0)
      const next = clamp(cur + delta)
      patch[key] = next
      parts.push(`${key} → ${next}`)
    }
    return { ok: true, message: `Tool call: ${look.label} (${parts.join(', ')})`, patch: patch as Partial<PictureControlSettings> }
  }
  if (lower.includes('warmer') || lower.includes('cooler') || lower.includes('temperature')) {
    return { ok: true, message: 'Color temperature lives in the Color Wheels tab — nudge the midtone wheel toward amber for warmer or blue for cooler, then tell me what you see.' }
  }
  return null
}

export function getSettingsSummary(settings: PictureControlSettings): string {
  return `contrast ${settings.contrast}, saturation ${settings.saturation}, clarity ${settings.clarity}, shadows ${settings.shadows}, highlights ${settings.highlights}`
}

export function setSlider(
  settings: PictureControlSettings,
  key: string,
  value: number,
): ToolResult {
  const flat = Object.assign({}, ...SLIDER_ALIASES) as Record<string, keyof PictureControlSettings>
  const target = flat[key.toLowerCase()]
  if (!target) return { ok: false, message: `Unknown slider "${key}". Try contrast, saturation, clarity, shadows, highlights.` }
  const note = target === 'clarity' ? ' (stored to .NP3; preview does not apply clarity)' : ''
  return { ok: true, message: `setSlider: ${String(target)} → ${clamp(value)}${note}`, patch: { [target]: clamp(value) } as Partial<PictureControlSettings> }
}

// Local intent parser: "more contrast", "contrast 20", "less shadows".
// Live Muse Spark calls go through the cull-studio server when reachable;
// this parser is the guaranteed fallback so the demo never stalls.
export function parseLocalTool(text: string, settings: PictureControlSettings): ToolResult | null {
  const lower = text.toLowerCase()
  const names = ['contrast', 'saturation', 'clarity', 'shadows', 'highlights'] as const
  for (const name of names) {
    const m = lower.match(new RegExp(`${name}\\s*(?:to|at|=)?\\s*(-?\\d+)`))
    if (m) return setSlider(settings, name, Number(m[1]))
    const cur = Number(settings[name] ?? 0)
    if (lower.includes(`more ${name}`)) return setSlider(settings, name, cur + 10)
    if (lower.includes(`less ${name}`)) return setSlider(settings, name, cur - 10)
  }
  if (lower.includes('reset')) return { ok: true, message: 'getSettings: ' + getSettingsSummary(settings) }
  return parseLook(text, settings)
}

export interface ChatResult {
  reply: string
  patch: Partial<PictureControlSettings> | null
}

export async function chatWithServer(
  messages: { role: string; content: string }[],
  context?: string,
  settings?: PictureControlSettings,
  tools = true,
): Promise<ChatResult | null> {
  try {
    const numeric: Record<string, number> = {}
    if (settings) {
      for (const k of ['contrast', 'highlights', 'shadows', 'whiteLevel', 'blackLevel', 'saturation', 'clarity', 'sharpning', 'midRangeSharpning'] as const) {
        if (typeof settings[k] === 'number') numeric[k] = settings[k] as number
      }
    }
    const r = await fetch('http://127.0.0.1:4173/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, context, settings: numeric, tools }),
    })
    if (!r.ok) return null
    const j = await r.json()
    if (typeof j.reply !== 'string') return null
    return { reply: j.reply, patch: j.patch && typeof j.patch === 'object' ? j.patch : null }
  } catch {
    return null
  }
}
