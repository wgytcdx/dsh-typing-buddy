import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ASSET_STATES, AssetError, createAssetStore, MAX_MANIFEST_BYTES, MEDIA_PREFIX, normalizeAssetPack,
} from "../lib/assets.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "input");
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input, "face.jpg"), "portrait-test-data");
  fs.writeFileSync(path.join(input, "night.png"), "night-test-data");
  fs.writeFileSync(path.join(input, "work.mp4"), "0123456789abcdef");
  fs.writeFileSync(path.join(input, "work-dark.mp4"), "dark-video-test-data");
  const storageDir = path.join(root, "managed");
  const manifestPath = path.join(input, "pack.json");
  const manifest = {
    id: "custom", name: "测试头像", portrait: "face.jpg", portrait_dark: "night.png",
    states: { working: { video: "work.mp4", video_dark: "work-dark.mp4" } },
    dances: [{ video: "work.mp4" }],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const create = (extra = {}) => {
    const store = createAssetStore({ storageDir, baseDir: input, ...extra });
    t.after(() => store.dispose());
    return store;
  };
  return { root, input, manifest, manifestPath, storageDir, create };
}

test("default pack has all eight static fallbacks without invented videos", (t) => {
  const { create } = fixture(t);
  const store = create();
  const { active, candidates, pending } = store.snapshot();
  assert.equal(active.id, "default");
  assert.deepEqual(Object.keys(active.states), ASSET_STATES);
  for (const state of Object.values(active.states)) {
    assert.equal(state.poster, active.portrait);
    assert.equal(state.video, undefined);
  }
  assert.equal(active.portrait_dark, undefined);
  assert.deepEqual(active.dances, []);
  assert.deepEqual(candidates, []);
  assert.equal(pending, false);
  assert.ok(store.media(active.portrait.slice(MEDIA_PREFIX.length)));
});

test("preview is inert; playback assets survive activation and restart, legacy dark fields are ignored", (t) => {
  const { create, manifestPath, input } = fixture(t);
  const store = create();
  const preview = store.preview({ manifestPath });
  assert.equal(store.active.id, "default");
  assert.equal(store.snapshot().candidates[0].id, preview.id);
  assert.equal(preview.pack.states.idle.poster, preview.pack.portrait);
  assert.equal(preview.pack.portrait_dark, undefined);
  assert.equal(preview.pack.states.working.poster_dark, undefined);
  assert.equal(preview.pack.states.working.video_dark, undefined);
  assert.equal(preview.pack.dances[0].video, preview.pack.states.working.video);
  assert.ok(!JSON.stringify(preview).includes(input));
  assert.equal(store.activate(preview.id).pack.id, "custom");
  const restarted = create();
  assert.equal(restarted.active.id, "custom");
  assert.deepEqual(restarted.active, store.active);
  assert.deepEqual(restarted.snapshot().candidates, []);
});

test("object manifests persist and candidates remain previewable after restart", (t) => {
  const { create, manifest } = fixture(t);
  const store = create();
  const preview = store.preview({ manifest });
  const restarted = create();
  assert.equal(restarted.snapshot().candidates[0].id, preview.id);
  assert.equal(restarted.activate(preview.id).pack.id, manifest.id);
  assert.equal(create().active.id, manifest.id);
});

test("configured manifest rereads references, disappears, and restores automatically", (t) => {
  const { create, manifestPath, manifest, input } = fixture(t);
  const store = create({ assetPack: manifestPath });
  assert.equal(store.active.id, "custom");
  fs.unlinkSync(path.join(input, "work.mp4"));
  let result = store.refresh();
  assert.equal(result.active.id, "custom");
  assert.equal(result.active.missingMedia, true);
  assert.equal(result.active.states.working.video, undefined);
  assert.equal(result.active.states.working.poster, result.active.portrait);
  assert.equal(result.pending, false);
  assert.match(result.error, /missing media/);
  fs.writeFileSync(path.join(input, "work.mp4"), "recovered");
  assert.equal(store.refresh().active.id, "custom");
  fs.unlinkSync(manifestPath);
  result = store.refresh();
  assert.equal(result.active.id, "default");
  assert.equal(result.pending, true);
  assert.ok(!result.error.includes(input));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, name: "恢复后的名字" }));
  result = store.refresh();
  assert.equal(result.active.name, "恢复后的名字");
  assert.equal(result.pending, false);
  assert.equal(result.error, undefined);
});

test("selected missing source keeps its persisted choice and heals on restart", (t) => {
  const { create, manifestPath, manifest } = fixture(t);
  const store = create();
  store.activate(store.preview({ manifestPath }).id);
  fs.unlinkSync(manifestPath);
  assert.equal(create().snapshot().pending, true);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(create().active.id, "custom");
});

test("corrupt manifest falls back, records error, and recovers without losing routes", (t) => {
  const { create, manifestPath, manifest } = fixture(t);
  const store = create({ assetPack: manifestPath });
  fs.writeFileSync(manifestPath, "{");
  assert.equal(store.refresh().active.id, "default");
  assert.match(store.snapshot().error, /Malformed/);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(store.refresh().active.id, "custom");
});

test("reset only clears managed selection and candidates; configured source stays untouched", (t) => {
  const { create, manifestPath, input } = fixture(t);
  const store = create({ assetPack: manifestPath });
  store.preview({ manifestPath });
  assert.equal(store.reset().pack.id, "default");
  assert.deepEqual(store.snapshot().candidates, []);
  assert.ok(fs.existsSync(manifestPath));
  assert.ok(fs.existsSync(path.join(input, "work.mp4")));
  assert.equal(create({ assetPack: manifestPath }).active.id, "default");
});

test("invalid sources, schemes, data types and oversized manifests are rejected", (t) => {
  const { create, manifestPath } = fixture(t);
  const store = create();
  for (const value of [null, [], "not-object", {}, { portrait: "javascript:alert(1)" },
    { portrait: "file:///etc/passwd" }, { portrait: "//host/image.jpg" },
    { portrait: "data:text/html;base64,PHNjcmlwdD4=" }, { portrait: "data:image/svg+xml;base64,PHN2Zz4=" },
    { portrait: "face.jpg", states: { working: { video: "face.jpg" } } },
    { portrait: "face.jpg", dances: {} },
  ]) assert.throws(() => store.preview({ manifest: value }));
  assert.throws(() => store.preview({ manifest: {}, manifestPath }), /exactly one/);
  assert.throws(() => store.preview({}), /exactly one/);
  assert.throws(() => store.preview({ manifestPath: "file:///etc/passwd" }), /local file/);
  assert.throws(() => store.preview({ manifest: { portrait: "face.jpg", name: "x".repeat(MAX_MANIFEST_BYTES) } }),
    (error) => error instanceof AssetError && error.statusCode === 413);
  assert.throws(() => store.activate("unknown"), (error) => error.statusCode === 404);
  assert.equal(store.active.id, "default");
});

test("generation pending keeps the active portrait; missing portrait falls back and restores", (t) => {
  const { create, manifestPath, manifest, input } = fixture(t);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, pending: true }));
  const store = create({ assetPack: manifestPath });
  assert.equal(store.active.id, "custom");
  assert.equal(store.snapshot().pending, true);
  assert.equal(store.snapshot().error, undefined);
  assert.ok(store.describeActive().manifest.pending);
  assert.equal(store.resolveMedia(store.active.portrait).path, path.join(input, "face.jpg"));
  fs.unlinkSync(path.join(input, "face.jpg"));
  assert.equal(store.refresh().active.id, "default");
  assert.equal(store.snapshot().pending, true);
  fs.writeFileSync(path.join(input, "face.jpg"), "restored");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(store.refresh().active.id, "custom");
  assert.equal(store.snapshot().pending, false);
});

test("HTTP(S) and allowed base64 media are accepted, missing local fields flag pending", () => {
  const pack = normalizeAssetPack({ portrait: "https://example.test/avatar.jpg",
    states: { working: { video: "http://example.test/work.mp4", poster: "data:image/png;base64,YQ==" } },
  });
  assert.equal(pack.portrait, "https://example.test/avatar.jpg");
  assert.equal(pack.states.working.poster, "data:image/png;base64,YQ==");
  assert.equal(pack.states.working.video, "http://example.test/work.mp4");
  assert.throws(() => normalizeAssetPack({ portrait: "https://user:pass@example.test/face.jpg" }), /credentials/);
  assert.equal(normalizeAssetPack({ portrait: "/missing/buddy/face.jpg" }).pending, true);
});

test("media lookup accepts only indexed IDs and snapshot mutations do not escape", (t) => {
  const { create, manifestPath } = fixture(t);
  const store = create();
  const preview = store.preview({ manifestPath });
  const key = preview.pack.states.working.video.slice(MEDIA_PREFIX.length);
  assert.equal(store.media(key).type, "video/mp4");
  assert.equal(store.media("../../etc/passwd"), undefined);
  assert.equal(store.media("/etc/passwd"), undefined);
  assert.equal(store.media("0".repeat(32)), undefined);
  const snap = store.snapshot();
  snap.active.id = "mutated";
  assert.equal(store.active.id, "default");
  store.reset();
  assert.equal(store.media(key), undefined);
  store.dispose();
  assert.throws(() => store.preview({ manifestPath }), /disposed/);
});
