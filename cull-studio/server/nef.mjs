// NEF embedded-JPEG preview extraction. Byte-range copy only: no decoding,
// no image processing, no local ML. Ported from the proven extractor in
// web/src/lib/rawPreview.ts (largest TIFF/SubIFD JPEG candidate wins).
const TAG_SUB_IFDS = 0x014a;
const TAG_JPEG_OFFSET = 0x0201;
const TAG_JPEG_LENGTH = 0x0202;
const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function getU16(r, o) { return r.view.getUint16(o, r.littleEndian); }
function getU32(r, o) { return r.view.getUint32(o, r.littleEndian); }

function entryValues(r, entryOffset) {
  const type = getU16(r, entryOffset + 2);
  const count = getU32(r, entryOffset + 4);
  const unit = TYPE_SIZES[type];
  if (!unit || count === 0) return [];
  const total = unit * count;
  let base = entryOffset + 8;
  if (total > 4) base = getU32(r, entryOffset + 8);
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = base + i * unit;
    if (o + unit > r.data.length) break;
    if (unit === 1) out.push(r.data[o]);
    else if (unit === 2) out.push(getU16(r, o));
    else if (unit === 4) out.push(getU32(r, o));
    else break;
  }
  return out;
}

function collectFromIfd(r, ifdOffset, out, depth) {
  if (depth > 8 || ifdOffset + 2 > r.data.length) return;
  const count = getU16(r, ifdOffset);
  if (count > 512) return;
  let jpegOffset = [], jpegLength = [];
  const subIfds = [];
  for (let i = 0; i < count; i++) {
    const e = ifdOffset + 2 + i * 12;
    if (e + 12 > r.data.length) break;
    const tag = getU16(r, e);
    if (tag === TAG_JPEG_OFFSET) jpegOffset = entryValues(r, e);
    else if (tag === TAG_JPEG_LENGTH) jpegLength = entryValues(r, e);
    else if (tag === TAG_SUB_IFDS) subIfds.push(...entryValues(r, e));
  }
  const n = Math.min(jpegOffset.length, jpegLength.length);
  for (let i = 0; i < n; i++) out.push({ offset: jpegOffset[i], length: jpegLength[i] });
  for (const sub of subIfds) if (sub > 0 && sub < r.data.length) collectFromIfd(r, sub, out, depth + 1);
  const next = ifdOffset + 2 + count * 12;
  if (next + 4 <= r.data.length) {
    const nextIfd = getU32(r, next);
    if (nextIfd > 0 && nextIfd < r.data.length && nextIfd !== ifdOffset) collectFromIfd(r, nextIfd, out, depth + 1);
  }
}

function sliceIfJpeg(data, offset, length) {
  if (offset < 0 || length <= 0 || offset + length > data.length) return null;
  if (data[offset] !== 0xff || data[offset + 1] !== 0xd8) return null;
  for (let i = offset + length - 2; i >= offset + 2; i--) {
    if (data[i] === 0xff && data[i + 1] === 0xd9) return data.slice(offset, i + 2);
  }
  return null;
}

function scanForLargestJpeg(data) {
  let best = null, i = 0;
  while (i < data.length - 1) {
    if (data[i] === 0xff && data[i + 1] === 0xd8) {
      let end = -1;
      for (let j = i + 2; j < data.length - 1; j++) if (data[j] === 0xff && data[j + 1] === 0xd9) end = j + 2;
      if (end > i) {
        const seg = data.slice(i, end);
        if (!best || seg.length > best.length) best = seg;
        i = end; continue;
      }
      break;
    }
    i++;
  }
  return best;
}

export function extractEmbeddedJpeg(data) {
  if (!data || data.length < 8) return null;
  const little = data[0] === 0x49 && data[1] === 0x49;
  const big = data[0] === 0x4d && data[1] === 0x4d;
  if (!little && !big) return scanForLargestJpeg(data);
  const r = { data, view: new DataView(data.buffer, data.byteOffset, data.byteLength), littleEndian: little };
  if (getU16(r, 2) !== 42) return scanForLargestJpeg(data);
  const firstIfd = getU32(r, 4);
  if (firstIfd <= 0 || firstIfd >= data.length) return scanForLargestJpeg(data);
  const candidates = [];
  collectFromIfd(r, firstIfd, candidates, 0);
  let best = null;
  for (const c of candidates) {
    const jpeg = sliceIfJpeg(data, c.offset, c.length);
    if (jpeg && (!best || jpeg.length > best.length)) best = jpeg;
  }
  return best ?? scanForLargestJpeg(data);
}
