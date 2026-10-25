import type { PictureControlSettings } from '../types/recipe'

// Standard hue angles for Nikon's 8 color blender channels
const COLOR_ANGLES: Record<string, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  cyan: 180,
  blue: 240,
  purple: 275,
  magenta: 315,
}

// Convert RGB (0..255) to HSL ([0..360, 0..1, 0..1])
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h *= 60
  }
  return [h, s, l]
}

// Convert HSL ([0..360, 0..1, 0..1]) to RGB ([0..255, 0..255, 0..255])
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(1, s))
  l = Math.max(0, Math.min(1, l))

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0, g = 0, b = 0

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

// Compute angular distance between two hues on 360 circle
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function buildToneLut(settings: PictureControlSettings): Uint8Array {
  const lut = new Uint8Array(256)
  const raw = settings.toneCurve?.raw

  const contrast = settings.contrast || 0
  const highlights = settings.highlights || 0
  const shadows = settings.shadows || 0
  const whiteLevel = settings.whiteLevel || 0
  const blackLevel = settings.blackLevel || 0

  const contrastFactor = 1.0 + (contrast / 100) * 0.5

  for (let i = 0; i < 256; i++) {
    // 1. Base Tone Curve mapping from NP3
    let v: number
    if (raw && raw.length === 256) {
      v = (raw[i] / 32767) * 255
    } else {
      v = i
    }

    // 2. Black level & White level
    if (blackLevel !== 0) {
      v = blackLevel > 0 
        ? v + (blackLevel / 100) * (255 - v) * 0.15 
        : v + (blackLevel / 100) * v * 0.15
    }
    if (whiteLevel !== 0) {
      v += (whiteLevel / 100) * (v / 255) * 35
    }

    // 3. Contrast adjustment centered at 128
    if (contrast !== 0) {
      v = 128 + (v - 128) * contrastFactor
    }

    // 4. Shadows & Highlights adjustment
    if (shadows !== 0 && v < 128) {
      const w = (128 - v) / 128
      v += (shadows / 100) * w * 40
    }
    if (highlights !== 0 && v > 128) {
      const w = (v - 128) / 128
      v += (highlights / 100) * w * 40
    }

    lut[i] = Math.min(255, Math.max(0, Math.round(v)))
  }

  return lut
}

// Apply full Nikon Flexible Color pipeline to an ImageData object
export function applyPictureControl(
  srcData: ImageData,
  dstData: ImageData,
  settings: PictureControlSettings
) {
  const src = srcData.data
  const dst = dstData.data
  const len = src.length

  const lut = buildToneLut(settings)
  const saturationFactor = 1.0 + (settings.saturation || 0) / 100
  const cb = settings.colorBlender
  const cg = settings.colorGrading

  // Pre-calculate 3-Way Color Grading tint vectors
  let hlR = 0, hlG = 0, hlB = 0
  let mtR = 0, mtG = 0, mtB = 0
  let shR = 0, shG = 0, shB = 0
  let hasColorGrading = false

  if (cg) {
    if (cg.highlights && cg.highlights.chroma > 0) {
      hasColorGrading = true
      const [r, g, b] = hslToRgb(cg.highlights.hue, 1, 0.5)
      const strength = (cg.highlights.chroma / 100) * 0.6
      hlR = (r - 128) * strength
      hlG = (g - 128) * strength
      hlB = (b - 128) * strength
    }
    if (cg.midTone && cg.midTone.chroma > 0) {
      hasColorGrading = true
      const [r, g, b] = hslToRgb(cg.midTone.hue, 1, 0.5)
      const strength = (cg.midTone.chroma / 100) * 0.6
      mtR = (r - 128) * strength
      mtG = (g - 128) * strength
      mtB = (b - 128) * strength
    }
    if (cg.shadows && cg.shadows.chroma > 0) {
      hasColorGrading = true
      const [r, g, b] = hslToRgb(cg.shadows.hue, 1, 0.5)
      const strength = (cg.shadows.chroma / 100) * 0.6
      shR = (r - 128) * strength
      shG = (g - 128) * strength
      shB = (b - 128) * strength
    }
  }

  const balance = cg ? (cg.balance || 0) / 100 : 0 // -1..+1

  // Fast check if any color blender channel is active
  let hasBlender = false
  if (cb) {
    for (const k of Object.keys(COLOR_ANGLES)) {
      const ch = (cb as any)[k]
      if (ch && (ch.hue !== 0 || ch.chroma !== 0 || ch.brightness !== 0)) {
        hasBlender = true
        break
      }
    }
  }

  for (let i = 0; i < len; i += 4) {
    let r = src[i]
    let g = src[i + 1]
    let b = src[i + 2]
    const a = src[i + 3]

    // 1. Tone curve lookup
    r = lut[r]
    g = lut[g]
    b = lut[b]

    // 2. 8-Zone Color Blender & Saturation
    if (hasBlender || saturationFactor !== 1.0) {
      const [h, s, l] = rgbToHsl(r, g, b)
      let newH = h
      let newS = s * saturationFactor
      let newL = l

      if (hasBlender && s > 0.05) {
        // Calculate influence from each color blender channel
        for (const [name, centerAngle] of Object.entries(COLOR_ANGLES)) {
          const ch = (cb as any)[name]
          if (!ch || (ch.hue === 0 && ch.chroma === 0 && ch.brightness === 0)) continue

          const dist = angleDiff(h, centerAngle)
          if (dist < 45) {
            // Smooth bell falloff across +/- 45 degrees
            const weight = Math.cos((dist / 45) * (Math.PI / 2))

            // Shift hue
            newH += (ch.hue * 0.35) * weight
            // Scale chroma/saturation
            newS += newS * (ch.chroma / 100) * weight
            // Adjust brightness
            newL += (ch.brightness / 100) * 0.25 * weight
          }
        }
      }

      const [modR, modG, modB] = hslToRgb(newH, newS, newL)
      r = modR
      g = modG
      b = modB
    }

    // 3. 3-Way Color Grading Split Toning
    if (hasColorGrading) {
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255 // 0..1
      const pivot = 0.5 + balance * 0.25

      // Shadows weight (peaks at 0, drops toward pivot)
      const wShadows = Math.max(0, (pivot - lum) / pivot)
      // Highlights weight (peaks at 1, drops toward pivot)
      const wHighlights = Math.max(0, (lum - pivot) / (1 - pivot))
      // Midtones weight (bell curve centered at pivot)
      const wMid = Math.max(0, 1 - Math.abs(lum - pivot) * 2)

      r += shR * wShadows + mtR * wMid + hlR * wHighlights
      g += shG * wShadows + mtG * wMid + hlG * wHighlights
      b += shB * wShadows + mtB * wMid + hlB * wHighlights

      r = Math.min(255, Math.max(0, r))
      g = Math.min(255, Math.max(0, g))
      b = Math.min(255, Math.max(0, b))
    }

    dst[i] = r
    dst[i + 1] = g
    dst[i + 2] = b
    dst[i + 3] = a
  }
}
