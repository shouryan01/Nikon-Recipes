import React, { useState } from 'react'
import type { PictureControlSettings, RecipeItem } from '../types/recipe'
import { ToneCurveGraph } from './ToneCurveGraph'
import { ColorWheel } from './ColorWheel'
import { ColorBlenderBars } from './ColorBlenderBars'
import { serialize } from 'nikon-flexible-color-picture-control'
import { RotateCcw, Download, Sliders, Palette, Disc } from 'lucide-react'

interface RecipeInspectorProps {
  recipe: RecipeItem
  settings: PictureControlSettings
  onUpdateSettings: (newSettings: PictureControlSettings) => void
  onResetSettings: () => void
}

export const RecipeInspector: React.FC<RecipeInspectorProps> = ({
  recipe,
  settings,
  onUpdateSettings,
  onResetSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'tone' | 'grading' | 'blender'>('tone')

  const updateParam = (key: keyof PictureControlSettings, val: number) => {
    onUpdateSettings({
      ...settings,
      [key]: val,
    })
  }

  // Export customized .NP3 file
  const handleExportNP3 = () => {
    try {
      const bytes = serialize(settings as any)
      const blob = new Blob([bytes], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `${(settings.name || 'Recipe').replace(/[^a-zA-Z0-9_-]/g, '_')}.NP3`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error exporting .NP3: ' + err)
    }
  }

  const cg = settings.colorGrading

  return (
    <div className="flex flex-col h-full bg-neutral-900 border-l border-neutral-800 w-84 shrink-0 select-none overflow-hidden">
      {/* Recipe Header */}
      <div className="p-3 border-b border-neutral-800 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-amber-500 uppercase tracking-wider font-semibold">
            Picture Control Profile
          </span>
          <button
            onClick={onResetSettings}
            className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors"
            title="Reset to recipe original settings"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>
        <h3 className="text-sm font-bold text-neutral-100 truncate">{settings.name}</h3>
        <p className="text-[11px] text-neutral-400 truncate">
          By {recipe.creator} • {recipe.category}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800 bg-neutral-950/40 text-xs">
        <button
          onClick={() => setActiveTab('tone')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-medium transition-colors border-b-2 ${
            activeTab === 'tone'
              ? 'border-amber-500 text-neutral-100 bg-neutral-800/40'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Tone & Curve</span>
        </button>

        <button
          onClick={() => setActiveTab('grading')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-medium transition-colors border-b-2 ${
            activeTab === 'grading'
              ? 'border-amber-500 text-neutral-100 bg-neutral-800/40'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Disc className="w-3.5 h-3.5" />
          <span>Color Wheels</span>
        </button>

        <button
          onClick={() => setActiveTab('blender')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-medium transition-colors border-b-2 ${
            activeTab === 'blender'
              ? 'border-amber-500 text-neutral-100 bg-neutral-800/40'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Blender</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {activeTab === 'tone' && (
          <div className="space-y-4">
            {/* Tone Curve visual graph */}
            <ToneCurveGraph curve={settings.toneCurve} />

            {/* Basic Adjustments Sliders */}
            <div className="space-y-3 bg-neutral-900/60 p-2.5 rounded-lg border border-neutral-800">
              <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider block">
                Basic Parameters
              </span>

              {/* Contrast */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Contrast</span>
                  <span className="font-mono text-neutral-400">{settings.contrast ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={settings.contrast ?? 0}
                  onChange={(e) => updateParam('contrast', Number(e.target.value))}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Highlights */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Highlights</span>
                  <span className="font-mono text-neutral-400">{settings.highlights ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={settings.highlights ?? 0}
                  onChange={(e) => updateParam('highlights', Number(e.target.value))}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Shadows */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Shadows</span>
                  <span className="font-mono text-neutral-400">{settings.shadows ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={settings.shadows ?? 0}
                  onChange={(e) => updateParam('shadows', Number(e.target.value))}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* White Level */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">White Level</span>
                  <span className="font-mono text-neutral-400">{settings.whiteLevel ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={settings.whiteLevel ?? 0}
                  onChange={(e) => updateParam('whiteLevel', Number(e.target.value))}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Black Level */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Black Level</span>
                  <span className="font-mono text-neutral-400">{settings.blackLevel ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={settings.blackLevel ?? 0}
                  onChange={(e) => updateParam('blackLevel', Number(e.target.value))}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Saturation */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Saturation</span>
                  <span className="font-mono text-neutral-400">{settings.saturation ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={settings.saturation ?? 0}
                  onChange={(e) => updateParam('saturation', Number(e.target.value))}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Clarity */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Clarity</span>
                  <span className="font-mono text-neutral-400">{settings.clarity ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-5"
                  max="5"
                  step="0.25"
                  value={settings.clarity ?? 0}
                  onChange={(e) => updateParam('clarity', Number(e.target.value))}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'grading' && (
          <div className="space-y-4">
            <div className="bg-neutral-900/60 p-3 rounded-lg border border-neutral-800">
              <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider block mb-3 text-center">
                3-Way Color Wheels
              </span>
              <div className="flex items-center justify-around gap-1">
                <ColorWheel label="Shadows" wheel={cg?.shadows} />
                <ColorWheel label="Midtones" wheel={cg?.midTone} />
                <ColorWheel label="Highlights" wheel={cg?.highlights} />
              </div>
            </div>

            {/* Blending & Balance */}
            <div className="space-y-3 bg-neutral-900/60 p-3 rounded-lg border border-neutral-800">
              <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider block">
                Split Toning Controls
              </span>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Blending</span>
                  <span className="font-mono text-neutral-400">{cg?.blending ?? 50}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={cg?.blending ?? 50}
                  onChange={(e) => {
                    const blending = Number(e.target.value)
                    onUpdateSettings({
                      ...settings,
                      colorGrading: {
                        ...(settings.colorGrading as any),
                        blending,
                      },
                    })
                  }}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-300">Balance</span>
                  <span className="font-mono text-neutral-400">{cg?.balance ?? 0}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={cg?.balance ?? 0}
                  onChange={(e) => {
                    const balance = Number(e.target.value)
                    onUpdateSettings({
                      ...settings,
                      colorGrading: {
                        ...(settings.colorGrading as any),
                        balance,
                      },
                    })
                  }}
                  className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'blender' && (
          <div className="bg-neutral-900/60 p-3 rounded-lg border border-neutral-800">
            <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider block mb-2">
              8-Channel Color Blender (HSL)
            </span>
            <ColorBlenderBars blender={settings.colorBlender} />
          </div>
        )}
      </div>

      {/* Export to Camera SD Card */}
      <div className="p-3 border-t border-neutral-800 bg-neutral-950/60 space-y-2">
        <button
          onClick={handleExportNP3}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs rounded-md shadow transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export .NP3 for Camera</span>
        </button>
        <p className="text-[10px] text-neutral-500 text-center">
          Place in <code className="text-neutral-400 font-mono">/NIKON/CUSTOMPC/</code> on your SD card
        </p>
      </div>
    </div>
  )
}
