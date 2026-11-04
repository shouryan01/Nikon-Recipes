// Single place that names Meta models. Nothing else in the codebase
// hard-codes a model ID, so a version bump is a one-line change here.
//
// Live mode is on when MODEL_API_KEY is present (server loads it from
// cull-studio/.env at startup) unless CULL_MOCK=1 forces mock mode.
// Adapters fall back to deterministic mocks per-frame if a call fails.
export function isApiEnabled() {
  return Boolean(process.env.MODEL_API_KEY) && process.env.CULL_MOCK !== "1";
}
export const API_ENABLED = false; // static snapshot for tests; use isApiEnabled() at runtime

export const MODELS = {
  segmentation: "sam-3.1", // SAM 3.1 — masks, subjects, distractions (live API id uses a dot)
  vision: "muse-spark-1.3", // Muse Spark — aesthetic scoring, critique, sidecar notes
  voice: "muse-voice-transcribe-1.0", // Muse Voice Transcribe — streaming commands/notes
  image: "muse-image-1.0", // Muse Image — preview-only distraction-removal previews
};

export const API_BASE = "https://api.meta.ai/v1";

export function assertNoApiCalls() {
  if (API_ENABLED) throw new Error("Real Meta adapters are not implemented in this build.");
  return { apiEnabled: false, models: MODELS, note: "Mock adapters only. No network calls are made." };
}
