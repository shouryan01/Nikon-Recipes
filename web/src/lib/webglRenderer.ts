import type { PictureControlSettings } from '../types/recipe'
import { buildToneLut, applyPictureControl } from './colorEngine'

const VS_SOURCE = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  v_texCoord = (a_position + 1.0) * 0.5;
  v_texCoord.y = 1.0 - v_texCoord.y; // Flip Y for canvas
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FS_SOURCE = `
precision mediump float;
varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform sampler2D u_toneLut;
uniform float u_splitPos; // 0.0 to 1.0, -1.0 to disable
uniform float u_saturation;
uniform float u_balance;
uniform vec3 u_shTint;
uniform vec3 u_mtTint;
uniform vec3 u_hlTint;

vec3 rgb2hsl(vec3 c) {
  float cMin = min(min(c.r, c.g), c.b);
  float cMax = max(max(c.r, c.g), c.b);
  float delta = cMax - cMin;
  
  vec3 hsl = vec3(0.0, 0.0, (cMax + cMin) * 0.5);
  
  if (delta != 0.0) {
    if (hsl.z < 0.5) {
      hsl.y = delta / (cMax + cMin);
    } else {
      hsl.y = delta / (2.0 - cMax - cMin);
    }
    
    if (c.r == cMax) {
      hsl.x = (c.g - c.b) / delta;
    } else if (c.g == cMax) {
      hsl.x = 2.0 + (c.b - c.r) / delta;
    } else {
      hsl.x = 4.0 + (c.r - c.g) / delta;
    }
    hsl.x = fract(hsl.x / 6.0);
  }
  return hsl;
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hue2rgb(p, q, hsl.x + 1.0/3.0),
    hue2rgb(p, q, hsl.x),
    hue2rgb(p, q, hsl.x - 1.0/3.0)
  );
}

void main() {
  vec4 original = texture2D(u_image, v_texCoord);
  
  // Show original on left if split slider is active
  if (u_splitPos >= 0.0 && v_texCoord.x < u_splitPos) {
    gl_FragColor = original;
    return;
  }
  
  // 1. Tone curve lookup
  float r = texture2D(u_toneLut, vec2(original.r, 0.5)).r;
  float g = texture2D(u_toneLut, vec2(original.g, 0.5)).r;
  float b = texture2D(u_toneLut, vec2(original.b, 0.5)).r;
  vec3 color = vec3(r, g, b);
  
  // 2. Saturation
  if (u_saturation != 1.0) {
    vec3 hsl = rgb2hsl(color);
    hsl.y = clamp(hsl.y * u_saturation, 0.0, 1.0);
    color = hsl2rgb(hsl);
  }
  
  // 3. 3-Way Color Grading
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  float pivot = clamp(0.5 + u_balance * 0.25, 0.1, 0.9);
  
  float wShadows = max(0.0, (pivot - lum) / pivot);
  float wHighlights = max(0.0, (lum - pivot) / (1.0 - pivot));
  float wMid = max(0.0, 1.0 - abs(lum - pivot) * 2.0);
  
  color += u_shTint * wShadows + u_mtTint * wMid + u_hlTint * wHighlights;
  
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), original.a);
}
`

export class WebGLPreviewer {
  private canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private imageTexture: WebGLTexture | null = null
  private lutTexture: WebGLTexture | null = null
  private positionBuffer: WebGLBuffer | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })
    if (this.gl) {
      this.initGL()
    }
  }

  private initGL() {
    const gl = this.gl!
    const createShader = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vs = createShader(gl.VERTEX_SHADER, VS_SOURCE)
    const fs = createShader(gl.FRAGMENT_SHADER, FS_SOURCE)
    if (!vs || !fs) return

    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program))
      return
    }
    this.program = program

    this.positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]),
      gl.STATIC_DRAW
    )

    this.imageTexture = gl.createTexture()
    this.lutTexture = gl.createTexture()
  }

  public setImage(image: HTMLImageElement | HTMLCanvasElement) {
    if (!this.gl || !this.program) return
    const gl = this.gl
    this.canvas.width = image.width
    this.canvas.height = image.height
    gl.viewport(0, 0, image.width, image.height)

    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }

  public render(
    settings: PictureControlSettings,
    splitPos: number = -1,
    sourceCanvas?: HTMLCanvasElement
  ) {
    if (!this.gl || !this.program) {
      // Fallback to 2D canvas if WebGL is unavailable
      if (sourceCanvas) {
        const ctx = this.canvas.getContext('2d')
        if (ctx) {
          this.canvas.width = sourceCanvas.width
          this.canvas.height = sourceCanvas.height
          const srcData = sourceCanvas.getContext('2d')!.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
          const dstData = ctx.createImageData(sourceCanvas.width, sourceCanvas.height)
          applyPictureControl(srcData, dstData, settings)
          ctx.putImageData(dstData, 0, 0)
        }
      }
      return
    }

    const gl = this.gl
    gl.useProgram(this.program)

    // Build Tone LUT texture (256x1 pixels)
    const lut = buildToneLut(settings)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, lut)

    // Bind uniforms
    const uImage = gl.getUniformLocation(this.program, 'u_image')
    const uToneLut = gl.getUniformLocation(this.program, 'u_toneLut')
    const uSplitPos = gl.getUniformLocation(this.program, 'u_splitPos')
    const uSaturation = gl.getUniformLocation(this.program, 'u_saturation')
    const uBalance = gl.getUniformLocation(this.program, 'u_balance')
    const uShTint = gl.getUniformLocation(this.program, 'u_shTint')
    const uMtTint = gl.getUniformLocation(this.program, 'u_mtTint')
    const uHlTint = gl.getUniformLocation(this.program, 'u_hlTint')

    gl.uniform1i(uImage, 0)
    gl.uniform1i(uToneLut, 1)
    gl.uniform1f(uSplitPos, splitPos)
    gl.uniform1f(uSaturation, 1.0 + (settings.saturation || 0) / 100)

    const cg = settings.colorGrading
    gl.uniform1f(uBalance, cg ? (cg.balance || 0) / 100 : 0)

    const getTint = (wheel?: { hue: number; chroma: number }) => {
      if (!wheel || wheel.chroma <= 0) return [0, 0, 0]
      const rad = (wheel.hue * Math.PI) / 180
      const str = (wheel.chroma / 100) * 0.35
      return [
        Math.cos(rad) * str,
        Math.cos(rad - (2 * Math.PI) / 3) * str,
        Math.cos(rad - (4 * Math.PI) / 3) * str,
      ]
    }

    const sh = getTint(cg?.shadows)
    const mt = getTint(cg?.midTone)
    const hl = getTint(cg?.highlights)

    gl.uniform3f(uShTint, sh[0], sh[1], sh[2])
    gl.uniform3f(uMtTint, mt[0], mt[1], mt[2])
    gl.uniform3f(uHlTint, hl[0], hl[1], hl[2])

    // Bind image
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)

    // Position attribute
    const aPos = gl.getAttribLocation(this.program, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas
  }
}
