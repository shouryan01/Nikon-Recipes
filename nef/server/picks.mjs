// Picks output: manifest-driven MOVE of picked NEFs into a picks folder,
// with dry-run planning, post-move verification, sidecars, and undo.
// Safety contract: docs/specs/06-picks-move-safety.md. Originals are never
// modified; a file is moved only if it appears in a planned manifest.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function planPicks(session, picks, destDir) {
  const moves = picks.map((f) => ({
    frameId: f.id, name: f.name,
    from: f.sourcePath,
    to: path.join(destDir, f.name),
    sidecarJson: path.join(destDir, f.name.replace(/\.[^.]+$/, "") + ".cull.json"),
    sidecarMd: path.join(destDir, f.name.replace(/\.[^.]+$/, "") + ".cull.md"),
  }));
  return { manifestId: crypto.randomUUID(), sessionId: session.id, createdAt: new Date().toISOString(), dryRun: true, destDir, moves };
}

export function sidecarContents(frame) {
  const rec = frame.deep?.recommendation || { masks: [], adjustments: [], flags: frame.deep?.flags || [] };
  const json = { frame: frame.name, mock: true, note: "Recommendations only — no edits applied. Follow in NX Studio.", scores: frame.deep?.scores || null, total: frame.total ?? null, reason: frame.deep?.reason || "", recommendation: rec, rescuePreview: frame.rescue || null };
  const md = [`# ${frame.name} — culling recommendations`, "", `Score: ${json.total ?? "n/a"} — ${json.reason}`, "", "## Flags", ...(rec.flags.length ? rec.flags.map((f) => `- ${f}`) : ["- none"]), "", "## Mask recommendations", ...(rec.masks.length ? rec.masks.map((m) => `- ${m.target}: ${m.operation}`) : ["- none"]), "", "## Lighting / colour notes", ...(rec.adjustments.length ? rec.adjustments.map((a) => `- (${a.scope}) ${a.note}`) : ["- none"]), "", "_Mock recommendations (Meta API disabled in this build). No edits were applied to the NEF._", ""].join("\n");
  return { json, md };
}

export async function executePicks(manifest, framesById) {
  await fs.mkdir(manifest.destDir, { recursive: true });
  const done = [];
  for (const m of manifest.moves) {
    const frame = framesById.get(m.frameId);
    await fs.access(m.from); // throws if source missing: abort before partial moves pile up silently
    await fs.rename(m.from, m.to);
    const st = await fs.stat(m.to);
    if (!st.isFile()) throw new Error(`Verification failed after move: ${m.to}`);
    const { json, md } = sidecarContents(frame || { name: m.name });
    await fs.writeFile(m.sidecarJson, JSON.stringify(json, null, 2));
    await fs.writeFile(m.sidecarMd, md);
    done.push(m);
  }
  return { ...manifest, dryRun: false, executedAt: new Date().toISOString(), moves: done };
}

export async function undoPicks(manifest) {
  const restored = [];
  for (const m of [...manifest.moves].reverse()) {
    await fs.rename(m.to, m.from);
    await fs.rm(m.sidecarJson, { force: true });
    await fs.rm(m.sidecarMd, { force: true });
    restored.push(m.name);
  }
  return { manifestId: manifest.manifestId, restored };
}
