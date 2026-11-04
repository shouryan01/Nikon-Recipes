# 01 · Product spec — nef

Separate Meta-hackathon product. Decoupled from the Nikon recipe pipeline
(out of scope, not a dependency). Local code does file handling + UI only;
all intelligence is Meta Model API (stubbed with mocks in this build —
no API calls are made).

Workflow: import a folder of Nikon NEFs (100–1,000) → ranked review
(AI ranks, photographer confirms) → picks moved into a picks folder →
open that folder in NX Studio. Grading help is recommendations-only
(sidecars); the studio never edits a NEF.

Decisions locked with the owner: landscape/street/still-life weighting;
taste learning on (spec 05); NEFs moved, not copied (spec 06);
recommendations as sidecars; Photon borders are a spec-only seam (07).
