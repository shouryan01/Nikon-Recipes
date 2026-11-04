# 02 · Meta Model API contract (stubbed)

Base: https://api.meta.ai/v1 · Auth: MODEL_API_KEY (not provisioned).
Model IDs live ONLY in src/meta/models.mjs. `API_ENABLED=false` in this
build; adapters in src/meta/mockAdapters.mjs return deterministic mocks
with the same shapes below, and perform no network calls.

Pipeline: Stage 1 Muse Spark fast pass (all frames, downscaled preview)
→ SAM 3.1 segmentation (subject/background/distraction masks) → Stage 2
Muse Spark deep pass (scores, flags, reason, parametric mask +
lighting/colour recommendations) → taste re-rank (05). Muse Voice
Transcribe streams command/note text into voiceGrammar.mjs. Muse Image
cleanup renders are live via POST /api/image/rescue for
distraction-flagged frames (served at /rescue/..., costed per call).

Budgets to verify in Phase 0 when connecting: cost/latency per frame per
stage on 500 real previews; rate limits; demo fallback = recorded fixtures.
