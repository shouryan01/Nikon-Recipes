import type { PictureControlSettings } from '../types/recipe'
import { buildToneLut, buildBlenderLut, wheelToTint, applyPictureControl } from './colorEngine'

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
precision highp float;
varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform sampler2D u_toneLut;
uniform sampler2D u_blenderLut;
uniform float u_splitPos; // 0.0 to 1.0, -1.0 to disable
uniform float u_satFactor;
uniform float u_hasBlender;
uniform float u_hasGrading;
uniform float u_balance;
uniform float u_blending;
uniform vec3 u_dkTint;
uniform vec3 u_mtTint;
uniform vec3 u_brTint;
uniform vec3 u_zoneLuma; // (dkY, mtY, brY) normalized to -1..+1

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
      hsl.x = (c.g - c.b) / delta + (c.g < c.b ? 6.0 : 0.0);
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
  t = fract(t);
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y <= 0.0) return vec3(hsl.z);
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
  
  vec3 color = original.rgb;

  // 1. Luminance-preserving Tone Curve & Tone Sliders (YCbCr additive luminance)
  float y0 = dot(color, vec3(0.299, 0.587, 0.114));
  float y1 = texture2D(u_toneLut, vec2(clamp(y0, 0.0, 1.0), 0.5)).r;
  color = clamp(color + (y1 - y0), 0.0, 1.0);
  
  // 2. 8-Channel Color Blender (sampled from 256x1 RGBA Hue LUT)
  if (u_hasBlender > 0.5) {
    vec3 hsl = rgb2hsl(color);
    if (hsl.y > 0.02) {
      vec4 bl = texture2D(u_blenderLut, vec2(hsl.x, 0.5)) * 255.0;
      float dhDeg = (bl.r - 128.0) / 1.8;
      float dsRatio = (bl.g - 128.0) / 110.0;
      float dbCoeff = (bl.b - 128.0) / 240.0;

      float satWeight = min(1.0, pow(hsl.y, 0.35) * 1.35);
      float lClamped = clamp(hsl.z, 0.0, 1.0);
      float lumWeight = pow(lClamped, 0.65) * (1.0 - 0.3 * lClamped);
      float dlTotal = dbCoeff * satWeight * lumWeight;

      hsl.x = fract(hsl.x + dhDeg / 360.0);
      hsl.y = clamp(hsl.y * (1.0 + dsRatio), 0.0, 1.0);
      hsl.z = clamp(hsl.z + dlTotal, 0.0, 1.0);
      color = hsl2rgb(hsl);
    }
  }

  // 3. Global Saturation in YCbCr chrominance space
  if (u_satFactor != 1.0) {
    float yCur = dot(color, vec3(0.299, 0.587, 0.114));
    color = clamp(vec3(yCur) + (color - vec3(yCur)) * u_satFactor, 0.0, 1.0);
  }
  
  // 4. 3-Way Color Grading Split Toning & Zone Brightness
  if (u_hasGrading > 0.5) {
    float lum = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    float lAdj = clamp(lum + u_balance * 0.22, 0.0, 1.0);
    
    float width = 0.45 + u_blending * 0.25;
    float span = 0.55 + u_blending * 0.15;
    float wDark = pow(max(0.0, 1.0 - lAdj / span), 1.5);
    float wBright = pow(max(0.0, (lAdj - (0.45 - u_blending * 0.15)) / span), 1.5);
    float midDiff = (lAdj - 0.5) / (width * 0.55);
    float wMid = exp(-(midDiff * midDiff));
    
    float chromaMask = sin(3.14159265 * pow(max(1e-4, lum), 0.75)) * 0.85 + 0.15;
    float dY = u_zoneLuma.x * wDark + u_zoneLuma.y * wMid + u_zoneLuma.z * wBright;
    
    color += (u_dkTint * wDark + u_mtTint * wMid + u_brTint * wBright) * chromaMask + vec3(dY);
  }
  
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), original.a);
}
`

export class WebGLPreviewer {
  private canvas: HTMLCanvasElement
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private imageTexture: WebGLTexture | null = null
  private lutTexture: WebGLTexture | null = null
  private blenderTexture: WebGLTexture | null = null
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
    this.blenderTexture = gl.createTexture()
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

    // 1. Build Tone LUT texture (256x1 LUMINANCE)
    const lut = buildToneLut(settings)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, lut)

    // 2. Build 8-Channel Color Blender LUT texture (256x1 RGBA)
    const { lut: blenderLut, active: hasBlender } = buildBlenderLut(settings)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.blenderTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blenderLut)

    // Bind uniforms
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_image'), 0)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_toneLut'), 1)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_blenderLut'), 2)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_splitPos'), splitPos)

    const sat = settings.saturation || 0
    const satFactor = sat >= 0 ? 1.0 + (sat / 100) * 1.2 : 1.0 + sat / 100
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_satFactor'), satFactor)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_hasBlender'), hasBlender ? 1.0 : 0.0)

    const cg = settings.colorGrading
    let hasGrading = false
    let dkR = 0, dkG = 0, dkB = 0, dkY = 0
    let mtR = 0, mtG = 0, mtB = 0, mtY = 0
    let brR = 0, brG = 0, brB = 0, brY = 0

    if (cg) {
      const zDark = cg.highlights
      const zMid = cg.midTone
      const zBright = cg.shadows
      if (zDark && (zDark.chroma !== 0 || zDark.brightness !== 0)) {
        hasGrading = true
        ;[dkR, dkG, dkB] = wheelToTint(zDark.hue, zDark.chroma)
        dkY = (zDark.brightness / 100) * 19.5
      }
      if (zMid && (zMid.chroma !== 0 || zMid.brightness !== 0)) {
        hasGrading = true
        ;[mtR, mtG, mtB] = wheelToTint(zMid.hue, zMid.chroma)
        mtY = (zMid.brightness / 100) * 19.0
      }
      if (zBright && (zBright.chroma !== 0 || zBright.brightness !== 0)) {
        hasGrading = true
        ;[brR, brG, brB] = wheelToTint(zBright.hue, zBright.chroma)
        brY = (zBright.brightness / 100) * 18.5
      }
    }

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_hasGrading'), hasGrading ? 1.0 : 0.0)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_balance'), cg ? (cg.balance || 0) / 100 : 0)
    gl.uniform1f(
      gl.getUniformLocation(this.program, 'u_blending'),
      cg && cg.blending !== undefined ? cg.blending / 100 : 0.5
    )

    gl.uniform3f(gl.getUniformLocation(this.program, 'u_dkTint'), dkR / 255, dkG / 255, dkB / 255)
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_mtTint'), mtR / 255, mtG / 255, mtB / 255)
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_brTint'), brR / 255, brG / 255, brB / 255)
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_zoneLuma'), dkY / 255, mtY / 255, brY / 255)

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
