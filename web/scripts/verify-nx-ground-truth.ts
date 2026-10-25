import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { serialize } from 'nikon-flexible-color-picture-control'
import { applyPictureControl } from '../src/lib/colorEngine'
import type { PictureControlSettings } from '../src/types/recipe'

const SAVE_PROCESS =
  '/Applications/Nikon Software/NX Studio/NX Studio.app/Contents/MacOS/SaveProcess'
const REPO_ROOT = path.resolve(import.meta.dir, '../..')
const DEFAULT_NEF = path.resolve(import.meta.dir, '../me.NEF')

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#xA;')
}

export function buildNkscWithNp3(
  np3Buf: Buffer | Uint8Array,
  savedPicConProcess: number | null = 0,
  picControlId: number = 16
): string {
  const b64Raw = Buffer.from(np3Buf).toString('base64')
  const lines: string[] = []
  for (let i = 0; i < b64Raw.length; i += 60) {
    lines.push(b64Raw.slice(i, i + 60))
  }
  const b64WithNewlines = lines.join('\n') + '\n'
  const exportSize = b64Raw.length + lines.length
  const savedProcTag =
    savedPicConProcess !== null ? `<SavedPicConProcess>${savedPicConProcess}</SavedPicConProcess>` : ''

  const userDataXml = `<userData><filter id="nikon::PictureControl"><active>true</active><parameters><Export><ExportData>${b64WithNewlines}</ExportData><ExportDataSize>${exportSize}</ExportDataSize></Export><SelectedPictureControl>0</SelectedPictureControl><AutoContrast>255</AutoContrast><AutoSaturation>255</AutoSaturation><SelectedPictureControlVersion2>0</SelectedPictureControlVersion2>${savedProcTag}<PictureControl>${picControlId}</PictureControl></parameters></filter></userData>`

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 5.5.0">
   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about=""
            xmlns:sdc="http://ns.nikon.com/sdc/1.0/"
            xmlns:ast="http://ns.nikon.com/asteroid/1.0/"
            xmlns:astype="http://ns.nikon.com/asteroid/Types/1.0/"
            xmlns:nine="http://ns.nikon.com/nine/1.0/">
         <sdc:about>nikon sidecar/1.0</sdc:about>
         <sdc:version>1.1.0</sdc:version>
         <sdc:appversion>1.7 M</sdc:appversion>
         <sdc:appname>NX Studio</sdc:appname>
         <ast:about>core-asteroid-tags</ast:about>
         <ast:version>11.0.0.3000</ast:version>
         <nine:about>nine-tags</nine:about>
         <nine:version>2.0.0</nine:version>
         <nine:NineEdits>${escapeXml(userDataXml)}</nine:NineEdits>
      </rdf:Description>
   </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

export function readTiffPixels(tifPath: string): { width: number; height: number; data: Uint8Array } {
  const buf = fs.readFileSync(tifPath)
  const le = buf.toString('ascii', 0, 2) === 'II'
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
  const ifd0 = u32(4)
  const n = u16(ifd0)
  let width = 0,
    height = 0,
    stripOffsets = 0,
    stripByteCounts = 0
  for (let i = 0; i < n; i++) {
    const off = ifd0 + 2 + i * 12
    const tag = u16(off)
    const type = u16(off + 2)
    const count = u32(off + 4)
    const val = type === 3 && count === 1 ? u16(off + 8) : u32(off + 8)
    if (tag === 256) width = val
    if (tag === 257) height = val
    if (tag === 273) stripOffsets = val
    if (tag === 279) stripByteCounts = val
  }
  return {
    width,
    height,
    data: new Uint8Array(buf.buffer, buf.byteOffset + stripOffsets, stripByteCounts),
  }
}

export function renderNefViaSaveProcess(
  nefPath: string,
  workDir: string,
  name: string,
  nkscContent: string | null,
  size = 300
): { width: number; height: number; data: Uint8Array } {
  const outTif = path.join(workDir, `render_${name}.tif`)
  if (fs.existsSync(outTif)) {
    return readTiffPixels(outTif)
  }
  const hydPath = path.join(workDir, `job_${name}.hyd`)
  let sidecarLine = ''
  if (nkscContent !== null) {
    const nkscPath = path.join(workDir, `sc_${name}.nksc`)
    fs.writeFileSync(nkscPath, nkscContent)
    sidecarLine = `SidecarFile=${nkscPath}`
  }
  const hyd =
    [
      `InputFile=${nefPath}`,
      `OutputFile=${outTif}`,
      sidecarLine,
      `Format=FileType_TIFF`,
      `TiffOption=ColorType_RGB8`,
      `JpegQuality=100`,
      `ConvertWidth=${size}`,
      `ConvertHeight=${size}`,
      `ConvertTosRGB=1`,
      `UsePreview=0`,
      `ApplicationName=NX_Studio`,
      `DevelopColorMode=0`,
      `UpScaleRawSize=0`,
      `DynamicRange=0`,
      `HeifOption=0`,
      `IsUseRGBProfileInstead=0`,
      `TaskTypeSet=0`,
    ]
      .filter(Boolean)
      .join('\n') + '\n'

  fs.writeFileSync(hydPath, hyd)
  execFileSync(SAVE_PROCESS, ['TCJ', hydPath], { stdio: 'ignore' })
  return readTiffPixels(outTif)
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let sr = r / 255,
    sg = g / 255,
    sb = b / 255
  sr = sr <= 0.04045 ? sr / 12.92 : Math.pow((sr + 0.055) / 1.055, 2.4)
  sg = sg <= 0.04045 ? sg / 12.92 : Math.pow((sg + 0.055) / 1.055, 2.4)
  sb = sb <= 0.04045 ? sb / 12.92 : Math.pow((sb + 0.055) / 1.055, 2.4)
  const x = (sr * 0.4124 + sg * 0.3576 + sb * 0.1805) / 0.95047
  const y = (sr * 0.2126 + sg * 0.7152 + sb * 0.0722) / 1.0
  const z = (sr * 0.0193 + sg * 0.1192 + sb * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x),
    fy = f(y),
    fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function computeAccuracyMetrics(gtRgb: Uint8Array, predRgba: Uint8ClampedArray) {
  let absDiff = 0
  let sqDiff = 0
  let dESum = 0
  const nPixels = gtRgb.length / 3
  for (let i = 0, j = 0; i < gtRgb.length; i += 3, j += 4) {
    const dr = gtRgb[i] - predRgba[j]
    const dg = gtRgb[i + 1] - predRgba[j + 1]
    const db = gtRgb[i + 2] - predRgba[j + 2]
    absDiff += Math.abs(dr) + Math.abs(dg) + Math.abs(db)
    sqDiff += dr * dr + dg * dg + db * db
    const [l1, a1, b1] = rgbToLab(gtRgb[i], gtRgb[i + 1], gtRgb[i + 2])
    const [l2, a2, b2] = rgbToLab(predRgba[j], predRgba[j + 1], predRgba[j + 2])
    dESum += Math.hypot(l1 - l2, a1 - a2, b1 - b2)
  }
  const mae = absDiff / gtRgb.length
  const mse = sqDiff / gtRgb.length
  const psnr = mse > 0 ? 10 * Math.log10((255 * 255) / mse) : 99
  const deltaE = dESum / nPixels
  return { mae, psnr, deltaE }
}

function rgbToRgbaImageData(rgb: Uint8Array, width: number, height: number): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i]
    rgba[j + 1] = rgb[i + 1]
    rgba[j + 2] = rgb[i + 2]
    rgba[j + 3] = 255
  }
  return { data: rgba, width, height } as unknown as ImageData
}

if (import.meta.main) {
  const nefPath = process.argv[2] || DEFAULT_NEF
  const cacheDir =
    process.env.NX_CACHE_DIR ||
    '/Users/shouryan/.gemini/antigravity/brain/6c16762c-27da-4e0b-84b8-1815c821a3e6/scratch'
  fs.mkdirSync(cacheDir, { recursive: true })

  if (!fs.existsSync(nefPath)) {
    console.error(`NEF file not found at ${nefPath}`)
    process.exit(1)
  }

  const neutralNp3 = serialize({ name: 'NEUTRAL_FC' })
  const fc0 = renderNefViaSaveProcess(
    nefPath,
    cacheDir,
    'fc0',
    buildNkscWithNp3(neutralNp3, 0, 16),
    300
  )
  const baseImageData = rgbToRgbaImageData(fc0.data, fc0.width, fc0.height)

  const recipes = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dir, '../src/data/recipes.json'), 'utf8')
  )

  const benchmarkPaths = [
    'Nikon Creators/RedM_LUIZCLAS.NP3',
    'Nikon Creators/24Look_24Frames.NP3',
    'Color Grading/BleachBypass_01a.NP3',
    'Third Party Creators/Ross And His JPEGs/A-X+rossandhisjpegs.NP3',
    'Third Party Creators/Stephen Morais/AgU100.NP3',
    'Nikon Creators/AirGreen_Gunji.NP3',
    'Third Party Creators/Alex Armitage/ArmitageEktar100.NP3',
    'Third Party Creators/Alex Armitage/ArmitageKGold200.NP3',
    'Third Party Creators/Alex Armitage/ArmitageKPortra800.NP3',
    'Third Party Creators/Alex Armitage/ArmitageProvia100F.NP3',
  ]

  console.log('=== Nikon NX Studio Ground-Truth Verification (SaveProcess CLI on me.NEF) ===\n')
  console.log(
    '| Recipe | Category | MAE (0..255) | PSNR (dB) | CIE76 dE |'
  )
  console.log('|---|---|---:|---:|---:|')

  let maeSum = 0,
    psnrSum = 0,
    deSum = 0

  for (const relPath of benchmarkPaths) {
    const r = recipes.find((x: any) => x.path === relPath)
    if (!r) continue
    const np3Raw = fs.readFileSync(path.join(REPO_ROOT, r.path))
    const gt = renderNefViaSaveProcess(
      nefPath,
      cacheDir,
      `gt_${r.id}`,
      buildNkscWithNp3(np3Raw, 0, 16),
      300
    )

    const dst = rgbToRgbaImageData(new Uint8Array(fc0.data.length), fc0.width, fc0.height)
    applyPictureControl(baseImageData, dst, r.settings as PictureControlSettings)
    const m = computeAccuracyMetrics(gt.data, dst.data)

    maeSum += m.mae
    psnrSum += m.psnr
    deSum += m.deltaE

    console.log(
      `| ${r.name} | ${r.category} | ${m.mae.toFixed(2)} | ${m.psnr.toFixed(2)} dB | ${m.deltaE.toFixed(2)} |`
    )
  }

  const N = benchmarkPaths.length
  console.log(
    `| **Average (${N} Recipes)** | — | **${(maeSum / N).toFixed(2)}** | **${(psnrSum / N).toFixed(2)} dB** | **${(deSum / N).toFixed(2)}** |`
  )
}
