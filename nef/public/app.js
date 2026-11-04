const $ = (s) => document.querySelector(s);
let session = null, frames = [], idx = 0, manifestId = null;

async function post(url, data) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data || {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const cur = () => frames[idx];

fetch("/api/health").then((r) => r.json()).then((h) => {
  $("#banner").textContent = h.apiEnabled ? `LIVE — Meta Model API connected (key present). SAM 3.1 · Muse Spark · Muse Voice are real calls.` : "Mock mode — no Meta API key loaded. Scores are deterministic mocks.";
  $("#meter").textContent = h.apiEnabled ? "Live mode: per-frame Muse Spark + SAM 3.1 calls. Actual billing is on your Meta account." : "Actual spend: $0.00 — mock mode.";
}).catch(() => { $("#banner").textContent = "Could not read API mode from server."; });

function showWait(done, total, analysing) {
  const el = $("#apiWait");
  if (!total) { el.hidden = true; return; }
  el.hidden = !analysing;
  $("#apiProgress").max = total;
  $("#apiProgress").value = done;
  $("#apiWaitText").textContent = analysing
    ? `Waiting to hear back from the Meta API… analysed ${done} of ${total} frames`
    : `Analysis complete — ${done} of ${total} frames`;
}
async function pollSession() {
  if (!session || session.demo) { showWait(0, 0, false); return; }
  try {
    const r = await (await fetch(`/api/session/${session.id}`)).json();
    const keepId = cur()?.id;
    frames = r.frames;
    idx = Math.max(0, frames.findIndex((f) => f.id === keepId));
    const done = frames.filter((f) => String(f.status).startsWith("analysed")).length;
    showWait(done, frames.length, r.analysing || done < frames.length);
    render();
    if (r.analysing) setTimeout(pollSession, 1500);
    else { showWait(done, frames.length, false); $("#apiWait").hidden = done >= frames.length; $("#sessionInfo").textContent = `${frames.length} frames · analysis complete · ${session.folder}`; }
  } catch { /* keep UI as-is */ }
}

function render() {
  const f = cur(); if (!f) return;
  $("#frameWait").hidden = String(f.status).startsWith("analysed");
  $("#big").src = f.previewUrl;
  $("#frameMeta").textContent = `#${idx + 1} of ${frames.length} · ${f.name} · total ${f.total}/10` + (f.group ? ` · burst group ${f.group} (${f.groupSize})` : "") + (f.decision ? ` · ${f.decision.toUpperCase()}` : "");
  $("#reason").textContent = f.deep?.reason || "";
  $("#flags").innerHTML = (f.deep?.flags || []).map((x) => `<li>${x}</li>`).join("");
  const s = f.deep?.scores || {};
  $("#scores").innerHTML = Object.entries(s).map(([k, v]) => `<dt>${k}</dt><dd>${v ?? "—"}</dd>`).join("");
  $("#rec").textContent = JSON.stringify(f.deep?.recommendation || {}, null, 2) + (f.rescue ? `\n\nRescue preview: ${f.rescue.note}` : "");
  const mb = $("#mask");
  if (f.seg?.subject && !mb.hidden) {
    const stage = $(".stage").getBoundingClientRect(), img = $("#big").getBoundingClientRect();
    const b = f.seg.subject.box;
    mb.style.left = (img.left - stage.left + b.x * img.width) + "px"; mb.style.top = (img.top - stage.top + b.y * img.height) + "px";
    mb.style.width = b.w * img.width + "px"; mb.style.height = b.h * img.height + "px";
  }
  $("#filmstrip").innerHTML = frames.map((x, i) => `<button class="thumb" data-i="${i}" aria-current="${i === idx}"><img src="${x.previewUrl}" alt=""><span>#${i + 1} ${x.total ?? "…"}</span> <span class="d-${x.decision || ""}">${x.decision || ""}</span>${String(x.status).startsWith("analysed") ? "" : " <span>⏳</span>"}<br><small>${x.name}</small></button>`).join("");
  document.querySelectorAll(".thumb").forEach((t) => t.addEventListener("click", () => { idx = Number(t.dataset.i); render(); }));
}

async function decide(action, text) {
  const f = cur(); if (!f) return;
  const r = await post("/api/decision", { sessionId: session.id, frameId: f.id, action, text });
  Object.assign(f, r.frame);
  $("#taste").value = r.taste;
  $("#counts").textContent = JSON.stringify(r.counts);
  if (action !== "note" && idx < frames.length - 1) idx++;
  render();
}

async function loadSession(promise) {
  $("#apiWait").hidden = false;
  $("#apiWaitText").textContent = "Waiting to hear back from the Meta API…";
  try {
    const r = await promise;
    session = r.session; frames = r.frames; idx = 0; manifestId = null;
    $("#studio").hidden = false;
    $("#sessionInfo").textContent = `${frames.length} frames · ${session.folder}`;
    $("#execBtn").disabled = true; $("#undoBtn").disabled = true; $("#picksOut").textContent = "";
    render(); pollSession();
  } catch (e) { $("#sessionInfo").textContent = "Error: " + e.message; }
}

$("#importBtn").addEventListener("click", () => loadSession(post("/api/import", { folder: $("#folder").value })));
$("#uploadBtn").addEventListener("click", async () => {
  const files = [...$("#files").files];
  if (!files.length) { $("#sessionInfo").textContent = "Choose one or more .NEF/.JPG/.PNG files first."; return; }
  try {
    $("#sessionInfo").textContent = `Uploading ${files.length} photo(s)…`;
    const { sessionId } = await post("/api/upload-begin");
    for (const f of files) {
      const r = await fetch(`/api/upload?session=${sessionId}&name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "content-type": f.type || "application/octet-stream" }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(`${f.name}: ${j.error || "upload failed"}`);
    }
    loadSession(post("/api/upload-finish", { sessionId }));
  } catch (e) { $("#sessionInfo").textContent = "Error: " + e.message; }
});
$("#demoBtn").addEventListener("click", () => loadSession(post("/api/demo")));
document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.act)));
$("#prevBtn").addEventListener("click", () => { idx = Math.max(0, idx - 1); render(); });
$("#nextBtn").addEventListener("click", () => { idx = Math.min(frames.length - 1, idx + 1); render(); });
$("#maskBtn").addEventListener("click", () => { const m = $("#mask"); m.hidden = !m.hidden; render(); });
document.addEventListener("keydown", (e) => {
  if (!session || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "k") decide("keep"); else if (k === "x") decide("reject"); else if (k === "s") decide("star");
  else if (k === "arrowright") { idx = Math.min(frames.length - 1, idx + 1); render(); }
  else if (k === "arrowleft") { idx = Math.max(0, idx - 1); render(); }
});

$("#voiceBtn").addEventListener("click", async () => {
  try {
    const cmd = await post("/api/voice", { text: $("#voiceInput").value });
    $("#voiceEcho").textContent = `Heard: "${cmd.heard}" → ${cmd.action}${cmd.error ? " (" + cmd.error + ")" : ""} [mock Muse Voice]`;
    if (cmd.needsConfirm && !confirm(`Voice command heard: ${cmd.action} this frame?`)) return;
    if (["keep", "reject", "star"].includes(cmd.action)) decide(cmd.action);
    else if (cmd.action === "note") decide("note", cmd.text);
    else if (cmd.action === "next") { idx = Math.min(frames.length - 1, idx + 1); render(); }
    else if (cmd.action === "prev") { idx = Math.max(0, idx - 1); render(); }
  } catch (e) { $("#voiceEcho").textContent = "Error: " + e.message; }
});

let recorder = null, recChunks = [];
$("#micBtn").addEventListener("click", async () => {
  if (recorder && recorder.state === "recording") { recorder.stop(); $("#micBtn").textContent = "🎙 Record voice (Muse Voice)"; return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => recChunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        const blob = new Blob(recChunks, { type: recorder.mimeType || "audio/webm" });
        const r = await fetch("/api/voice/audio", { method: "POST", headers: { "content-type": blob.type }, body: blob });
        const cmd = await r.json();
        if (!r.ok) throw new Error(cmd.error || "transcription failed");
        $("#voiceEcho").textContent = `Heard: "${cmd.transcript}" → ${cmd.action} [Muse Voice live]`;
        if (cmd.needsConfirm && !confirm(`Voice command heard: ${cmd.action} this frame?`)) return;
        if (["keep", "reject", "star"].includes(cmd.action)) decide(cmd.action);
        else if (cmd.action === "note") decide("note", cmd.text);
        else if (cmd.action === "next") { idx = Math.min(frames.length - 1, idx + 1); render(); }
        else if (cmd.action === "prev") { idx = Math.max(0, idx - 1); render(); }
      } catch (e) { $("#voiceEcho").textContent = "Voice error: " + e.message + " (typed commands still work)"; }
    };
    recorder.start(); $("#micBtn").textContent = "⏹ Stop & send";
  } catch (e) { $("#voiceEcho").textContent = "Mic unavailable: " + e.message; }
});

$("#planBtn").addEventListener("click", async () => {
  try {
    const m = await post("/api/picks/plan", { sessionId: session.id });
    manifestId = m.manifestId;
    $("#picksOut").textContent = `DRY RUN — nothing moved yet.\nDestination: ${m.destDir}\n` + m.moves.map((x) => `${x.from}  ->  ${x.to}`).join("\n");
    $("#execBtn").disabled = false;
  } catch (e) { $("#picksOut").textContent = "Error: " + e.message; }
});
$("#execBtn").addEventListener("click", async () => {
  try {
    const m = await post("/api/picks/execute", { manifestId });
    $("#picksOut").textContent = `Moved ${m.moves.length} NEF(s) + sidecars to ${m.destDir}. Open that folder in NX Studio.`;
    $("#execBtn").disabled = true; $("#undoBtn").disabled = false;
  } catch (e) { $("#picksOut").textContent = "Error: " + e.message; }
});
$("#undoBtn").addEventListener("click", async () => {
  try {
    const r = await post("/api/picks/undo", { manifestId });
    $("#picksOut").textContent = `Undone. Restored: ${r.restored.join(", ")}`;
    $("#undoBtn").disabled = true;
  } catch (e) { $("#picksOut").textContent = "Error: " + e.message; }
});
