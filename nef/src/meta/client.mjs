// Meta Model API client. One place for auth, timeouts and error shape.
// The key is read from the environment and never logged or returned.
import { API_BASE, MODELS } from "./models.mjs";

export function collectText(payload) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (v.type === "output_text" && typeof v.text === "string") { out.push(v.text); return; }
    Object.values(v).forEach(walk);
  };
  if (payload?.output_text) out.push(payload.output_text);
  walk(payload?.output);
  return out.join("\n");
}

export async function createResponse({ model, input, timeoutMs = 90000 }) {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API_BASE}/responses`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input, stream: false, store: false }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Meta API ${r.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

export function encodingFor(contentType = "") {
  // The API only accepts mono s16 WAV (16/24 kHz); the server converts
  // uploads to that shape first, so the declared encoding is always WAV.
  return "WAV";
}

export async function createImageEdit({ imageDataUrl, prompt, timeoutMs = 300000 }) {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API_BASE}/images/edits`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODELS.image, prompt, images: [{ image_url: imageDataUrl }] }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Image API ${r.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

export function buildTranscribeForm(buffer, contentType = "audio/webm", filename = "command.webm") {
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: encodingFor(contentType) })], { type: "application/json" }), "request.json");
  form.append("audio", new Blob([buffer], { type: contentType }), filename);
  return form;
}

export async function transcribeAudio(buffer, contentType = "audio/webm", filename = "command.webm") {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set");
  const form = buildTranscribeForm(buffer, contentType, filename);
  const r = await fetch(`${API_BASE}/asr/transcribe`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  const text = await r.text();
  if (!r.ok) throw new Error(`Voice API ${r.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  return j.text || j.transcript || collectText(j) || "";
}
