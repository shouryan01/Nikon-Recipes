# 03 · Scoring rubric
Weights (src/scoring.mjs): aesthetic .34, composition .22, light .16,
frame sharpness .14, DoF separation .08, subject sharpness .06 (subject
terms only when SAM finds a subject). Every rank ships with flags and a
plain-language reason. Known limit: previews are the camera JPEG render,
not raw latitude.

# 04 · Voice grammar
Commands: keep/reject/star/next/back, "show me soft|flagged|distraction|
top|starred|picks", compare, "note: …", finish, undo. The UI echoes the
parsed command; keep/reject/finish require confirmation before acting.
Keyboard parity is mandatory — voice failure degrades, never blocks.

# 05 · Taste profile
Every confirm/override is a preference event. The profile is editable
natural language, distilled (Muse Spark when connected; mock text now),
stored with the session, resettable. No trained model in v1.

# 06 · Picks move safety
Dry-run manifest first; nothing moves on plan. Execute verifies each
file exists before moving and after landing; sidecars (.cull.json +
.cull.md) are written per pick. Undo restores original names/locations
and removes sidecars. Execute refuses demo sessions. Unpicked files are
never touched.
