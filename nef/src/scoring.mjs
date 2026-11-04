// Ranking and taste. Landscape/street/still-life weighting (product spec 01).
// Subject terms engage only when SAM found a subject. Taste v1 is an
// editable natural-language profile distilled (mock) from preference
// events — no trained model, no opaque weights (spec 05).
export const WEIGHTS = { aesthetic: 0.34, composition: 0.22, light: 0.16, frameSharpness: 0.14, dofSeparation: 0.08, subjectSharpness: 0.06 };

export function totalScore(scores) {
  if (!scores) return 0;
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (scores[k] === null || scores[k] === undefined) continue;
    sum += scores[k] * w; wsum += w;
  }
  return wsum ? Math.round((sum / wsum) * 100) / 100 : 0;
}

export function groupBursts(frames) {
  // Grouping: explicit groupId wins. Otherwise chain frames that share a
  // name prefix and have consecutive trailing sequence numbers (bursts).
  const groups = new Map();
  const push = (key, f) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(f); };
  const byPrefix = new Map();
  for (const f of frames) {
    if (f.groupId) { push(f.groupId, f); continue; }
    const m = f.name.match(/^(.*?)(\d+)(\.[^.]+)?$/);
    if (!m) continue;
    const key = m[1];
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key).push({ f, n: Number(m[2]) });
  }
  for (const [prefix, items] of byPrefix) {
    items.sort((a, b) => a.n - b.n);
    let chain = [items[0]];
    const flush = () => { if (chain.length > 1) for (const { f } of chain) push(prefix + "burst", f); };
    for (let i = 1; i < items.length; i++) {
      if (items[i].n - items[i - 1].n <= 2) chain.push(items[i]);
      else { flush(); chain = [items[i]]; }
    }
    flush();
  }
  for (const [key, members] of groups) for (const f of members) { f.group = key; f.groupSize = members.length; }
  return frames;
}

export function distillTaste(events) {
  const keeps = events.filter((e) => e.action === "keep" || e.action === "star");
  const rejects = events.filter((e) => e.action === "reject");
  if (!events.length) return "No decisions yet. Make a few keeps and rejects and your taste profile will appear here.";
  const lines = [];
  lines.push(`Based on ${keeps.length} keeps and ${rejects.length} rejects so far:`);
  if (keeps.length) lines.push("- You confirm the AI's top ranks more often than you override them; keep trusting the ranked order.");
  if (rejects.length) lines.push("- Rejected frames skew to the AI's lower half; the rubric's weak-frame detection matches your eye.");
  lines.push("- (Mock distillation — Muse Spark will write this profile when the API is connected.)");
  return lines.join("\n");
}
