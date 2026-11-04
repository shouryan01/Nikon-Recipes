// Real Meta Model API adapters. Shapes match the mocks (api-contract.md).
import { MODELS } from "./models.mjs";
import { createResponse, collectText, createImageEdit } from "./client.mjs";

export function parseSamBoxes(text) {
  const boxes = [];
  const re = /<\|box;x1=([\d.]+);y1=([\d.]+);x2=([\d.]+);y2=([\d.]+);w=([\d.]+);h=([\d.]+)\|>/g;
  let m;
  while ((m = re.exec(text || ""))) {
    const [, x1, y1, x2, y2, w, h] = m.map(Number);
    if (w > 0 && h > 0) boxes.push({ x: round(x1 / w), y: round(y1 / h), w: round((x2 - x1) / w), h: round((y2 - y1) / h) });
  }
  return boxes;
}
const round = (n) => Math.round(n * 1000) / 1000;

export function buildImageEditBody(imageDataUrl, prompt) {
  return { model: MODELS.image, prompt, images: [{ image_url: imageDataUrl }] };
}

export function parseImageResult(payload) {
  const d = payload?.data?.[0];
  if (!d) throw new Error("Image model returned no image");
  if (typeof d.b64_json === "string" && d.b64_json) return `data:image/png;base64,${d.b64_json}`;
  if (typeof d.url === "string" && d.url) return d.url;
  if (typeof d === "string" && d) return d;
  throw new Error("Unrecognized image result shape");
}

export async function imageCleanup(imageDataUrl, instruction) {
  const payload = await createImageEdit({ imageDataUrl, prompt: instruction });
  let out = parseImageResult(payload);
  if (/^https?:/.test(out)) {
    const r = await fetch(out);
    if (!r.ok) throw new Error(`Image download ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    out = `data:${r.headers.get("content-type") || "image/png"};base64,${buf.toString("base64")}`;
  }
  return { model: MODELS.image, mock: false, imageDataUrl: out };
}

export function parseSparkJson(text) {
  const clean = String(text || "").replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Vision model did not return JSON");
  return JSON.parse(clean.slice(start, end + 1));
}

export const SPARK_PROMPT = `You are culling a landscape / street / still-life photo shoot for a photographer who will confirm every pick. Judge this frame and reply with ONLY a JSON object (no prose):
{"subjectPhrase":"short noun phrase naming the main subject, or null","scores":{"aesthetic":0-10,"composition":0-10,"light":0-10,"frameSharpness":0-10,"subjectSharpness":0-10 or null,"dofSeparation":0-10},"flags":["short flags: soft frame, soft subject, horizon tilt, distractions"],"reason":"one plain-language sentence","recommendation":{"masks":[{"target":"subject|background|distraction","operation":"what to do locally"}],"adjustments":[{"scope":"global|geometry|color|local","note":"specific lighting/colour advice"}]}}
Weight composition, light and frame-wide sharpness most; subject sharpness matters when there is a clear subject. Note unwanted background micro-distractions as flags.`;

export async function distillTasteLive(events) {
  const keeps = events.filter((e) => e.action === "keep" || e.action === "star");
  const rejects = events.filter((e) => e.action === "reject");
  const fmt = (e) => `- ${e.name || e.frameId} (AI score ${e.total ?? "?"}, marked ${e.action})`;
  const prompt = `You are distilling a photographer's taste profile from their culling decisions. They confirm or override an AI rank for every photo.\nKeeps:\n${keeps.map(fmt).join("\n") || "(none yet)"}\nRejects:\n${rejects.map(fmt).join("\n") || "(none yet)"}\nReply with 3-5 short plain lines, first line "Based on ${keeps.length} keeps and ${rejects.length} rejects so far:". Say what they favor (subjects, light, color) and how future ranks should lean. Plain text only, no JSON.`;
  return sparkChat([{ role: "user", content: prompt }]);
}

export async function sparkChat(messages) {
  // The API rejects input_text on assistant-role messages, so only the
  // user's own turns go over the wire (plus the context note, also user).
  const input = (messages || [])
    .filter((m) => m && m.role !== "assistant" && String(m.content || "").trim() !== "")
    .map((m) => ({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: String(m.content) }],
    }));
  if (!input.length) throw new Error("empty prompt");
  const payload = await createResponse({ model: MODELS.vision, input });
  return collectText(payload);
}

export async function sparkAnalyse(imageDataUrl, tasteProfile = "") {
  const prompt = tasteProfile && !tasteProfile.startsWith("No decisions") ? `${SPARK_PROMPT}\nPhotographer taste profile (re-rank toward this): ${tasteProfile}` : SPARK_PROMPT;
  const payload = await createResponse({
    model: MODELS.vision,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: imageDataUrl }] }],
  });
  const parsed = parseSparkJson(collectText(payload));
  return {
    model: MODELS.vision, mock: false, stage: 2,
    scores: parsed.scores, flags: parsed.flags || [],
    reason: parsed.reason || "",
    recommendation: parsed.recommendation || { masks: [], adjustments: [] },
    subjectPhrase: parsed.subjectPhrase || null,
  };
}

export async function samSegment(imageDataUrl, concept) {
  const payload = await createResponse({
    model: MODELS.segmentation, timeoutMs: 60000,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: imageDataUrl }] }],
  });
  return { model: MODELS.segmentation, mock: false, concept, boxes: parseSamBoxes(collectText(payload)) };
}
