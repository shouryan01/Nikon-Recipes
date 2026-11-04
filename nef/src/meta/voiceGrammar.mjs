// Voice command grammar. In production this text comes from Muse Voice
// Transcribe streaming ASR; here it is fed by the UI's simulated-voice box
// (and by tests). Parsing is pure: text in, action out. The UI must echo
// the parsed command and wait for confirmation before acting (spec 04).
const RULES = [
  [/^(keep|pick|select|yes)\b/, () => ({ action: "keep" })],
  [/^(reject|drop|no|delete)\b/, () => ({ action: "reject" })],
  [/^(star|favourite|favorite)\b/, () => ({ action: "star" })],
  [/^(next|forward)\b/, () => ({ action: "next" })],
  [/^(back|previous|prev)\b/, () => ({ action: "prev" })],
  [/^show (?:me )?(?:the )?(soft|flagged|distraction|top|starred|picks?)/, (m) => ({ action: "filter", filter: m[1] })],
  [/^compare/, () => ({ action: "compare" })],
  [/^note[: ]+(.+)/, (m) => ({ action: "note", text: m[1] })],
  [/^(finish|export|done)\b/, () => ({ action: "finish" })],
  [/^(undo)\b/, () => ({ action: "undo" })],
];

export function parseVoiceCommand(raw) {
  const text = String(raw || "").trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!text) return { action: "noop", heard: raw, error: "empty" };
  for (const [re, make] of RULES) {
    const m = text.match(re);
    if (m) return { ...make(m), heard: raw, needsConfirm: ["keep", "reject", "finish"].includes(make(m).action) };
  }
  return { action: "unknown", heard: raw, error: `No command matched: "${text}"` };
}
