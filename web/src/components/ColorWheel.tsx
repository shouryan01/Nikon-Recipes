import React from 'react'
import type { ColorGradingWheel } from '../types/recipe'

interface ColorWheelProps {
  label: string
  wheel?: ColorGradingWheel
  size?: number
}

export const ColorWheel: React.FC<ColorWheelProps> = ({
  label,
  wheel = { hue: 0, chroma: 0, brightness: 0 },
  size = 72,
}) => {
  const radius = size / 2
  const padding = 4
  const innerRadius = radius - padding

  // Convert hue and chroma to (x, y) dot position inside the wheel
  const rad = (wheel.hue * Math.PI) / 180
  const dist = (Math.min(wheel.chroma, 100) / 100) * (innerRadius - 4)
  const dotX = radius + Math.cos(rad) * dist
  const dotY = radius + Math.sin(rad) * dist

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="overflow-visible">
          <defs>
            <radialGradient id={`wheel-grad-${label}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#808080" />
              <stop offset="100%" stopColor="#222" stopOpacity="0.2" />
            </radialGradient>
          </defs>

          {/* Color Wheel Background Circle */}
          <circle
            cx={radius}
            cy={radius}
            r={innerRadius}
            fill={`url(#wheel-grad-${label})`}
            stroke="#404040"
            strokeWidth="1.5"
            style={{
              background: 'conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)',
              borderRadius: '50%',
            }}
          />

          {/* Color Wheel Conic Ring overlay */}
          <foreignObject x={padding} y={padding} width={innerRadius * 2} height={innerRadius * 2}>
            <div
              className="w-full h-full rounded-full opacity-65"
              style={{
                background: 'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
                maskImage: 'radial-gradient(circle, transparent 15%, black 90%)',
                WebkitMaskImage: 'radial-gradient(circle, transparent 15%, black 90%)',
              }}
            />
          </foreignObject>

          {/* Center Crosshair */}
          <line x1={radius - 3} y1={radius} x2={radius + 3} y2={radius} stroke="#555" strokeWidth="1" />
          <line x1={radius} y1={radius - 3} x2={radius} y2={radius + 3} stroke="#555" strokeWidth="1" />

          {/* Tint Position Indicator */}
          {wheel.chroma > 0 && (
            <circle
              cx={dotX}
              cy={dotY}
              r="4.5"
              fill="#ffffff"
              stroke="#000"
              strokeWidth="1.5"
              className="drop-shadow-md"
            />
          )}
        </svg>
      </div>
      <span className="text-[10px] text-neutral-300 font-medium mt-1 uppercase tracking-wider">{label}</span>
      <div className="text-[9px] text-neutral-500 font-mono">
        H:{wheel.hue}° C:{wheel.chroma}%
      </div>
    </div>
  )
}
