// Driver for Nikon's NX Studio batch pipeline (SaveProcess CLI).
//
// Lets any app develop a .NEF with a Flexible Color recipe applied and read
// back bit-correct NX Studio output — the same output NX Studio itself
// produces, verified pixel-for-pixel against interactive NX Studio renders.
//
// Personal-use note: this shells out to the user's own NX Studio install.
// It does not copy, bundle, or redistribute any Nikon software.
//
// Requirements:
//   - macOS with NX Studio installed (tested with 1.10.1).
//   - Bun or Node 18+ (uses only node:fs, node:path, node:child_process).
//
// Usage:
//   import { renderNef } from './nxPipeline'
//   const tif = renderNef({
//     nefPath: '/path/to/DSC_0105.NEF',
//     np3: fs.readFileSync('HazyMemories_Julia.NP3'), // null = NX defaults
//     workDir: '/tmp/nxrender',
//     maxDimension: 1200,
//     format: 'jpeg',
//   })
//   // tif.data = RGB bytes, tif.width/tif.height = dimensions
//
// Performance (20MP NEF, 1200px output): ~2s per render. Batch/export only —
// far too slow for interactive slider previews; keep a fast approximation
// for live UI and call this for the final correct pixels.
//
// Reliability notes (all observed, not documented — Nikon may change these):
//   - The .hyd job file needs the FULL field set below; a minimal subset
//     silently produces no output. Unknown which fields are load-bearing.
//   - Do not trust the process exit code; verify the output file exists.
//   - Pin and log the NX Studio version; re-verify after any NX update.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

export interface NxRenderOptions {
  nefPath: string
  /** Raw .NP3/.NCP file bytes, or null for NX Studio defaults. */
  np3: Buffer | Uint8Array | null
  /** Scratch directory for job/sidecar/output files (created if missing). */
  workDir: string
  /** Output long edge in pixels. NX preserves aspect ratio. */
  maxDimension?: number
  /** Output encoding. JPEG is smaller; TIFF is lossless. */
  format?: 'jpeg' | 'tiff'
  /** JPEG quality when format is 'jpeg'. */
  jpegQuality?: number
  /** Cache key: when set and the output already exists, SaveProcess is skipped. */
  cacheName?: string
}

export interface NxPixels {
  width: number
  height: number
  /** Tightly packed RGB bytes (3 per pixel). */
  data: Uint8Array
}

const DEFAULT_NX_PATHS = [
  '/Applications/Nikon Software/NX Studio/NX Studio.app/Contents/MacOS/SaveProcess',
]

/** Locate the SaveProcess CLI. Honors NX_SAVE_PROCESS, then default paths. */
export function findSaveProcess(): string {
  const env = process.env.NX_SAVE_PROCESS
  if (env && fs.existsSync(env)) return env
  for (const p of DEFAULT_NX_PATHS) {
    if (fs.existsSync(p)) return p
  }
  throw new Error(
    'NX Studio SaveProcess not found. Install NX Studio or set NX_SAVE_PROCESS.'
  )
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#xA;')
}

/**
 * Wrap raw .NP3 bytes in the .nksc sidecar format SaveProcess expects.
 * savedPicConProcess / picControlId 0/16 select the first Flexible Color slot;
 * these are the values NX Studio itself writes for recipe-override renders.
 */
export function buildNkscWithNp3(
  np3Buf: Buffer | Uint8Array,
  savedPicConProcess: number | null = 0,
  picControlId = 16
): string {
  const b64Raw = Buffer.from(np3Buf).toString('base64')
  const lines: string[] = []
  for (let i = 0; i < b64Raw.length; i += 60) {
    lines.push(b64Raw.slice(i, i + 60))
  }
  const b64WithNewlines = lines.join('\n') + '\n'
  const exportSize = b64Raw.length + lines.length
  const savedProcTag =
    savedPicConProcess !== null
      ? `<SavedPicConProcess>${savedPicConProcess}</SavedPicConProcess>`
      : ''

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

function readTiffPixels(tifPath: string): NxPixels {
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

/**
 * Develop a NEF through NX Studio and return its pixels. Output renders are
 * sRGB, aspect-preserving, with the long edge at maxDimension.
 *
 * Throws when SaveProcess is missing or produces no output file.
 */
export function renderNef(opts: NxRenderOptions): NxPixels {
  const {
    nefPath,
    np3,
    workDir,
    maxDimension = 1200,
    format = 'tiff',
    jpegQuality = 95,
    cacheName = null,
  } = opts

  if (!fs.existsSync(nefPath)) throw new Error(`NEF not found: ${nefPath}`)
  fs.mkdirSync(workDir, { recursive: true })

  const saveProcess = findSaveProcess()
  const tag = cacheName ?? `nx_${Date.now()}`
  const outFile = path.join(
    workDir,
    format === 'jpeg' ? `render_${tag}.jpg` : `render_${tag}.tif`
  )

  if (cacheName && fs.existsSync(outFile)) {
    if (format === 'tiff') return readTiffPixels(outFile)
    throw new Error('cache hits are only supported for tiff output (pixel reads)')
  }

  let sidecarLine = ''
  if (np3 !== null) {
    const nkscPath = path.join(workDir, `sc_${tag}.nksc`)
    fs.writeFileSync(nkscPath, buildNkscWithNp3(np3, 0, 16))
    sidecarLine = `SidecarFile=${nkscPath}`
  }

  // NOTE: keep the full field set. A reduced subset was observed to silently
  // produce no output (SaveProcess gives no useful error).
  const hyd =
    [
      `InputFile=${nefPath}`,
      `OutputFile=${outFile}`,
      sidecarLine,
      format === 'jpeg' ? `Format=FileType_JPEG` : `Format=FileType_TIFF`,
      `TiffOption=ColorType_RGB8`,
      `JpegQuality=${jpegQuality}`,
      `ConvertWidth=${maxDimension}`,
      `ConvertHeight=${maxDimension}`,
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

  const hydPath = path.join(workDir, `job_${tag}.hyd`)
  fs.writeFileSync(hydPath, hyd)
  execFileSync(saveProcess, ['TCJ', hydPath], { stdio: 'ignore' })

  if (!fs.existsSync(outFile)) {
    throw new Error(
      `SaveProcess produced no output for ${nefPath} (job: ${hydPath}). ` +
        `NX Studio updates can break this undocumented interface — check the NX version.`
    )
  }
  if (format === 'jpeg') {
    // JPEG pixels are left on disk; decode with the app's own image loader.
    return { width: 0, height: 0, data: new Uint8Array(0) }
  }
  return readTiffPixels(outFile)
}
