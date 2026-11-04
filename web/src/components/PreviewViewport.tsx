import React, { useRef, useEffect, useState, useCallback } from 'react'
import type { PictureControlSettings } from '../types/recipe'
import { WebGLPreviewer } from '../lib/webglRenderer'
import { isRecipeFile, preparePhotoFile } from '../lib/photoUpload'
import { toast } from 'sonner'
import {
  RotateCw,
  SplitSquareVertical,
  TriangleAlert,
  Upload,
  Image as ImageIcon,
} from 'lucide-react'

type RotationDeg = 0 | 90 | 180 | 270

// Draw the image rotated clockwise by deg onto a fresh canvas.
function buildRotatedCanvas(img: HTMLImageElement, deg: RotationDeg): HTMLCanvasElement {
  const swap = deg === 90 || deg === 270
  const canvas = document.createElement('canvas')
  canvas.width = swap ? img.naturalHeight : img.naturalWidth
  canvas.height = swap ? img.naturalWidth : img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((deg * Math.PI) / 180)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  }
  return canvas
}

interface PreviewViewportProps {
  currentImageSrc: string | null
  recipeSettings: PictureControlSettings
  onImageChanged: (src: string) => void
  onRecipeDropped?: (file: File) => void
  viewMode?: 'split' | 'toggle' | 'side-by-side'
  isHoldingCompare?: boolean
  setIsHoldingCompare?: (holding: boolean | ((prev: boolean) => boolean)) => void
}

const SAMPLE_IMAGES = [
  { id: 'me-nef', name: 'me.NEF (Z50 II)', url: '/samples/me-nef.jpg' },
  { id: 'portrait', name: 'Portrait', url: '/samples/portrait.jpg' },
  { id: 'landscape', name: 'Landscape', url: '/samples/landscape.jpg' },
  { id: 'street', name: 'Street / Night', url: '/samples/street.jpg' },
]

export const PreviewViewport: React.FC<PreviewViewportProps> = ({
  currentImageSrc,
  recipeSettings,
  onImageChanged,
  onRecipeDropped,
  viewMode = 'split',
  isHoldingCompare = false,
  setIsHoldingCompare,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewerRef = useRef<WebGLPreviewer | null>(null)
  const originalImgRef = useRef<HTMLImageElement | null>(null)

  const [splitPos, setSplitPos] = useState<number>(0.5) // 0 to 1
  const [isDraggingSlider, setIsDraggingSlider] = useState<boolean>(false)
  const [isDragOver, setIsDragOver] = useState<boolean>(false)
  // Keyed by source so switching photos automatically clears a stale error.
  const [loadError, setLoadError] = useState<{ src: string; message: string } | null>(null)
  const loadIdRef = useRef(0)
  // Rotation is keyed by photo so a new photo always starts unrotated.
  const [rotation, setRotation] = useState<{ src: string | null; deg: RotationDeg }>({
    src: null,
    deg: 0,
  })
  const rotationDeg: RotationDeg = rotation.src === currentImageSrc ? rotation.deg : 0
  const rotationDegRef = useRef<RotationDeg>(0)
  // Pre-rotated source fed to the renderer (and the side-by-side original).
  const rotatedSourceRef = useRef<HTMLCanvasElement | null>(null)
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Initialize or re-attach WebGL Previewer if canvas changes
  const getOrCreatePreviewer = useCallback(() => {
    if (!canvasRef.current) return null
    if (!previewerRef.current || previewerRef.current.getCanvas() !== canvasRef.current) {
      previewerRef.current = new WebGLPreviewer(canvasRef.current)
      const source = rotatedSourceRef.current ?? originalImgRef.current
      if (source) {
        previewerRef.current.setImage(source)
      }
    }
    return previewerRef.current
  }, [])

  // Re-render when settings or slider changes
  const renderFrame = useCallback(() => {
    const previewer = getOrCreatePreviewer()
    if (!previewer || !originalImgRef.current) return

    let effectiveSplit = -1.0
    if (isHoldingCompare) {
      effectiveSplit = 1.0 // Show 100% original
    } else if (viewMode === 'split') {
      effectiveSplit = splitPos
    }

    previewer.render(recipeSettings, effectiveSplit)
  }, [getOrCreatePreviewer, recipeSettings, splitPos, isHoldingCompare, viewMode])

  // Latest render function for async image-load callbacks (kept in a ref so
  // loading below only re-runs when the photo source itself changes).
  const renderFrameRef = useRef(renderFrame)
  useEffect(() => {
    renderFrameRef.current = renderFrame
    rotationDegRef.current = rotationDeg
  })

  // Rebuild the pre-rotated source from the loaded original and push it to
  // both panes. Always rotates from the pristine original, never cumulatively.
  const applyRotation = useCallback(
    (deg: RotationDeg) => {
      const img = originalImgRef.current
      if (!img || !img.naturalWidth) return
      const rotated = buildRotatedCanvas(img, deg)
      rotatedSourceRef.current = rotated
      const previewer = getOrCreatePreviewer()
      if (previewer) {
        previewer.setImage(rotated)
        renderFrameRef.current()
      }
      const originalCanvas = originalCanvasRef.current
      if (originalCanvas) {
        originalCanvas.width = rotated.width
        originalCanvas.height = rotated.height
        originalCanvas.getContext('2d')?.drawImage(rotated, 0, 0)
      }
    },
    [getOrCreatePreviewer]
  )

  const handleRotate = useCallback(() => {
    if (!currentImageSrc || !originalImgRef.current) return
    const next = ((rotationDegRef.current + 90) % 360) as RotationDeg
    setRotation({ src: currentImageSrc, deg: next })
    applyRotation(next)
  }, [currentImageSrc, applyRotation])

  // Load the image only when its source changes — never on recipe/slider
  // changes (those just re-render via the renderFrame effect below).
  useEffect(() => {
    if (!currentImageSrc) return

    const loadId = ++loadIdRef.current
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = currentImageSrc
    img.onload = () => {
      if (loadIdRef.current !== loadId) return // a newer upload superseded this one
      originalImgRef.current = img
      // A new photo always starts unrotated; rebuild from the pristine load.
      applyRotation(0)
    }
    img.onerror = () => {
      if (loadIdRef.current !== loadId) return
      setLoadError({
        src: currentImageSrc,
        message:
          'This photo could not be displayed. Try a JPEG, PNG, WebP, or TIFF export — some HEIC files cannot be decoded by browsers.',
      })
    }
  }, [currentImageSrc, getOrCreatePreviewer, applyRotation])

  useEffect(() => {
    renderFrame()
  }, [renderFrame])

  // Global Paste Handler (`Cmd+V` / `Ctrl+V`)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile()
          if (blob) {
            const prepared = await preparePhotoFile(blob as File)
            if ('rejection' in prepared) {
              toast.error(prepared.rejection.title, { description: prepared.rejection.message })
            } else {
              onImageChanged(prepared.url)
            }
            e.preventDefault()
            break
          }
        }
      }
    }

    // Spacebar to toggle original
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        setIsHoldingCompare?.(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setIsHoldingCompare?.(false)
      }
    }

    window.addEventListener('paste', handlePaste)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('paste', handlePaste)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [onImageChanged, setIsHoldingCompare])

  // Split-slider mouse / touch handling
  const handleSliderMove = useCallback(
    (clientX: number) => {
      if (!canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const newPos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      setSplitPos(newPos)
    },
    []
  )

  const handleMouseDownSlider = (e: React.MouseEvent) => {
    setIsDraggingSlider(true)
    handleSliderMove(e.clientX)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSlider) handleSliderMove(e.clientX)
    }
    const handleMouseUp = () => {
      if (isDraggingSlider) setIsDraggingSlider(false)
    }

    if (isDraggingSlider) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingSlider, handleSliderMove])

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (isRecipeFile(file)) {
        onRecipeDropped?.(file)
        break
      }
      const prepared = await preparePhotoFile(file)
      if ('rejection' in prepared) {
        toast.error(prepared.rejection.title, { description: prepared.rejection.message })
      } else {
        onImageChanged(prepared.url)
      }
      break
    }
  }

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 relative flex flex-col bg-neutral-100 dark:bg-neutral-950 overflow-hidden select-none"
    >
      {/* Main Canvas Viewport Area */}
      <div className="flex-1 relative flex items-center justify-center p-4 overflow-hidden">
        {/* Drag and drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-amber-500/20 border-2 border-dashed border-amber-400 z-50 flex flex-col items-center justify-center pointer-events-none backdrop-blur-sm">
            <ImageIcon className="w-12 h-12 text-amber-300 animate-bounce mb-2" />
            <p className="text-lg font-bold text-amber-200">Drop your photo or .NP3 recipe here</p>
          </div>
        )}

        {/* Photo decode error */}
        {loadError && loadError.src === currentImageSrc && !isDragOver && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-md">
            <div className="flex items-start gap-2 px-3 py-2 bg-red-950/95 border border-red-500/40 text-red-100 text-xs rounded-lg shadow-xl">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <p>{loadError.message}</p>
              <button
                onClick={() => setLoadError(null)}
                className="ml-1 shrink-0 text-red-300 hover:text-white font-bold"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Empty state hint if no image */}
        {!currentImageSrc ? (
          <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl max-w-md bg-white/50 dark:bg-transparent">
            <div className="w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-amber-500 dark:text-amber-400 mb-4 shadow-lg">
              <Upload className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1">
              Paste or Drop an Image
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4 max-w-sm">
              Press <kbd className="px-1.5 py-0.5 bg-neutral-200 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded text-neutral-800 dark:text-neutral-200 font-mono text-[10px]">Cmd + V</kbd> anywhere, drop a photo file, or pick a sample photo below.
            </p>
            <div className="flex gap-2">
              {SAMPLE_IMAGES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onImageChanged(s.url)}
                  className="px-3 py-1.5 text-xs bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-md font-medium transition-colors"
                >
                  Load {s.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            className={`w-full h-full flex items-center justify-center ${
              viewMode === 'side-by-side' ? 'gap-3' : ''
            }`}
          >
            {/* Original Pane (Side-by-Side only) */}
            <div
              className={`flex-1 h-full flex flex-col items-center justify-center relative bg-neutral-200/50 dark:bg-neutral-900/40 rounded-lg p-2 border border-neutral-300 dark:border-neutral-800 min-w-0 min-h-0 overflow-hidden ${
                viewMode === 'side-by-side' ? 'flex' : 'hidden'
              }`}
            >
              <span className="absolute top-4 left-4 z-10 px-2 py-0.5 bg-black/75 text-neutral-300 text-[10px] font-mono rounded backdrop-blur border border-white/10">
                ORIGINAL
              </span>
              <canvas
                ref={originalCanvasRef}
                className="max-w-full max-h-full object-contain rounded shadow-lg"
              />
            </div>

            {/* Graded Canvas Pane (Active in both modes without unmounting canvas) */}
            <div
              className={`relative flex items-center justify-center ${
                viewMode === 'side-by-side'
                  ? 'flex-1 h-full flex flex-col bg-neutral-200/50 dark:bg-neutral-900/40 rounded-lg p-2 border border-neutral-300 dark:border-neutral-800 min-w-0 min-h-0 overflow-hidden'
                  : 'max-w-full max-h-full'
              }`}
            >
              {viewMode === 'side-by-side' && (
                <span className="absolute top-4 left-4 z-10 px-2 py-0.5 bg-[#FFE100] text-black text-[10px] font-mono font-bold rounded backdrop-blur shadow">
                  {recipeSettings.name || 'GRADED'}
                </span>
              )}

              <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
                <canvas
                  ref={canvasRef}
                  className={`max-w-full max-h-full object-contain rounded ${
                    viewMode === 'side-by-side' ? 'shadow-lg' : 'shadow-2xl'
                  }`}
                  style={{
                    maxHeight: viewMode === 'side-by-side' ? '100%' : 'calc(100vh - 120px)',
                  }}
                />

                {/* Split Slider Handle & Labels (Only in Split View) */}
                {viewMode === 'split' && !isHoldingCompare && (
                  <>
                    {/* Labels */}
                    <div className="absolute top-3 left-3 z-10 pointer-events-none">
                      <span className="px-2 py-0.5 bg-black/75 text-neutral-300 text-[10px] font-mono rounded backdrop-blur border border-white/10">
                        ORIGINAL
                      </span>
                    </div>
                    <div className="absolute top-3 right-3 z-10 pointer-events-none">
                      <span className="px-2 py-0.5 bg-[#FFE100] text-black text-[10px] font-mono font-bold rounded backdrop-blur shadow">
                        {recipeSettings.name || 'RECIPE'}
                      </span>
                    </div>

                    {/* Draggable Vertical Divider Bar */}
                    <div
                      className="absolute top-0 bottom-0 z-30 cursor-ew-resize flex items-center justify-center group"
                      style={{ left: `${splitPos * 100}%`, transform: 'translateX(-50%)' }}
                      onMouseDown={handleMouseDownSlider}
                    >
                      {/* Vertical line */}
                      <div className="w-0.5 h-full bg-white shadow-[0_0_10px_rgba(0,0,0,0.8)]" />

                      {/* Handle Knob */}
                      <div className="absolute w-8 h-8 rounded-full bg-white text-neutral-900 flex items-center justify-center shadow-xl border border-neutral-300 transform transition-transform group-hover:scale-110 active:scale-95">
                        <SplitSquareVertical className="w-4 h-4 text-neutral-800" />
                      </div>
                    </div>
                  </>
                )}

                {isHoldingCompare && viewMode !== 'side-by-side' && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                    <span className="px-3 py-1 bg-[#FFE100] text-black text-xs font-bold rounded-full shadow-lg">
                      VIEWING ORIGINAL
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom Info Bar */}
      <div className="h-8 border-t border-neutral-200 dark:border-neutral-800/80 bg-white/95 dark:bg-neutral-900/90 px-4 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400 z-10 shrink-0 font-mono">
        {/* Left: Samples */}
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 dark:text-neutral-400 font-sans font-medium">Samples:</span>
          <div className="flex items-center gap-1 font-sans">
            {SAMPLE_IMAGES.map((s) => (
              <button
                key={s.id}
                onClick={() => onImageChanged(s.url)}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                  currentImageSrc === s.url
                    ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 font-medium'
                    : 'bg-neutral-100 dark:bg-neutral-800/60 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Rotate */}
        <div className="flex items-center">
          <button
            onClick={handleRotate}
            disabled={!currentImageSrc}
            title="Rotate photo 90° clockwise"
            className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors font-sans disabled:opacity-40 disabled:pointer-events-none"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="font-medium">Rotate{rotationDeg !== 0 ? ` ${rotationDeg}°` : ''}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
