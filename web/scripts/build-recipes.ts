import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { deserialize } from 'nikon-flexible-color-picture-control'

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'web' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(np3)$/i.test(n)) out.push(p)
  }
  return out
}

// Load thumbnails from Preview All Recipes.md if available
const thumbs = new Map<string, string>()
try {
  const content = readFileSync('../Preview All Recipes.md', 'utf-8')
  const norm = (s: string) => s.toLowerCase().replace(/\bby\b/g, '').replace(/[^a-z0-9]/g, '')
  for (const m of content.matchAll(/!\[(.*?)\]\((.*?)\)\s*\n+\s*###\s+(.*?)\n/g)) {
    thumbs.set(norm(m[3]), m[2])
    thumbs.set(norm(m[1]), m[2])
  }
} catch {
  // ok if not found
}

const norm = (s: string) => s.toLowerCase().replace(/\bby\b/g, '').replace(/[^a-z0-9]/g, '')

const files = walk('..')
const recipes = []

for (const p of files) {
  const cleanPath = p.replace(/^\.\.\//, '')
  const buf = readFileSync(p)
  try {
    const data = deserialize(buf)
    // Detect Nikon Monochrome base Picture Control IDs (0x0655 Deep Tone Mono, 0x064d Mono)
    if (buf[52] === 0x06) {
      data.saturation = -100
    }
    const parts = cleanPath.split('/')
    const category = parts[0]
    let creator = 'Nikon'
    
    if (category === 'Third Party Creators') {
      creator = parts[1] || 'Third Party'
    } else if (category === 'Nikon Creators') {
      const match = data.name.match(/_(.+)$/) || cleanPath.match(/_([^_]+)\.NP3$/i)
      creator = match ? match[1] : 'Nikon Creator'
    } else if (category === 'Color Grading') {
      creator = 'Nikon Color Grading'
    }

    const baseName = cleanPath.split('/').pop()?.replace(/\.NP3$/i, '') || data.name
    const cleanName = data.name || baseName

    const normKey = norm(baseName)
    let thumbnail = thumbs.get(normKey)
    if (!thumbnail) {
      for (const [k, url] of thumbs.entries()) {
        if (k.length > 4 && (normKey.includes(k) || k.includes(normKey))) {
          thumbnail = url
          break
        }
      }
    }

    recipes.push({
      id: cleanPath.replace(/[^a-zA-Z0-9_-]/g, '_'),
      name: cleanName,
      category,
      creator,
      path: cleanPath,
      thumbnail: thumbnail || null,
      settings: data
    })
  } catch (err) {
    console.error(`Error decoding ${p}:`, err)
  }
}

// Sort alphabetically by name
recipes.sort((a, b) => a.name.localeCompare(b.name))

mkdirSync('src/data', { recursive: true })
writeFileSync('src/data/recipes.json', JSON.stringify(recipes, null, 2))
console.log(`Generated src/data/recipes.json with ${recipes.length} recipes.`)
