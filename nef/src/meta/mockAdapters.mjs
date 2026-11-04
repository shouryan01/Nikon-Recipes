// Deterministic mock adapters for the Meta Model API.
// Same shapes the real adapters will return (docs/specs/api-contract.md).
// Seeded by frame id, so the demo and tests are stable. NO network calls.
import { MODELS } from "./models.mjs";

export function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const r2 = (n) => Math.round(n * 100) / 100;

// --- SAM 3.1 (mock): subject/background masks + distraction segments ---
export function mockSegment(frame) {
  const rnd = seedFrom(frame.id + ":sam");
  const hasSubject = rnd() > 0.22;
  const sx = r2(0.18 + rnd() * 0.3), sy = r2(0.2 + rnd() * 0.25);
  const sw = r2(0.28 + rnd() * 0.3), sh = r2(0.35 + rnd() * 0.4);
  const distractions = [];
  const n = Math.floor(rnd() * 3.4);
  for (let i = 0; i < n; i++) {
    distractions.push({
      label: ["edge intrusion", "background bright spot", "small background object"][Math.floor(rnd() * 3)],
      box: { x: r2(rnd() * 0.85), y: r2(rnd() * 0.8), w: r2(0.03 + rnd() * 0.07), h: r2(0.03 + rnd() * 0.07) },
      cleanupCandidate: true,
    });
  }
  return {
    model: MODELS.segmentation, mock: true,
    subject: hasSubject ? { label: frame.subjectHint || "main subject", box: { x: sx, y: sy, w: sw, h: sh }, maskRef: `mock-mask://${frame.id}/subject` } : null,
    horizonTiltDeg: r2((rnd() - 0.5) * 2.4),
    distractions,
  };
}

// --- Muse Spark (mock): stage-1 fast pass + stage-2 deep pass ---
export function mockFastScore(frame) {
  const rnd = seedFrom(frame.id + ":fast");
  return { model: MODELS.vision, mock: true, stage: 1, aesthetic: r2(3 + rnd() * 6.5), obviousFault: rnd() > 0.86 ? "possible soft frame" : null };
}

export function mockDeepScore(frame, seg) {
  const rnd = seedFrom(frame.id + ":deep");
  const subjectSharpness = seg.subject ? r2(4 + rnd() * 6) : null;
  const dofSeparation = seg.subject ? r2(2 + rnd() * 7.5) : r2(4 + rnd() * 4);
  const scores = {
    aesthetic: r2(3 + rnd() * 6.8),
    frameSharpness: r2(3.5 + rnd() * 6.3),
    subjectSharpness,
    dofSeparation,
    composition: r2(3 + rnd() * 6.9),
    light: r2(3 + rnd() * 6.7),
  };
  const flags = [];
  if (scores.frameSharpness < 5.2) flags.push("soft frame");
  if (subjectSharpness !== null && subjectSharpness < 5.4) flags.push("soft subject");
  if (Math.abs(seg.horizonTiltDeg) > 0.8) flags.push(`horizon tilt ${seg.horizonTiltDeg}°`);
  for (const d of seg.distractions) flags.push(`distraction: ${d.label} (cleanup candidate)`);
  const reason = buildReason(scores, seg, flags);
  return { model: MODELS.vision, mock: true, stage: 2, scores, flags, reason,
    recommendation: buildRecommendation(scores, seg, flags) };
}

function buildReason(s, seg, flags) {
  const bits = [];
  bits.push(s.aesthetic >= 7.5 ? "Strong overall impression" : s.aesthetic >= 5.5 ? "Solid frame" : "Weak overall impression");
  if (seg.subject) bits.push(`subject separation ${s.dofSeparation}/10`);
  bits.push(`composition ${s.composition}/10`);
  if (flags.length) bits.push(flags.slice(0, 2).join("; "));
  return bits.join(" · ") + ".";
}

function buildRecommendation(s, seg, flags) {
  const masks = [], adjustments = [];
  if (seg.subject) masks.push({ target: "subject", operation: "selective sharpening + slight clarity", region: seg.subject.box });
  if (seg.distractions.length) masks.push({ target: "background distractions", operation: "darken/desaturate locally; candidate for background cleanup", regions: seg.distractions.map((d) => d.box) });
  if (s.light < 6) adjustments.push({ scope: "global", note: "Lift shadows slightly; protect highlights — light reads flat." });
  if (Math.abs(seg.horizonTiltDeg) > 0.8) adjustments.push({ scope: "geometry", note: `Straighten horizon by ${-seg.horizonTiltDeg}°.` });
  adjustments.push({ scope: "color", note: s.aesthetic >= 7 ? "Colour is working; minimal grade needed." : "Consider a restrained contrast curve before colour moves." });
  return { masks, adjustments, flags };
}

export function mockRescuePreview(frame) {
  return { model: MODELS.image, mock: true, status: "stub", note: "Muse Image cleanup preview not generated in this build (API disabled). Flagged distractions are listed in the sidecar.", frameId: frame.id };
}
