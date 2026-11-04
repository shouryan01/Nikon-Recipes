import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractEmbeddedJpeg } from "../server/nef.mjs";
import { parseVoiceCommand } from "../src/meta/voiceGrammar.mjs";
import { mockSegment, mockDeepScore } from "../src/meta/mockAdapters.mjs";
import { totalScore } from "../src/scoring.mjs";
import { planPicks, executePicks, undoPicks } from "../server/picks.mjs";
import { API_ENABLED, isApiEnabled } from "../src/meta/models.mjs";
import { parseSamBoxes, parseSparkJson, buildImageEditBody, parseImageResult } from "../src/meta/realAdapters.mjs";
import { collectText, buildTranscribeForm, encodingFor } from "../src/meta/client.mjs";

test("voice upload uses the API's request/audio multipart parts", async () => {
  const form = buildTranscribeForm(Buffer.from([0, 1, 2]), "audio/webm", "command.webm");
  const keys = Array.from(form.keys());
  assert.ok(keys.includes("request"), "form needs a request part");
  assert.ok(keys.includes("audio"), "form needs an audio part");
  assert.ok(!keys.includes("file") && !keys.includes("mode"), "no legacy file/mode parts");
  const reqText = await form.get("request").text();
  assert.equal(JSON.parse(reqText).model, "muse-voice-transcribe-1.0");
});

test("voice request names an audio encoding", async () => {
  assert.equal(encodingFor("audio/wav"), "WAV");
  assert.equal(encodingFor("audio/webm;codecs=opus"), "WAV");
  const form = buildTranscribeForm(Buffer.from([0]), "audio/wav");
  const req = JSON.parse(await form.get("request").text());
  assert.equal(req.audioEncoding, "WAV");
});

test("mock mode is default without a key; static snapshot stays off", () => {
  delete process.env.MODEL_API_KEY;
  assert.equal(API_ENABLED, false);
  assert.equal(isApiEnabled(), false);
  process.env.MODEL_API_KEY = "test-key-not-real";
  assert.equal(isApiEnabled(), true);
  process.env.CULL_MOCK = "1";
  assert.equal(isApiEnabled(), false);
  delete process.env.MODEL_API_KEY; delete process.env.CULL_MOCK;
});

test("parses SAM box records into normalized boxes", () => {
  const boxes = parseSamBoxes("<0f>1<|box;x1=450;y1=300;x2=900;y2=900;w=1800;h=1200|>");
  assert.deepEqual(boxes, [{ x: 0.25, y: 0.25, w: 0.25, h: 0.5 }]);
  assert.deepEqual(parseSamBoxes("no matches"), []);
});

test("image edit body targets muse-image with the reference photo", () => {
  const b = buildImageEditBody("data:image/jpeg;base64,AAA", "remove the tourists");
  assert.equal(b.model, "muse-image-1.0");
  assert.equal(b.prompt, "remove the tourists");
  assert.deepEqual(b.images, [{ image_url: "data:image/jpeg;base64,AAA" }]);
});

test("image result parses b64_json and url shapes", () => {
  assert.equal(parseImageResult({ data: [{ b64_json: "AAA" }] }), "data:image/png;base64,AAA");
  assert.equal(parseImageResult({ data: [{ url: "https://x/y.png" }] }), "https://x/y.png");
  assert.throws(() => parseImageResult({ data: [] }), /no image/);
  assert.throws(() => parseImageResult({}), /no image/);
});

test("parses Spark JSON (fenced) and Responses text", () => {
  const j = parseSparkJson('```json\n{"scores":{"aesthetic":8},"reason":"ok"}\n```');
  assert.equal(j.scores.aesthetic, 8);
  assert.equal(collectText({ output: [{ content: [{ type: "output_text", text: "hi" }] }] }), "hi");
  assert.throws(() => parseSparkJson("no json here"));
});

test("extracts a JPEG preview from the repo's real NEF", async () => {
  const buf = await fs.readFile(new URL("../../web/me.NEF", import.meta.url));
  const jpg = extractEmbeddedJpeg(new Uint8Array(buf));
  assert.ok(jpg && jpg.length > 10000, "preview should be a real JPEG");
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
});

test("voice grammar parses core commands", () => {
  assert.equal(parseVoiceCommand("Keep").action, "keep");
  assert.equal(parseVoiceCommand("reject this").action, "reject");
  assert.equal(parseVoiceCommand("note: great light").text, "great light");
  assert.equal(parseVoiceCommand("show me flagged").filter, "flagged");
  assert.equal(parseVoiceCommand("blah blah").action, "unknown");
  assert.equal(parseVoiceCommand("keep").needsConfirm, true);
});

test("mock scoring is deterministic and ranked sanely", () => {
  const f = { id: "x1", name: "DSC_0001.NEF" };
  const a = mockDeepScore(f, mockSegment(f)), b = mockDeepScore(f, mockSegment(f));
  assert.deepEqual(a, b);
  assert.ok(totalScore(a.scores) >= 0 && totalScore(a.scores) <= 10);
  assert.ok(a.reason.length > 10 && a.recommendation.adjustments.length >= 1);
});

test("picks plan/execute/undo restores originals on a temp folder", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cull-test-"));
  const src = path.join(dir, "DSC_0001.NEF");
  await fs.writeFile(src, "fake-nef-bytes");
  const frame = { id: "f1", name: "DSC_0001.NEF", sourcePath: src, total: 8.5, deep: { scores: {}, reason: "test", flags: [], recommendation: { masks: [], adjustments: [], flags: [] } } };
  const manifest = planPicks({ id: "t" }, [frame], path.join(dir, "Picks"));
  const done = await executePicks(manifest, new Map([[frame.id, frame]]));
  assert.equal(done.moves.length, 1);
  await assert.rejects(fs.access(src));
  await fs.access(path.join(dir, "Picks", "DSC_0001.NEF"));
  await fs.access(path.join(dir, "Picks", "DSC_0001.cull.md"));
  await undoPicks(done);
  assert.equal(await fs.readFile(src, "utf8"), "fake-nef-bytes");
  await fs.rm(dir, { recursive: true, force: true });
});
