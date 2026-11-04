// Cull Studio local service. File handling + UI only: folder import, NEF
// preview extraction, picks moves. ALL intelligence comes from src/meta
// adapters — currently deterministic mocks, with NO network calls.
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractEmbeddedJpeg } from "./nef.mjs";
import { planPicks, executePicks, undoPicks } from "./picks.mjs";
import { mockSegment, mockFastScore, mockDeepScore, mockRescuePreview, seedFrom } from "../src/meta/mockAdapters.mjs";
import { parseVoiceCommand } from "../src/meta/voiceGrammar.mjs";
import { totalScore, groupBursts, distillTaste } from "../src/scoring.mjs";
import { isApiEnabled, MODELS } from "../src/meta/models.mjs";
import { loadEnv } from "./env.mjs";
import { sparkAnalyse, samSegment, sparkChat, distillTasteLive, imageCleanup } from "../src/meta/realAdapters.mjs";
import { transcribeAudio } from "../src/meta/client.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "..", "public");
const DATA = path.join(ROOT, "..", "data");
const CACHE = path.join(DATA, "previews");
const PORT = Number(process.env.PORT || 4173);
await loadEnv(path.join(ROOT, "..", ".env"));
const sessions = new Map();
const manifests = new Map();

// --- Cost diagnostics (estimated) ---
// Per-live-call estimates, overridable via env. Mock calls cost $0.
// These are placeholders until real price-book values are set.
const RATES = {
  [MODELS.vision]: Number(process.env.COST_SPARK_CALL || 0.02),
  [MODELS.segmentation]: Number(process.env.COST_SAM_CALL || 0.01),
  [MODELS.voice]: Number(process.env.COST_VOICE_CALL || 0.005),
  [MODELS.image]: Number(process.env.COST_IMAGE_CALL || 0.02),
};
const globalCost = { calls: {}, estimatedUsd: 0 };
const COST_FILE = path.join(DATA, "cost.json");
try {
  const saved = JSON.parse(await fs.readFile(COST_FILE, "utf8"));
  if (saved && typeof saved.estimatedUsd === "number") {
    globalCost.calls = saved.calls || {};
    globalCost.estimatedUsd = saved.estimatedUsd;
  }
} catch { /* first run: start at zero */ }
async function saveCost() {
  try { await fs.mkdir(DATA, { recursive: true }); await fs.writeFile(COST_FILE, JSON.stringify(globalCost)); } catch { /* diagnostics must never break requests */ }
}
function recordCost(sessionId, model, kind) {
  const rate = RATES[model] || 0;
  globalCost.calls[model] = (globalCost.calls[model] || 0) + 1;
  globalCost.estimatedUsd = Math.round((globalCost.estimatedUsd + rate) * 10000) / 10000;
  void saveCost();
  let sessionTotal = null;
  const s = sessionId && sessions.get(sessionId);
  if (s) {
    s.cost = s.cost || { calls: {}, estimatedUsd: 0 };
    s.cost.calls[model] = (s.cost.calls[model] || 0) + 1;
    s.cost.estimatedUsd = Math.round((s.cost.estimatedUsd + rate) * 10000) / 10000;
    sessionTotal = s.cost.estimatedUsd;
  }
  console.log(`[cost] session=${sessionId || "global"} model=${model} kind=${kind} sessionTotal=${sessionTotal === null ? "n/a" : "$" + sessionTotal.toFixed(4)} globalTotal=$${globalCost.estimatedUsd.toFixed(4)} (estimated)`);
}
function costReport(sessionId) {
  const s = sessionId && sessions.get(sessionId);
  return {
    ok: true, estimated: true, note: "Placeholder per-call rates; set COST_*_CALL env vars for real prices. Mocks cost $0.",
    rates: RATES,
    session: s ? { id: s.id, calls: (s.cost && s.cost.calls) || {}, estimatedUsd: (s.cost && s.cost.estimatedUsd) || 0 } : null,
    total: { calls: globalCost.calls, estimatedUsd: globalCost.estimatedUsd },
  };
}

// Pull a {"patch":{...},"message":"..."} tool call out of a chat reply.
// Returns null unless at least one allowed key survives clamping.
function extractPatch(text, keyRanges) {
  if (!text || !keyRanges) return null;
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!parsed || typeof parsed.patch !== "object" || !parsed.patch) return null;
  const patch = {};
  for (const [k, v] of Object.entries(parsed.patch)) {
    const range = keyRanges[k];
    if (!range || typeof v !== "number" || !Number.isFinite(v)) continue;
    patch[k] = Math.max(range[0], Math.min(range[1], Math.round(v * 100) / 100));
  }
  if (!Object.keys(patch).length) return null;
  return { patch, message: `Tool call: ${Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(", ")}` };
}

// Shrink a preview for the vision API (max 1568px long edge, JPEG).
// Full-size previews stay cached for the UI; only the API copy is small.
async function downscaleForApi(buf, maxDim = 1568) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-"));
  try {
    await fs.writeFile(path.join(dir, "in"), buf);
    const out = path.join(dir, "small.jpg");
    await new Promise((resolve, reject) => {
      execFile("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(dir, "in"), "-vf", `scale='min(${maxDim},iw)':-2`, "-q:v", "4", out],
        (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message || err).slice(0, 200))) : resolve(stdout));
    });
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Human-readable spend page for GET /cost (JSON stays on /api/cost).
function costPage(report) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Number(n || 0).toFixed(4);
  const modRows = Object.keys(report.rates).map((m) => {
    const calls = (report.total.calls && report.total.calls[m]) || 0;
    return `<tr><td>${esc(m)}</td><td>${calls}</td><td>${money(calls * report.rates[m])}</td></tr>`;
  }).join("");
  const sess = report.session
    ? `<section class="card"><h2>Session ${esc(report.session.id)}</h2>
       <p class="total">${money(report.session.estimatedUsd)}</p>
       <p class="muted">${Object.entries(report.session.calls).map(([m, c]) => `${esc(m)} × ${c}`).join(" · ") || "no calls yet"}</p></section>`
    : ``;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Cull Studio · API spend</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:32px}
  main{max-width:640px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:14px;margin:0 0 8px}
  .card{background:#171717;border:1px solid #2a2a2a;border-radius:12px;padding:20px;margin:16px 0}
  .total{font-size:34px;font-weight:700;color:#FFE100;margin:4px 0}
  .muted{color:#8a8a8a;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:#8a8a8a;font-weight:500;padding:6px 8px;border-bottom:1px solid #2a2a2a}
  td{padding:6px 8px;border-bottom:1px solid #1f1f1f;font-variant-numeric:tabular-nums}
  a{color:#FFE100}
</style></head><body><main>
<h1>API spend</h1>
<p class="muted">Cumulative across restarts · placeholder rates until real prices are set (<code>COST_*_CALL</code>) · mock calls cost $0 · auto-refreshes every 30s</p>
<section class="card"><h2>All time</h2><p class="total">${money(report.total.estimatedUsd)}</p></section>
${sess}
<section class="card"><h2>By model</h2>
<table><tr><th>Model</th><th>Calls</th><th>Est. cost</th></tr>${modRows}</table></section>
<p class="muted"><a href="/api/cost">Raw JSON</a> · per-session: <code>/cost?sessionId=&lt;id&gt;</code></p>
</main></body></html>`;
}

// Convert an uploaded clip to mono s16 WAV @16kHz for the transcribe API.
async function toWav16k(buf) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-"));
  try {
    await fs.writeFile(path.join(dir, "in"), buf);
    await new Promise((resolve, reject) => {
      execFile("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(dir, "in"), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", path.join(dir, "out.wav")],
        (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message).slice(0, 200))) : resolve(stdout));
    });
    return await fs.readFile(path.join(dir, "out.wav"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(b); };
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }

function analyse(frame) {
  frame.fast = mockFastScore(frame);
  frame.seg = mockSegment(frame);
  frame.deep = mockDeepScore(frame, frame.seg);
  frame.total = totalScore(frame.deep.scores);
  frame.rescue = frame.deep.flags.some((f) => f.includes("distraction")) ? mockRescuePreview(frame) : null;
  frame.status = "analysed";
  return frame;
}
const pub = (f) => ({ id: f.id, name: f.name, total: f.total, status: f.status, decision: f.decision || null, group: f.group || null, groupSize: f.groupSize || 1, fast: f.fast, deep: f.deep, seg: f.seg, rescue: f.rescue, rescueUrl: f.rescueFile ? `/rescue/${f.id.split("-").slice(0, -1).join("-") || f.id}/${path.basename(f.rescueFile)}` : null, previewUrl: f.previewUrl, note: f.note || "", apiError: f.apiError || null });

const PHOTO_RE = /\.(nef|jpe?g|png)$/i;
async function addFrame(session, dir, name, sourcePath, buf) {
  const isNef = /\.nef$/i.test(name);
  const preview = isNef ? extractEmbeddedJpeg(new Uint8Array(buf)) : buf;
  const frame = { id: `${session.id}-${session.frames.length}`, name, sourcePath, bytes: buf.length, status: preview ? "imported" : "no-preview", decision: null };
  if (preview) {
    const ext = isNef ? ".jpg" : path.extname(name).toLowerCase().replace(".jpeg", ".jpg");
    const p = path.join(dir, name.replace(/\.[^.]+$/, "") + ext);
    await fs.writeFile(p, preview);
    frame.previewFile = p; frame.previewUrl = `/preview/${session.id}/${path.basename(p)}`;
  }
  session.frames.push(frame);
  return frame;
}
function runAnalysis(session) {
  if (session.analysing) return;
  session.analysing = isApiEnabled();
  if (isApiEnabled()) analyzeSession(session);
  else { session.frames.forEach(analyse); sortFrames(session); }
}
function finishImport(session, defer = false) {
  groupBursts(session.frames);
  if (defer) { session.analysing = false; return; }
  runAnalysis(session);
}
async function importFolder(folder) {
  const stat = await fs.stat(folder);
  const id = "s" + Date.now().toString(36);
  const dir = path.join(CACHE, id); await fs.mkdir(dir, { recursive: true });
  const session = { id, folder, frames: [], events: [], createdAt: new Date().toISOString(), analysing: false };
  sessions.set(id, session);
  if (stat.isFile()) {
    if (!PHOTO_RE.test(folder)) throw new Error("Unsupported file — use .NEF, .JPG, .JPEG or .PNG");
    await addFrame(session, dir, path.basename(folder), folder, await fs.readFile(folder));
  } else {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const photos = entries.filter((e) => e.isFile() && PHOTO_RE.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    if (!photos.length) throw new Error(`No photos (.NEF/.JPG/.JPEG/.PNG) found in ${folder}`);
    for (const e of photos) await addFrame(session, dir, e.name, path.join(folder, e.name), await fs.readFile(path.join(folder, e.name)));
  }
  finishImport(session);
  return session;
}
const pendingUploads = new Map();
function sortFrames(session) { session.frames.sort((a, b) => (b.total || 0) - (a.total || 0)); session.frames.forEach((f, i) => (f.rank = i + 1)); }
async function analyzeSession(session) {
  const queue = session.frames.filter((f) => f.previewFile);
  async function worker() {
    let f;
    while ((f = queue.shift())) {
      f.status = "analysing";
      try {
        const raw = await fs.readFile(f.previewFile);
        const small = await downscaleForApi(raw);
        const dataUrl = `data:image/jpeg;base64,${small.toString("base64")}`;
        const deep = await sparkAnalyse(dataUrl, session.tasteText || "");
        recordCost(session.id, MODELS.vision, "spark-deep");
        let seg = { model: MODELS.segmentation, mock: false, subject: null, horizonTiltDeg: 0, distractions: [] };
        if (deep.subjectPhrase) {
          const sam = await samSegment(dataUrl, deep.subjectPhrase);
          recordCost(session.id, MODELS.segmentation, "sam-segment");
          if (sam.boxes[0]) seg.subject = { label: deep.subjectPhrase, box: sam.boxes[0], maskRef: "sam-3.1 live" };
        }
        f.deep = deep; f.seg = seg; f.total = totalScore(deep.scores); f.status = "analysed";
      } catch (e) {
        analyse(f); f.apiError = String(e.message || e).slice(0, 240); f.status = "analysed (mock fallback)";
      }
      sortFrames(session);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  session.analysing = false;
}

function demoSession() {
  const id = "demo"; const frames = [];
  const subjects = ["main subject", "water / shoreline", "street scene", "still life arrangement"];
  for (let i = 0; i < 24; i++) {
    const rnd = seedFrom("demo-" + i);
    frames.push({ id: `demo-${i}`, name: `DSC_${String(4200 + i)}.NEF`, sourcePath: null, demo: true, subjectHint: subjects[Math.floor(rnd() * subjects.length)], groupId: i < 6 ? "burst-lake" : i < 10 ? "burst-street" : undefined, status: "imported", decision: null, previewUrl: `/demo-preview/${i}.svg` });
  }
  groupBursts(frames); frames.forEach(analyse); frames.sort((a, b) => b.total - a.total); frames.forEach((f, i) => (f.rank = i + 1));
  const session = { id, folder: "(demo fixtures — no real files)", frames, events: [], demo: true, createdAt: new Date().toISOString() };
  sessions.set(id, session);
  return session;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization" });
      return res.end();
    }
    if (p === "/api/health") return json(res, 200, { ok: true, apiEnabled: isApiEnabled(), keyPresent: Boolean(process.env.MODEL_API_KEY), models: MODELS, note: isApiEnabled() ? "LIVE Meta Model API" : "Mock mode (no key or CULL_MOCK=1)" });
    if (p === "/api/cost" && req.method === "GET") return json(res, 200, costReport(url.searchParams.get("sessionId")));
    if (p === "/cost" && req.method === "GET") {
      const report = costReport(url.searchParams.get("sessionId"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(costPage(report));
    }
    if (p.startsWith("/api/session/") && req.method === "GET") { const s = sessions.get(p.split("/")[3]); if (!s) return json(res, 404, { error: "session not found" }); return json(res, 200, { analysing: Boolean(s.analysing), frames: s.frames.map(pub) }); }
    if (p === "/api/voice/audio" && req.method === "POST") {
      const chunks = []; for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      // The API only accepts mono s16 WAV (16/24 kHz); convert uploads first.
      let wav = raw, wavName = "command.wav";
      try {
        wav = await toWav16k(raw);
      } catch (e) {
        return json(res, 500, { error: `Audio conversion failed (ffmpeg needed): ${String(e.message || e).slice(0, 200)}` });
      }
      const transcript = await transcribeAudio(wav, "audio/wav", wavName);
      recordCost(null, MODELS.voice, "voice-transcribe");
      return json(res, 200, { ...parseVoiceCommand(transcript), transcript, model: MODELS.voice, mock: false });
    }
    if (p === "/api/demo" && req.method === "POST") { const s = demoSession(); return json(res, 200, { session: { id: s.id, folder: s.folder, demo: true }, frames: s.frames.map(pub) }); }
    if (p === "/api/upload-begin" && req.method === "POST") {
      const id = "u" + Date.now().toString(36);
      const dir = path.join(DATA, "uploads", id); await fs.mkdir(dir, { recursive: true });
      const cacheDir = path.join(CACHE, id); await fs.mkdir(cacheDir, { recursive: true });
      const session = { id, folder: `uploaded files (${id})`, frames: [], events: [], createdAt: new Date().toISOString(), analysing: false, uploadDir: dir, cacheDir };
      sessions.set(id, session); pendingUploads.set(id, session);
      return json(res, 200, { sessionId: id });
    }
    if (p === "/api/upload" && req.method === "POST") {
      const name = path.basename(url.searchParams.get("name") || "");
      const s = pendingUploads.get(url.searchParams.get("session") || "");
      if (!s || !PHOTO_RE.test(name)) return json(res, 400, { error: "Bad upload session or unsupported file (.NEF/.JPG/.JPEG/.PNG)" });
      const chunks = []; for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      const stored = path.join(s.uploadDir, name); await fs.writeFile(stored, buf);
      const frame = await addFrame(s, s.cacheDir, name, stored, buf);
      return json(res, 200, { frame: pub(frame), count: s.frames.length });
    }
    if (p === "/api/upload-finish" && req.method === "POST") {
      const { sessionId, defer } = await body(req); const s = pendingUploads.get(sessionId);
      if (!s || !s.frames.length) return json(res, 400, { error: "No uploaded photos yet" });
      pendingUploads.delete(sessionId); finishImport(s, defer === true);
      return json(res, 200, { session: { id: s.id, folder: s.folder }, frames: s.frames.map(pub) });
    }
    if (p === "/api/analyze" && req.method === "POST") {
      const { sessionId } = await body(req); const s = sessions.get(sessionId);
      if (!s) return json(res, 404, { error: "session not found" });
      if (!s.frames.length) return json(res, 400, { error: "No photos in this session yet" });
      runAnalysis(s);
      return json(res, 200, { session: { id: s.id, folder: s.folder }, analysing: Boolean(s.analysing), frames: s.frames.map(pub) });
    }
    if (p === "/api/import" && req.method === "POST") { const { folder } = await body(req); const s = await importFolder(path.resolve(folder)); return json(res, 200, { session: { id: s.id, folder: s.folder }, frames: s.frames.map(pub) }); }
    if (p.startsWith("/demo-preview/")) { const i = Number(p.split("/")[2].split(".")[0]); res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end(demoSvg(i)); }
    if (p.startsWith("/preview/")) { const [, , sid, file] = p.split("/"); const s = sessions.get(sid); const f = s?.frames.find((x) => x.previewFile && path.basename(x.previewFile) === file); if (!f) return json(res, 404, { error: "preview not found" }); res.writeHead(200, { "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg" }); return res.end(await fs.readFile(f.previewFile)); }
    if (p === "/api/image/rescue" && req.method === "POST") {
      const { sessionId, frameId, instruction } = await body(req);
      const s = sessions.get(sessionId); const f = s?.frames.find((x) => x.id === frameId);
      if (!f) return json(res, 404, { error: "frame not found" });
      if (!f.previewFile) return json(res, 400, { error: "no preview yet" });
      if (!isApiEnabled()) return json(res, 200, { rescue: { model: MODELS.image, mock: true, status: "stub", note: "Muse Image cleanup preview not generated in this build (API disabled)." } });
      try {
        const raw = await fs.readFile(f.previewFile);
        const small = await downscaleForApi(raw);
        const dataUrl = `data:image/jpeg;base64,${small.toString("base64")}`;
        const what = (f.seg?.distractions || []).map((d) => d.label).filter(Boolean);
        const prompt = instruction || (what.length ? `Remove these background distractions and inpaint naturally: ${what.join(", ")}. Keep the main subject, composition, lighting and colors exactly the same. Photorealistic.` : "Clean up background distractions and inpaint naturally. Keep the main subject, composition, lighting and colors exactly the same. Photorealistic.");
        const out = await imageCleanup(dataUrl, prompt);
        const m = out.imageDataUrl.match(/^data:(image\/\w+);base64,/);
        const ext = m ? "." + m[1].split("/")[1].replace("jpeg", "jpg") : ".png";
        const file = path.join(path.dirname(f.previewFile), path.basename(f.previewFile).replace(/\.[^.]+$/, "") + ".rescue" + ext);
        await fs.writeFile(file, Buffer.from(out.imageDataUrl.slice(out.imageDataUrl.indexOf(",") + 1), "base64"));
        f.rescueFile = file;
        f.rescue = { model: MODELS.image, mock: false, status: "ready" };
        recordCost(sessionId, MODELS.image, "image-rescue");
        return json(res, 200, { rescue: f.rescue, rescueUrl: `/rescue/${sessionId}/${path.basename(file)}` });
      } catch (e) { return json(res, 500, { error: String(e.message || e).slice(0, 300) }); }
    }
    if (p.startsWith("/rescue/")) {
      const [, , sid, file] = p.split("/"); const s = sessions.get(sid);
      const f = s?.frames.find((x) => x.rescueFile && path.basename(x.rescueFile) === file);
      if (!f) return json(res, 404, { error: "rescue not found" });
      res.writeHead(200, { "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg", "access-control-allow-origin": "*" });
      return res.end(await fs.readFile(f.rescueFile));
    }
    if (p === "/api/decision" && req.method === "POST") {
      const { sessionId, frameId, action, text } = await body(req); const s = sessions.get(sessionId); const f = s?.frames.find((x) => x.id === frameId);
      if (!f) return json(res, 404, { error: "frame not found" });
      if (action === "note") f.note = text || ""; else f.decision = action;
      s.events.push({ frameId, name: f.name, total: f.total, action, at: new Date().toISOString() });
      let tasteText = distillTaste(s.events);
      if (isApiEnabled()) {
        try {
          tasteText = await distillTasteLive(s.events);
          recordCost(sessionId, MODELS.vision, "taste");
        } catch { /* mock fallback stays */ }
      }
      s.tasteText = tasteText;
      return json(res, 200, { frame: pub(f), taste: tasteText, counts: counts(s) });
    }
    if (p === "/api/voice" && req.method === "POST") { const { text } = await body(req); return json(res, 200, { ...parseVoiceCommand(text), model: MODELS.voice, mock: true }); }
    if (p === "/api/chat" && req.method === "POST") {
      const { messages, sessionId, context, settings, tools } = await body(req);
      const NUMERIC_KEYS = { contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100], whiteLevel: [-100, 100], blackLevel: [-100, 100], saturation: [-100, 100], clarity: [-5, 5], sharpning: [-100, 100], midRangeSharpning: [-100, 100] };
      const current = {};
      if (settings && typeof settings === "object") for (const k of Object.keys(NUMERIC_KEYS)) if (typeof settings[k] === "number") current[k] = settings[k];
      const withCtx = context ? [{ role: "user", content: `Photo/recipe context: ${context}` }] : [];
      if (Object.keys(current).length && tools !== false) {
        withCtx.push({ role: "user", content: `You can edit the recipe. Current values: ${JSON.stringify(current)}. To change it, reply with ONLY this JSON (no fences, no prose): {"patch": {<keys with new numbers>}, "message": "<one-line summary>"}. Allowed keys/ranges: ${Object.entries(NUMERIC_KEYS).map(([k, [a, b]]) => `${k} ${a}..${b}`).join(", ")}. Interpret vague words yourself ("intensity of colors" means saturation, "soft" means lower contrast plus raised shadows/blacks, "punch" means contrast plus saturation). clarity/sharpning do NOT affect the preview, so avoid them unless asked. For questions with no change requested, reply in prose, never JSON.` });
      }
      withCtx.push(...(Array.isArray(messages) ? messages : []));
      const last = Array.isArray(messages) && messages.length ? String(messages[messages.length - 1].content || "") : "";
      if (!isApiEnabled()) return json(res, 200, { reply: `Mock Muse Spark: I can set sliders from words like "more contrast" or "shadows -10". Tell me which slider to move. (heard: ${last.slice(0, 120)})`, patch: null, model: MODELS.vision, mock: true });
      try {
        const reply = await sparkChat(withCtx);
        recordCost(sessionId || null, MODELS.vision, "chat");
        const tool = extractPatch(reply, NUMERIC_KEYS);
        if (tool) return json(res, 200, { reply: tool.message, patch: tool.patch, model: MODELS.vision, mock: false });
        return json(res, 200, { reply: reply || "Live Muse Spark reply.", patch: null, model: MODELS.vision, mock: false });
      } catch (e) { return json(res, 200, { reply: `Live call failed, use local slider words like "more contrast". (${String(e.message || e).slice(0, 120)})`, model: MODELS.vision, mock: true }); }
    }
    if (p === "/api/picks/plan" && req.method === "POST") {
      const { sessionId, destDir } = await body(req); const s = sessions.get(sessionId); if (!s) return json(res, 404, { error: "session not found" });
      if (s.demo) return json(res, 400, { error: "Demo frames have no real files to move. Import a folder first." });
      const picks = s.frames.filter((f) => f.decision === "keep" || f.decision === "star");
      if (!picks.length) return json(res, 400, { error: "No picks yet — keep or star at least one frame." });
      const manifest = planPicks(s, picks, destDir ? path.resolve(destDir) : s.uploadDir ? path.join(DATA, "picks", s.id) : path.join(s.folder, "CullStudio-Picks"));
      manifests.set(manifest.manifestId, { manifest, sessionId });
      return json(res, 200, manifest);
    }
    if (p === "/api/picks/execute" && req.method === "POST") {
      const { manifestId } = await body(req); const rec = manifests.get(manifestId); if (!rec) return json(res, 404, { error: "manifest not found" });
      const s = sessions.get(rec.sessionId); const done = await executePicks(rec.manifest, new Map(s.frames.map((f) => [f.id, f])));
      rec.manifest = done; return json(res, 200, done);
    }
    if (p === "/api/picks/undo" && req.method === "POST") { const { manifestId } = await body(req); const rec = manifests.get(manifestId); if (!rec) return json(res, 404, { error: "manifest not found" }); return json(res, 200, await undoPicks(rec.manifest)); }
    const file = p === "/" ? "index.html" : p.slice(1);
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" });
    const data = await fs.readFile(full);
    res.writeHead(200, { "content-type": file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html" });
    return res.end(data);
  } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
});
function counts(s) { const c = { keep: 0, reject: 0, star: 0, undecided: 0 }; for (const f of s.frames) c[f.decision || "undecided"] = (c[f.decision || "undecided"] || 0) + 1; return c; }

server.listen(PORT, "127.0.0.1", () => console.log(`Cull Studio http://127.0.0.1:${PORT}  (Meta API ${isApiEnabled() ? "LIVE" : "mock mode"})`));

function demoSvg(i) {
  const rnd = seedFrom("demo-" + i); const h1 = Math.floor(rnd() * 360), h2 = (h1 + 40 + Math.floor(rnd() * 80)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="hsl(${h1} 32% 30%)"/><rect y="240" width="640" height="180" fill="hsl(${h2} 38% 20%)"/><circle cx="${120 + rnd() * 400}" cy="${110 + rnd() * 120}" r="${34 + rnd() * 40}" fill="hsl(${h2} 60% 72%)"/><text x="18" y="398" font-family="monospace" font-size="17" fill="#fff">DEMO DSC_${4200 + i}.NEF</text></svg>`;
}
