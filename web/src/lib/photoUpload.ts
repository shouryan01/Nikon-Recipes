// Helpers for the "upload your photo" flow.
//
// Browsers can only preview formats they can decode in an <img> (JPEG, PNG,
// WebP, ...). Photographers often try RAW (.NEF) or HEIC files instead, which
// used to fail silently: the drop handler ignored type-less files and a
// failed <img> load had no error path. These helpers classify files by MIME
// type *and* extension (RAW files frequently arrive with an empty MIME type)
// so every entry point can either accept the photo or explain why it can't
// be previewed. RAW files (.NEF, .DNG, …) are supported through the JPEG
// preview embedded in every RAW file — see ./rawPreview.

import { extractEmbeddedJpeg } from './rawPreview'

export interface PhotoFileLike {
  name: string
  type: string
}

export interface PhotoRejection {
  title: string
  message: string
}

export type PreparedPhoto = { url: string } | { rejection: PhotoRejection }

const DECODABLE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'svg',
  'ico',
  'jfif',
  'pjp',
  'pjpeg',
  'tif',
  'tiff',
])

const HEIC_EXTENSIONS = new Set(['heic', 'heif', 'hif'])

const RAW_EXTENSIONS = new Set([
  'nef',
  'nrw',
  'arw',
  'cr2',
  'cr3',
  'dng',
  'raf',
  'rw2',
  'orf',
  'pef',
  'srw',
  'rwl',
  'iiq',
  '3fr',
  'ari',
  'kdc',
  'dcr',
  'mrw',
  'x3f',
])

export function getFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export function isRawPhotoFile(file: PhotoFileLike): boolean {
  return RAW_EXTENSIONS.has(getFileExtension(file.name))
}

export function isHeicPhotoFile(file: PhotoFileLike): boolean {
  if (file.type === 'image/heic' || file.type === 'image/heif') return true
  return HEIC_EXTENSIONS.has(getFileExtension(file.name))
}

export function isRecipeFile(file: PhotoFileLike): boolean {
  const ext = getFileExtension(file.name)
  return ext === 'np3' || ext === 'ncp'
}

// True when the file is plausibly a photo, even if the browser reports no
// MIME type (common for RAW files) or an undecodable one (HEIC on Chrome).
export function isProbablyPhotoFile(file: PhotoFileLike): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = getFileExtension(file.name)
  return DECODABLE_EXTENSIONS.has(ext) || HEIC_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext)
}

function rejectionForUndecodable(file: PhotoFileLike): PhotoRejection {
  if (isRawPhotoFile(file)) {
    return {
      title: 'No preview inside this RAW file',
      message: `Couldn't find an embedded JPEG preview in "${file.name}". Export a JPEG or TIFF from NX Studio and upload that instead.`,
    }
  }
  if (isHeicPhotoFile(file)) {
    return {
      title: 'HEIC is not supported here',
      message: 'This browser cannot decode HEIC photos. Re-export it as JPEG (or screenshot it) and upload that instead.',
    }
  }
  return {
    title: 'Could not read that photo',
    message: `"${file.name}" could not be decoded. Try a JPEG, PNG, WebP, or TIFF export.`,
  }
}

// Embedded previews come out of the camera with a consumer JPEG look baked
// in (Standard picture control: extra contrast and saturation). NX Studio
// develops the RAW itself and starts from a flatter neutral render, so
// grading the raw preview overshoots. Measured on two Z50 II bodies' NEFs
// (preview vs NX neutral render): preview ≈ neutral / [0.914, 0.900, 0.875]
// per channel, consistent across both shots (cross-fit halves the base gap
// on each). This gain undoes the bulk of that baked-in look for NEF uploads
// only; user-supplied JPEGs are already developed and pass through untouched.
const NEF_PREVIEW_NORMALIZE_GAIN = [0.914, 0.9, 0.875] as const

// Normalize a NEF's embedded preview toward NX Studio's neutral starting
// point. Falls back to the unnormalized preview if anything fails — an
// upload must never break because of this step.
async function normalizeRawPreview(jpeg: Uint8Array): Promise<Blob> {
  const srcBlob = new Blob([jpeg as BlobPart], { type: 'image/jpeg' })
  try {
    const bitmap = await createImageBitmap(srcBlob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return srcBlob
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] * NEF_PREVIEW_NORMALIZE_GAIN[0]
      d[i + 1] = d[i + 1] * NEF_PREVIEW_NORMALIZE_GAIN[1]
      d[i + 2] = d[i + 2] * NEF_PREVIEW_NORMALIZE_GAIN[2]
    }
    ctx.putImageData(img, 0, 0)
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95)
    )
    return out ?? srcBlob
  } catch {
    return srcBlob
  }
}

// Small working copy for server uploads: decoded (RAW via embedded preview)
// and shrunk to maxDim on the long edge as JPEG. Keeps uploads fast and API
// payloads tiny. Note the server only ever sees this copy — Picks moves of
// uploaded shoots contain working copies, not full-res originals.
export type ShrunkenPhoto = { blob: Blob; name: string } | { rejection: PhotoRejection }

export async function shrinkPhotoForUpload(file: File, maxDim = 768, quality = 0.75): Promise<ShrunkenPhoto> {
  if (!isProbablyPhotoFile(file)) {
    return {
      rejection: {
        title: 'That is not a photo',
        message: `"${file.name}" doesn't look like an image file. Drop a JPEG, PNG, WebP, TIFF, or RAW file.`,
      },
    }
  }
  let blob: Blob = file
  if (isRawPhotoFile(file)) {
    const preview = extractEmbeddedJpeg(new Uint8Array(await file.arrayBuffer()))
    if (!preview) return { rejection: rejectionForUndecodable(file) }
    blob = await normalizeRawPreview(preview)
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return { rejection: rejectionForUndecodable(file) }
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    const small = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    )
    if (!small) return { rejection: rejectionForUndecodable(file) }
    const base = file.name.replace(/\.[^.]+$/, '')
    return { blob: small, name: `${base}.jpg` }
  } finally {
    bitmap.close()
  }
}

// Entry point for all photo uploads (button, drop, paste). RAW files are
// decoded via their embedded JPEG preview (normalized toward NX Studio's
// neutral starting point, see above); everything else must decode directly.
// Resolves with an object URL ready to preview, or the reason to show when
// the file can't be used.
export async function preparePhotoFile(file: File): Promise<PreparedPhoto> {
  if (!isProbablyPhotoFile(file)) {
    return {
      rejection: {
        title: 'That is not a photo',
        message: `"${file.name}" doesn't look like an image file. Drop a JPEG, PNG, WebP, TIFF, or RAW file — or an .NP3 recipe.`,
      },
    }
  }
  let blob: Blob = file
  if (isRawPhotoFile(file)) {
    const preview = extractEmbeddedJpeg(new Uint8Array(await file.arrayBuffer()))
    if (!preview) return { rejection: rejectionForUndecodable(file) }
    blob = await normalizeRawPreview(preview)
  }
  const rejection = await decodeRejection(blob, file)
  if (rejection) return { rejection }
  return { url: URL.createObjectURL(blob) }
}

async function decodeRejection(blob: Blob, file: PhotoFileLike): Promise<PhotoRejection | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      bitmap.close()
    } catch {
      return rejectionForUndecodable(file)
    }
  } else if (isRawPhotoFile(file) || isHeicPhotoFile(file)) {
    // No decode API available (older browser): still catch the known-bad
    // formats instead of letting them fail silently downstream.
    return rejectionForUndecodable(file)
  }
  return null
}

