import React, { useState } from 'react'
import { SplitSquareVertical, Columns2, Eye } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip'

interface HeaderProps {
  viewMode?: 'split' | 'side-by-side' | 'toggle'
  onViewModeChange?: (mode: 'split' | 'side-by-side') => void
  isHoldingCompare?: boolean
  onHoldCompareChange?: (holding: boolean) => void
}

export const Header: React.FC<HeaderProps> = ({
  viewMode = 'split',
  onViewModeChange,
  isHoldingCompare = false,
  onHoldCompareChange,
}) => {
  const [showCompareHint, setShowCompareHint] = useState(false)
  return (
    <header className="h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-5 flex items-center justify-between z-50 shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-3.5">
        <div className="flex items-center gap-2.5">
          <img
            src="/favicon.svg"
            alt="nef logo"
            className="w-9 h-9 object-contain"
          />
          <h1 className="text-2xl font-black tracking-tight text-neutral-900 dark:text-white flex items-center leading-none">
            nef
          </h1>
        </div>
      </div>

      {/* View Mode Toggles & Theme Toggle */}
      <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
        {onViewModeChange && (
          <div className="flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-900 p-0.5 rounded-md border border-neutral-200 dark:border-neutral-800">
            <button
              onClick={() => onViewModeChange('split')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                viewMode === 'split'
                  ? 'bg-[#FFE100] text-black font-semibold shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
              title="Split-screen slider"
            >
              <SplitSquareVertical className="w-3.5 h-3.5" />
              <span>Split</span>
            </button>

            <button
              onClick={() => onViewModeChange('side-by-side')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                viewMode === 'side-by-side'
                  ? 'bg-[#FFE100] text-black font-semibold shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
              title="Side-by-side comparison"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Side-by-Side</span>
            </button>

            <Tooltip open={showCompareHint} onOpenChange={setShowCompareHint}>
              <TooltipTrigger
                render={
                  <button
                    onMouseDown={() => {
                      onHoldCompareChange?.(true)
                      setShowCompareHint(true)
                    }}
                    onMouseUp={() => {
                      onHoldCompareChange?.(false)
                      setTimeout(() => setShowCompareHint(false), 2000)
                    }}
                    onMouseLeave={() => {
                      onHoldCompareChange?.(false)
                      setShowCompareHint(false)
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors select-none ${
                      isHoldingCompare
                        ? 'bg-[#FFE100] text-black font-semibold shadow-xs'
                        : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                    }`}
                  />
                }
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Original</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center" className="font-mono text-[11px]">
                Compare: Hold Space
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Theme Toggle (Replacing GitHub link in top right corner) */}
        <ThemeToggle />
      </div>
    </header>
  )
}
