# Cull Studio

Semantic visual culling and grading studio for Nikon NEF shoots (Meta hackathon).

**This build makes no Meta API calls.** SAM 3.1, Muse Spark, Muse Voice
Transcribe and Muse Image are wired behind adapters in `src/meta/` with
deterministic mock results. Model IDs live in `src/meta/models.mjs`.

Run: `npm start` → open http://127.0.0.1:4173
Test: `npm test`

Use **Load demo session** for a no-files walkthrough, or import a folder
of `.NEF` files (embedded JPEG previews are extracted locally; NEFs are
never uploaded or modified until you confirm a picks move).

Specs: `docs/specs/`.
