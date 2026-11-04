# 07 · Photon / web merge seam (spec only, no code in v1)

Photon (~/Programming/desktop/photon) is a native Swift 6 / SwiftUI app —
not Tauri. Handoff contract for the later merge: Cull Studio delivers a
picks folder; border presets travel as JSON compatible with Photon's
BorderSettings model (aspect ratio, per-side borders, colour). The web
app merge is a React component move: this UI intentionally mirrors the
web app's stack conventions. No border code lives in Cull Studio.
