// Dev helper for decoding the NP3 format: lists the records in each file.
// usage: bun scripts/dump.ts <file...>            dump records of the given files
//        bun scripts/dump.ts --survey <root>      per-record-id value histogram over all files under root
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

type Rec = { id: number; data: Uint8Array }

function records(buf: Uint8Array): { magic: string; recs: Rec[]; tail: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const magic = String.fromCharCode(...buf.slice(0, 3))
  const recs: Rec[] = []
  let o = 4
  while (o + 8 <= buf.length) {
    const tag = dv.getUint32(o)
    const len = dv.getUint32(o + 4)
    if (tag === 0 || o + 8 + len > buf.length) break
    recs.push({ id: tag >>> 8, data: buf.slice(o + 8, o + 8 + len) })
    o += 8 + len
  }
  return { magic, recs, tail: buf.length - o }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'web' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(np3|ncp)$/i.test(n)) out.push(p)
  }
  return out
}

const hex = (d: Uint8Array) => [...d].map((b) => b.toString(16).padStart(2, '0')).join(' ')
const args = process.argv.slice(2)

if (args[0] === '--survey') {
  const files = walk(args[1])
  const hist = new Map<number, Map<string, number>>()
  const sizes = new Map<number, Set<number>>()
  let bad = 0
  for (const f of files) {
    const { magic, recs, tail } = records(new Uint8Array(readFileSync(f)))
    if (magic !== 'NCP' || tail !== 4) {
      bad++
      console.log('odd file', f, magic, 'tail', tail)
    }
    for (const r of recs) {
      const h = hist.get(r.id) ?? new Map()
      const k = hex(r.data.length > 4 ? r.data.slice(0, 4) : r.data)
      h.set(k, (h.get(k) ?? 0) + 1)
      hist.set(r.id, h)
      const s = sizes.get(r.id) ?? new Set()
      s.add(r.data.length)
      sizes.set(r.id, s)
    }
  }
  console.log(`${files.length} files, ${bad} odd`)
  for (const id of [...hist.keys()].sort((a, b) => a - b)) {
    const h = hist.get(id)!
    const top = [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    console.log(`id ${id} len=${[...sizes.get(id)!].join('/')} distinct=${h.size}  ` + top.map(([k, n]) => `${k}×${n}`).join(' | '))
  }
} else {
  for (const f of args) {
    const { recs, tail } = records(new Uint8Array(readFileSync(f)))
    console.log(`== ${f} (tail ${tail})`)
    for (const r of recs) console.log(String(r.id).padStart(3), `[${r.data.length}]`, hex(r.data))
  }
}
