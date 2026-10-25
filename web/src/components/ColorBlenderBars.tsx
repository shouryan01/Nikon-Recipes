import React from 'react'
import type { ColorBlenderChannel } from '../types/recipe'

interface ColorBlenderBarsProps {
  blender?: {
    red: ColorBlenderChannel
    orange: ColorBlenderChannel
    yellow: ColorBlenderChannel
    green: ColorBlenderChannel
    cyan: ColorBlenderChannel
    blue: ColorBlenderChannel
    purple: ColorBlenderChannel
    magenta: ColorBlenderChannel
  }
}

const CHANNELS = [
  { key: 'red', label: 'Red', color: '#ef4444' },
  { key: 'orange', label: 'Orange', color: '#f97316' },
  { key: 'yellow', label: 'Yellow', color: '#eab308' },
  { key: 'green', label: 'Green', color: '#22c55e' },
  { key: 'cyan', label: 'Cyan', color: '#06b6d4' },
  { key: 'blue', label: 'Blue', color: '#3b82f6' },
  { key: 'purple', label: 'Purple', color: '#a855f7' },
  { key: 'magenta', label: 'Magenta', color: '#ec4899' },
]

export const ColorBlenderBars: React.FC<ColorBlenderBarsProps> = ({ blender }) => {
  if (!blender) {
    return <div className="text-xs text-neutral-500 py-2">No color blender adjustments</div>
  }

  return (
    <div className="space-y-2 py-1">
      <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-neutral-400 px-1 border-b border-neutral-800 pb-1">
        <span>Channel</span>
        <span className="text-right">Hue</span>
        <span className="text-right">Chroma</span>
        <span className="text-right">Bright</span>
      </div>
      {CHANNELS.map(({ key, label, color }) => {
        const ch = (blender as any)[key] || { hue: 0, chroma: 0, brightness: 0 }
        const isModified = ch.hue !== 0 || ch.chroma !== 0 || ch.brightness !== 0

        return (
          <div
            key={key}
            className={`grid grid-cols-4 items-center text-xs px-1.5 py-0.5 rounded transition-colors ${
              isModified ? 'bg-neutral-800/40' : 'opacity-60'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: color }} />
              <span className="font-medium text-[11px] truncate">{label}</span>
            </div>
            <span
              className={`text-[10px] font-mono text-right ${
                ch.hue !== 0 ? 'text-amber-400 font-semibold' : 'text-neutral-500'
              }`}
            >
              {ch.hue > 0 ? `+${ch.hue}` : ch.hue}
            </span>
            <span
              className={`text-[10px] font-mono text-right ${
                ch.chroma !== 0 ? 'text-sky-400 font-semibold' : 'text-neutral-500'
              }`}
            >
              {ch.chroma > 0 ? `+${ch.chroma}` : ch.chroma}
            </span>
            <span
              className={`text-[10px] font-mono text-right ${
                ch.brightness !== 0 ? 'text-emerald-400 font-semibold' : 'text-neutral-500'
              }`}
            >
              {ch.brightness > 0 ? `+${ch.brightness}` : ch.brightness}
            </span>
          </div>
        )
      })}
    </div>
  )
}
