import type { PictureControlSettings } from '../types/recipe'

export const TASTE_KEYS = [
  'contrast',
  'saturation',
  'clarity',
  'shadows',
  'highlights',
  'blackLevel',
  'whiteLevel',
] as const

export type TasteKey = (typeof TASTE_KEYS)[number]

export function averageFavorites(favorites: PictureControlSettings[]): Record<string, number> {
  const avg: Record<string, number> = {}
  for (const key of TASTE_KEYS) {
    const vals = favorites
      .map((f) => (f as unknown as Record<string, unknown>)[key])
      .filter((v): v is number => typeof v === 'number')
    if (vals.length) avg[key] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
  }
  return avg
}

export function explainTaste(count: number, avg: Record<string, number>): string {
  const lines = [`Based on ${count} favorites:`]
  const sat = avg.saturation ?? 0
  if (sat > 5) lines.push(`Colors: punchy (avg saturation ${sat}). New filter keeps saturation up.`)
  else if (sat < -5) lines.push(`Colors: muted film tones (avg saturation ${sat}). New filter stays restrained.`)
  else lines.push(`Colors: near-neutral (avg saturation ${sat}). New filter stays neutral.`)
  const sh = avg.shadows ?? 0
  if (sh > 5) lines.push(`Shadows: lifted (+${sh}). New filter opens shadows similarly.`)
  else if (sh < -5) lines.push(`Shadows: deep (${sh}). New filter keeps them moody.`)
  else lines.push('Shadows: near default. New filter does the same.')
  lines.push('Blend: averaged favorite raw values, nudged contrast +3 for a similar-but-unique look.')
  return lines.join('\n')
}

export function proposeFilter(avg: Record<string, number>, note = ''): { name: string; settings: Record<string, number> } {
  const settings = { ...avg, contrast: Math.round(((avg.contrast ?? 0) + 3) * 10) / 10 }
  return { name: note ? `Taste Blend (${note.slice(0, 24)})` : 'Taste Blend 01', settings }
}
