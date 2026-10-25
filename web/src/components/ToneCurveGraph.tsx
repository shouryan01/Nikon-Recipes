import React from 'react'
import type { ToneCurveData } from '../types/recipe'
import { buildSplineLut } from '../lib/colorEngine'

interface ToneCurveGraphProps {
  curve?: ToneCurveData
  className?: string
}

export const ToneCurveGraph: React.FC<ToneCurveGraphProps> = ({ curve, className = '' }) => {
  const width = 200
  const height = 150
  const padding = 15

  const raw = curve?.raw
  const points = curve?.points || []

  // Generate SVG path for the 256/257 curve points
  let pathD = ''
  if (points.length >= 2) {
    const spline = buildSplineLut(points)
    const pts = Array.from(spline, (val, i) => {
      const x = padding + (i / 255) * (width - 2 * padding)
      const normY = val / 255
      const y = height - padding - normY * (height - 2 * padding)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    pathD = `M ${pts.join(' L ')}`
  } else if (raw && (raw.length === 257 || raw.length === 256)) {
    const denom = raw.length - 1
    const pts = raw.map((val, i) => {
      const x = padding + (i / denom) * (width - 2 * padding)
      const normY = val / 32767
      const y = height - padding - normY * (height - 2 * padding)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    pathD = `M ${pts.join(' L ')}`
  } else {
    // Linear diagonal fallback
    pathD = `M ${padding},${height - padding} L ${width - padding},${padding}`
  }

  return (
    <div className={`flex flex-col items-center bg-neutral-900/60 p-2.5 rounded-lg border border-neutral-800 ${className}`}>
      <div className="flex justify-between w-full text-[10px] text-neutral-400 font-mono mb-1.5 px-1">
        <span>TONE CURVE</span>
        <span>{points.length > 0 ? `${points.length} pts` : 'Standard'}</span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
      >
        {/* Background Grid */}
        <rect
          x={padding}
          y={padding}
          width={width - 2 * padding}
          height={height - 2 * padding}
          fill="rgba(0,0,0,0.4)"
          stroke="#333"
          strokeWidth="1"
        />

        {/* Diagonal Reference */}
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={padding}
          stroke="#444"
          strokeDasharray="2,2"
          strokeWidth="1"
        />

        {/* 25% 50% 75% Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const x = padding + frac * (width - 2 * padding)
          const y = padding + frac * (height - 2 * padding)
          return (
            <React.Fragment key={frac}>
              <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#262626" strokeWidth="1" />
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#262626" strokeWidth="1" />
            </React.Fragment>
          )
        })}

        {/* Active Curve */}
        <path d={pathD} fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" />

        {/* Spline Control Points */}
        {points.map((pt, idx) => {
          const cx = padding + (pt.x / 255) * (width - 2 * padding)
          const cy = height - padding - (pt.y / 255) * (height - 2 * padding)
          return (
            <circle
              key={idx}
              cx={cx}
              cy={cy}
              r="3.5"
              fill="#fbbf24"
              stroke="#000"
              strokeWidth="1.5"
            />
          )
        })}
      </svg>
      <div className="flex justify-between w-full text-[9px] text-neutral-500 font-mono mt-1 px-1">
        <span>Shadows</span>
        <span>Midtones</span>
        <span>Highlights</span>
      </div>
    </div>
  )
}
