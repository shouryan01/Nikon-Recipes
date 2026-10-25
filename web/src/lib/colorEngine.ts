import type { PictureControlSettings } from '../types/recipe'

// Calibrated hue center angles (in degrees) for Nikon's 8 Color Blender channels,
// fitted against Nikon NX Studio (SaveProcess / libpicture_control.n5m) ground truth.
const COLOR_ANGLES: Record<string, number> = {
  red: 0,
  orange: 18,
  yellow: 58,
  green: 105,
  cyan: 160,
  blue: 218,
  purple: 265,
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

// Natural cubic spline interpolation through Nikon Tone Curve control points (0..255)
export function buildSplineLut(points: { x: number; y: number }[]): Float32Array {
  const lut = new Float32Array(256)
  const pts = [...points].sort((a, b) => a.x - b.x)
  const n = pts.length
  if (n === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i
    return lut
  }
  if (n === 1) {
    lut.fill(pts[0].y)
    return lut
  }

  const x = pts.map((p) => p.x)
  const y = pts.map((p) => p.y)
  const h = new Float64Array(n - 1)
  for (let i = 0; i < n - 1; i++) h[i] = Math.max(1e-5, x[i + 1] - x[i])

  const alpha = new Float64Array(n - 1)
  for (let i = 1; i < n - 1; i++) {
    alpha[i] = (3 / h[i]) * (y[i + 1] - y[i]) - (3 / h[i - 1]) * (y[i] - y[i - 1])
  }

  const l = new Float64Array(n)
  const mu = new Float64Array(n)
  const z = new Float64Array(n)
  l[0] = 1
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1]
    mu[i] = h[i] / l[i]
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i]
  }
  l[n - 1] = 1

  const c = new Float64Array(n)
  const b = new Float64Array(n - 1)
  const d = new Float64Array(n - 1)
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1]
    b[j] = (y[j + 1] - y[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3
    d[j] = (c[j + 1] - c[j]) / (3 * h[j])
  }

  for (let xi = 0; xi < 256; xi++) {
    if (xi <= x[0]) {
      lut[xi] = y[0]
    } else if (xi >= x[n - 1]) {
      lut[xi] = y[n - 1]
    } else {
      let j = 0
      while (j < n - 2 && xi > x[j + 1]) j++
      const dx = xi - x[j]
      const val = y[j] + b[j] * dx + c[j] * dx * dx + d[j] * dx * dx * dx
      lut[xi] = Math.max(0, Math.min(255, val))
    }
  }
  return lut
}

// Build calibrated 256-entry Tone LUT (applied in YCbCr luminance space)
export function buildToneLut(settings: PictureControlSettings): Uint8Array {
  const lut = new Uint8Array(256)
  const points = settings.toneCurve?.points
  const raw = settings.toneCurve?.raw

  const splineLut = points && points.length >= 2 ? buildSplineLut(points) : null

  const contrast = settings.contrast || 0
  const highlights = settings.highlights || 0
  const shadows = settings.shadows || 0
  const whiteLevel = settings.whiteLevel || 0
  const blackLevel = settings.blackLevel || 0

  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let y: number

    // 1. Custom Tone Curve from NP3 (natural cubic spline through points or 257-pt raw LUT)
    if (splineLut) {
      y = splineLut[i] / 255
    } else if (raw && (raw.length === 257 || raw.length === 256)) {
      const maxIdx = raw.length - 1
      const idx = x * maxIdx
      const i0 = Math.floor(idx)
      const i1 = Math.min(maxIdx, i0 + 1)
      const frac = idx - i0
      y = (raw[i0] * (1 - frac) + raw[i1] * frac) / 32767
    } else {
      y = x
    }

    // 2. Black Level (-100..+100)
    if (blackLevel !== 0) {
      const b = blackLevel / 100
      if (b > 0) {
        const toe = 1 - 0.35 * Math.exp(-y * 18)
        y += b * (27.5 / 255) * (1 - y) * toe
      } else {
        const crush = (68 / 255) * (1 - y) * (1 - Math.exp(-y * 7))
        y += b * crush
      }
    }

    // 3. White Level (-100..+100)
    if (whiteLevel !== 0) {
      const w = whiteLevel / 100
      if (w > 0) {
        const shoulder = 1 - Math.pow(Math.max(0, (y - 0.55) / 0.45), 2.2) * 0.75
        y += w * 0.365 * y * shoulder
      } else {
        const roll = 1 - Math.pow(Math.max(0, (y - 0.85) / 0.15), 2) * 0.6
        y += w * 0.155 * y * roll
      }
    }

    // 4. Contrast (-100..+100)
    if (contrast !== 0) {
      const c = contrast / 100
      y -= c * (18.8 / 255) * Math.sin(2 * Math.PI * Math.pow(Math.max(0, Math.min(1, y)), 0.96))
    }

    // 5. Shadows (-100..+100)
    if (shadows !== 0) {
      const s = shadows / 100
      if (y < 0.72) {
        const t = y / 0.72
        const bell = Math.sin(Math.PI * Math.pow(t, 0.68)) * (1 - 0.25 * t)
        y += s * (26.8 / 255) * bell
      }
    }

    // 6. Highlights (-100..+100)
    if (highlights !== 0) {
      const h = highlights / 100
      if (y > 0.28) {
        const t = Math.min(1, (y - 0.28) / 0.72)
        if (h > 0) {
          const wave = Math.sin(Math.PI * Math.pow(t, 0.85))
          y += h * (23.2 / 255) * wave
        } else {
          const pull = Math.pow(t, 1.45) * (1 - 0.18 * Math.pow(t, 4))
          y += h * (23.5 / 255) * pull
        }
      }
    }

    lut[i] = Math.min(255, Math.max(0, Math.round(y * 255)))
  }

  return lut
}

// Precompute 256-entry 8-Channel Color Blender LUT indexed by hue (0..360 -> 0..255)
// Returns RGBA Uint8Array (256 * 4) so WebGL can upload it directly as an RGBA texture:
//   R: hue shift dh in [-64..+64] deg -> encoded as 128 + dh * 1.8
//   G: chroma ratio ds in [-1..+1]    -> encoded as 128 + ds * 110
//   B: brightness coeff db in [-0.5..+0.5] -> encoded as 128 + db * 240
//   A: 255 if any channel active, 0 otherwise
export function buildBlenderLut(settings: PictureControlSettings): { lut: Uint8Array; active: boolean } {
  const lut = new Uint8Array(256 * 4)
  const cb = settings.colorBlender
  let active = false
  if (cb) {
    for (const k of Object.keys(COLOR_ANGLES)) {
      const ch = (cb as any)[k]
      if (ch && (ch.hue !== 0 || ch.chroma !== 0 || ch.brightness !== 0)) {
        active = true
        break
      }
    }
  }

  if (!active || !cb) {
    for (let i = 0; i < 256; i++) {
      lut[i * 4] = 128
      lut[i * 4 + 1] = 128
      lut[i * 4 + 2] = 128
      lut[i * 4 + 3] = 0
    }
    return { lut, active: false }
  }

  for (let i = 0; i < 256; i++) {
    const h = (i / 255) * 360
    let dhTotal = 0
    let dsRatio = 0
    let dbCoeff = 0

    for (const [name, centerAngle] of Object.entries(COLOR_ANGLES)) {
      const ch = (cb as any)[name]
      if (!ch || (ch.hue === 0 && ch.chroma === 0 && ch.brightness === 0)) continue

      const span = name === 'green' || name === 'blue' ? 68 : 55
      const dist = angleDiff(h, centerAngle)
      if (dist < span) {
        const weight = 0.5 * (1 + Math.cos((dist / span) * Math.PI))
        dhTotal += (ch.hue / 100) * 32 * weight
        dsRatio += (ch.chroma / 100) * 0.62 * weight
        dbCoeff += (ch.brightness / 100) * 0.24 * weight
      }
    }

    lut[i * 4] = Math.max(0, Math.min(255, Math.round(128 + dhTotal * 1.8)))
    lut[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(128 + dsRatio * 110)))
    lut[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(128 + dbCoeff * 240)))
    lut[i * 4 + 3] = 255
  }

  return { lut, active: true }
}

// Convert Nikon Color Grading wheel (hue 0..360, chroma 0..100) to (dR, dG, dB) in 0..255 scale
export function wheelToTint(hue: number, chroma: number): [number, number, number] {
  if (!chroma) return [0, 0, 0]
  const rad = ((hue - 12) * Math.PI) / 180
  const c = chroma / 100
  const dr = Math.cos(rad) * 58 * c
  const dg = Math.cos(rad - 2.15) * 38 * c
  const db = Math.cos(rad + 2.15) * 36 * c
  const dy = 0.299 * dr + 0.587 * dg + 0.114 * db
  return [dr - dy * 0.65, dg - dy * 0.65, db - dy * 0.65]
}

// Apply full calibrated Nikon Flexible Color pipeline to an ImageData object
export function applyPictureControl(
  srcData: ImageData,
  dstData: ImageData,
  settings: PictureControlSettings
) {
  const src = srcData.data
  const dst = dstData.data
  const len = src.length

  const lut = buildToneLut(settings)
  const { lut: blenderLut, active: hasBlender } = buildBlenderLut(settings)

  const sat = settings.saturation || 0
  const satFactor = sat >= 0 ? 1.0 + (sat / 100) * 1.2 : 1.0 + sat / 100
  const cg = settings.colorGrading

  // Note: in nikon-flexible-color-picture-control's NP3 parser, offset 368 (Nikon's dark/shadows wheel)
  // is stored in cg.highlights, offset 372 in cg.midTone, and offset 376 (bright/highlights wheel) in cg.shadows.
  let hasColorGrading = false
  let dkR = 0, dkG = 0, dkB = 0, dkY = 0
  let mtR = 0, mtG = 0, mtB = 0, mtY = 0
  let brR = 0, brG = 0, brB = 0, brY = 0
  const balance = cg ? (cg.balance || 0) / 100 : 0
  const blending = cg && cg.blending !== undefined ? cg.blending / 100 : 0.5

  if (cg) {
    const zDark = cg.highlights
    const zMid = cg.midTone
    const zBright = cg.shadows
    if (zDark && (zDark.chroma !== 0 || zDark.brightness !== 0)) {
      hasColorGrading = true
      ;[dkR, dkG, dkB] = wheelToTint(zDark.hue, zDark.chroma)
      dkY = (zDark.brightness / 100) * 19.5
    }
    if (zMid && (zMid.chroma !== 0 || zMid.brightness !== 0)) {
      hasColorGrading = true
      ;[mtR, mtG, mtB] = wheelToTint(zMid.hue, zMid.chroma)
      mtY = (zMid.brightness / 100) * 19.0
    }
    if (zBright && (zBright.chroma !== 0 || zBright.brightness !== 0)) {
      hasColorGrading = true
      ;[brR, brG, brB] = wheelToTint(zBright.hue, zBright.chroma)
      brY = (zBright.brightness / 100) * 18.5
    }
  }

  for (let i = 0; i < len; i += 4) {
    let r = src[i]
    let g = src[i + 1]
    let b = src[i + 2]
    const a = src[i + 3]

    // 1. Luminance-preserving Tone Curve & Tone Sliders (YCbCr additive luminance)
    const y0 = 0.299 * r + 0.587 * g + 0.114 * b
    const yi = Math.min(255, Math.max(0, Math.floor(y0)))
    const yf = y0 - yi
    const y1 = lut[yi] * (1 - yf) + lut[Math.min(255, yi + 1)] * yf
    const dyTone = y1 - y0
    r = Math.max(0, Math.min(255, r + dyTone))
    g = Math.max(0, Math.min(255, g + dyTone))
    b = Math.max(0, Math.min(255, b + dyTone))

    // 2. 8-Channel Color Blender (via precomputed 256-entry Hue LUT)
    if (hasBlender) {
      const [h, s, l] = rgbToHsl(r, g, b)
      if (s > 0.02) {
        const hi = Math.min(255, Math.max(0, Math.round((h / 360) * 255)))
        const dhTotal = (blenderLut[hi * 4] - 128) / 1.8
        const dsRatio = (blenderLut[hi * 4 + 1] - 128) / 110
        const dbCoeff = (blenderLut[hi * 4 + 2] - 128) / 240

        const satWeight = Math.min(1, Math.pow(s, 0.35) * 1.35)
        const lumWeight = Math.pow(Math.max(0, Math.min(1, l)), 0.65) * (1 - 0.3 * l)
        const dlTotal = dbCoeff * satWeight * lumWeight

        const newH = h + dhTotal
        const newS = Math.max(0, Math.min(1, s * (1 + dsRatio)))
        const newL = Math.max(0, Math.min(1, l + dlTotal))
        ;[r, g, b] = hslToRgb(newH, newS, newL)
      }
    }

    // 3. Global Saturation in YCbCr chrominance space
    if (satFactor !== 1.0) {
      const yCur = 0.299 * r + 0.587 * g + 0.114 * b
      r = Math.max(0, Math.min(255, yCur + (r - yCur) * satFactor))
      g = Math.max(0, Math.min(255, yCur + (g - yCur) * satFactor))
      b = Math.max(0, Math.min(255, yCur + (b - yCur) * satFactor))
    }

    // 4. 3-Way Color Grading Split Toning & Zone Brightness
    if (hasColorGrading) {
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      const shift = balance * 0.22
      const lAdj = Math.max(0, Math.min(1, lum + shift))

      const width = 0.45 + blending * 0.25
      const wDark = Math.pow(Math.max(0, 1 - lAdj / (0.55 + blending * 0.15)), 1.5)
      const wBright = Math.pow(Math.max(0, (lAdj - (0.45 - blending * 0.15)) / (0.55 + blending * 0.15)), 1.5)
      const wMid = Math.exp(-Math.pow((lAdj - 0.5) / (width * 0.55), 2))

      const chromaMask = Math.sin(Math.PI * Math.pow(lum, 0.75)) * 0.85 + 0.15

      const dY = dkY * wDark + mtY * wMid + brY * wBright
      r += (dkR * wDark + mtR * wMid + brR * wBright) * chromaMask + dY
      g += (dkG * wDark + mtG * wMid + brG * wBright) * chromaMask + dY
      b += (brB * wBright + mtB * wMid + dkB * wDark) * chromaMask + dY

      r = Math.min(255, Math.max(0, r))
      g = Math.min(255, Math.max(0, g))
      b = Math.min(255, Math.max(0, b))
    }

    dst[i] = Math.round(r)
    dst[i + 1] = Math.round(g)
    dst[i + 2] = Math.round(b)
    dst[i + 3] = a
  }
}
