export interface ColorGradingWheel {
  hue: number // 0..360
  chroma: number // 0..100
  brightness: number // -100..100
}

export interface ColorBlenderChannel {
  hue: number // -100..100
  chroma: number // -100..100
  brightness: number // -100..100
}

export interface ToneCurveData {
  raw: number[]
  points?: { x: number; y: number }[]
}

export interface PictureControlSettings {
  name: string
  sharpning: number
  midRangeSharpning: number
  clarity: number
  contrast: number
  highlights: number
  shadows: number
  whiteLevel: number
  blackLevel: number
  saturation: number
  colorBlender?: {
    red: ColorBlenderChannel
    orange: ColorBlenderChannel
    yellow: ColorBlenderChannel
    green: ColorBlenderChannel
    cyan: ColorBlenderChannel
    blue: ColorBlenderChannel
    purple: ColorBlenderChannel
    magenta: ColorBlenderChannel
  }
  colorGrading?: {
    highlights: ColorGradingWheel
    midTone: ColorGradingWheel
    shadows: ColorGradingWheel
    blending: number
    balance: number
  }
  toneCurve?: ToneCurveData
}

export interface RecipeItem {
  id: string
  name: string
  category: string
  creator: string
  path: string
  thumbnail?: string | null
  settings: PictureControlSettings
}
