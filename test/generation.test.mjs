import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { createGenerationService, GenerationError } from "../lib/generation.js";
import { createAssetStore } from "../lib/assets.js";

const KEY = "mock-only-secret-key-never-live";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const DATA = `data:image/png;base64,${PNG.toString("base64")}`;
const MP4 = Buffer.from("mock mp4 bytes");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const image = () => new Response(PNG, { headers: { "content-type": "image/png" } });
const movie = () => new Response(MP4, { headers: { "content-type": "video/mp4" } });
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
async function until(predicate, message = "condition", limit = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > limit) assert.fail(`Timed out waiting for ${message}`);
    await tick();
  }
}
async function finished(service, id) {
  await until(() => ["completed", "failed", "cancelled", "interrupted"].includes(service.snapshot().jobs.find((job) => job.id === id)?.status), "job completion");
  return service.snapshot().jobs.find((job) => job.id === id);
}
function mockProvider(override) {
  const calls = [];
  let portraits = 0;
  let videos = 0;
  const fetchImpl = async (url, options = {}) => {
    const call = { url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined, options };
    calls.push(call);
    const intercepted = await override?.(call, calls);
    if (intercepted !== undefined) return intercepted;
    if (url === "https://apihub.agnes-ai.com/v1/chat/completions") return json({ choices: [{ message: { content: "A friendly woman with silver hair, illustrated in watercolor." } }] });
    if (url === "https://apihub.agnes-ai.com/v1/images/generations") return json({ data: [{ url: `https://images.example.com/portrait-${++portraits}.png` }] });
    if (url.startsWith("https://images.example.com/")) return image();
    if (url === "https://apihub.agnes-ai.com/v1/videos") return json({ id: `video-${++videos}`, status: "queued" });
    if (url.startsWith("https://apihub.agnes-ai.com/v1/videos/")) {
      const id = url.split("/").pop();
      const fields = ["video_url", "url", "remixed_from_video_id"];
      return json({ status: "completed", [fields[Number(id.split("-").pop()) % 3]]: `https://videos.example.com/${id}.mp4` });
    }
    if (url.startsWith("https://videos.example.com/")) return movie();
    throw new Error(`Unexpected mock request: ${url}`);
  };
  return { fetchImpl, calls, images: () => calls.filter((call) => call.url.endsWith("/images/generations")), videos: () => calls.filter((call) => call.url.endsWith("/v1/videos")) };
}
function fixture(t, { provider = mockProvider(), apiKey = KEY, enabled = true, store: suppliedStore } = {}) {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-generation-"));
  const store = suppliedStore || createAssetStore({ storageDir });
  const service = createGenerationService({ store, storageDir, apiKey, enabled, fetchImpl: provider.fetchImpl, pollInterval: 0 });
  t.after(async () => {
    service.dispose();
    await tick();
    await tick();
    store.dispose?.();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });
  return { storageDir, store, service, provider, stateFile: path.join(storageDir, "generation.json") };
}
async function candidate(f, prompt = "A friendly portrait") {
  const { id } = f.service.start({ mode: "create", prompt, count: 1 });
  const job = await finished(f.service, id);
  assert.equal(job.status, "completed", JSON.stringify(job));
  return job.candidateIds[0];
}
function manifestFor(f, candidateId) {
  const record = read(f.stateFile).records.find((entry) => entry.candidateId === candidateId);
  return { record, manifest: read(record.manifestPath) };
}

test("generation is optional, keys stay private, environment aliases are supported", async (t) => {
  const disabled = fixture(t, { enabled: false });
  assert.equal(disabled.service.snapshot().available, false);
  assert.throws(() => disabled.service.start({ mode: "create", prompt: "Portrait" }), (error) => error instanceof GenerationError && error.statusCode === 503);
  const missing = fixture(t, { apiKey: "" });
  assert.equal(missing.service.snapshot().available, false);
  assert.throws(() => missing.service.start({ mode: "create", prompt: "Portrait" }), /missing an API key/);
  const env = ["AGNES_API_KEY", "AGNES_API_TOKEN", "APIHUB_AGNES_API_KEY"];
  const old = Object.fromEntries(env.map((name) => [name, process.env[name]]));
  try {
    for (const name of env) delete process.env[name];
    for (const name of env) {
      process.env[name] = KEY;
      const service = createGenerationService({ store: disabled.store, storageDir: disabled.storageDir, enabled: true, fetchImpl: disabled.provider.fetchImpl });
      assert.equal(service.snapshot().available, true);
      assert.equal(JSON.stringify(service.snapshot()).includes(KEY), false);
      service.dispose();
      delete process.env[name];
    }
  } finally {
    for (const name of env) { if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name]; }
  }
  assert.equal(disabled.provider.calls.length + missing.provider.calls.length, 0);
});

test("create translates Chinese once, sends three independent image requests and previews without activation", async (t) => {
  const f = fixture(t);
  const before = f.store.snapshot().active;
  const { id } = f.service.start({ mode: "create", prompt: "银发、水彩风的温柔女性", name: "我的水彩头像" });
  assert.equal(f.provider.calls.length, 0, "HTTP work is deferred until after start returns");
  assert.equal(f.service.snapshot().jobs[0].status, "queued");
  const job = await finished(f.service, id);
  assert.equal(job.status, "completed");
  assert.deepEqual(job.progress, { completed: 3, total: 3 });
  assert.equal(f.provider.calls.filter((call) => call.url.endsWith("/chat/completions")).length, 1);
  const translation = f.provider.calls[0].body;
  assert.equal(translation.model, "agnes-2.0-flash");
  assert.equal(translation.messages[1].content, "银发、水彩风的温柔女性");
  assert.equal(f.provider.images().length, 3);
  for (const call of f.provider.images()) {
    assert.equal(call.body.model, "agnes-image-2.1-flash");
    assert.equal(call.body.size, "1024x1024");
    assert.deepEqual(call.body.extra_body, { image: [], response_format: "url" });
    assert.match(call.body.prompt, /independent main portrait/);
    assert.match(call.body.prompt, /silver hair/);
    assert.doesNotMatch(call.body.prompt, /[\u3400-\u9fff]/);
    assert.equal(call.options.headers.Authorization, `Bearer ${KEY}`);
  }
  assert.equal(f.store.snapshot().candidates.length, 3);
  assert.equal(f.store.snapshot().active.id, before.id);
  for (const candidateId of job.candidateIds) {
    const { record, manifest } = manifestFor(f, candidateId);
    assert.equal(path.dirname(record.manifestPath).startsWith(path.join(f.storageDir, "generated") + path.sep), true);
    assert.equal(manifest.name, "我的水彩头像");
    assert.equal(manifest.portrait, "portrait.png");
    assert.equal(manifest.providerPortraitURL, undefined);
    assert.equal(manifest.pending, false);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(record.manifestPath), "portrait.png")), PNG);
    assert.match(record.providerPortraitURL, /^https:\/\/images\.example\.com\//);
  }
  assert.equal(JSON.stringify(f.service.snapshot()).includes(KEY), false);
  assert.equal(JSON.stringify(f.service.snapshot()).includes("providerPortraitURL"), false);
  assert.equal(fs.readFileSync(f.stateFile, "utf8").includes(KEY), false);
});

test("provider JPEG and WebP portraits retain their MIME-compatible filenames", async (t) => {
  for (const [type, extension] of [["image/jpeg", "jpg"], ["image/webp", "webp"]]) {
    const f = fixture(t, { provider: mockProvider((call) => call.url.startsWith("https://images.example.com/")
      ? new Response(PNG, { headers: { "content-type": type } }) : undefined) });
    const id = await candidate(f);
    const { manifest, record } = manifestFor(f, id);
    assert.equal(manifest.portrait, `portrait.${extension}`);
    const pack = f.store.snapshot().candidates.find((entry) => entry.id === id).pack;
    assert.equal(f.store.resolveMedia(pack.portrait).type, type);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(record.manifestPath), manifest.portrait)), PNG);
  }
});

test("jobs execute serially and start rejects invalid counts and prompts", async (t) => {
  let release;
  let imageRequests = 0;
  const provider = mockProvider(async (call) => {
    if (call.url.endsWith("/images/generations") && ++imageRequests === 1) {
      await new Promise((resolve) => { release = resolve; });
    }
  });
  const f = fixture(t, { provider });
  for (const count of [0, 4, 1.5, "2"]) assert.throws(() => f.service.start({ mode: "create", prompt: "Portrait", count }), /between 1 and 3/);
  assert.throws(() => f.service.start({ mode: "create", prompt: " " }), /prompt is required/);
  const first = f.service.start({ mode: "create", prompt: "First", count: 1 });
  const second = f.service.start({ mode: "create", prompt: "Second", count: 1 });
  await until(() => release, "first image request");
  assert.equal(f.service.snapshot().jobs[0].status, "running");
  assert.equal(f.service.snapshot().jobs[1].status, "queued");
  assert.equal(provider.images().length, 1);
  release();
  assert.equal((await finished(f.service, first.id)).status, "completed");
  assert.equal((await finished(f.service, second.id)).status, "completed");
  assert.equal(provider.images().length, 2);
});

test("restyle reuses private original URLs for candidate IDs and the active generated portrait", async (t) => {
  const f = fixture(t);
  const original = await candidate(f);
  const source = manifestFor(f, original).record.providerPortraitURL;
  for (const input of [{ reference: original }, { candidateId: original }]) {
    const { id } = f.service.start({ mode: "restyle", prompt: "Use charcoal shading", ...input });
    const job = await finished(f.service, id);
    assert.equal(job.status, "completed");
    assert.equal(job.candidateIds.length, 1);
    const call = f.provider.images().at(-1);
    assert.deepEqual(call.body.extra_body.image, [source]);
    assert.match(call.body.prompt, /identity and face exactly identical/);
    assert.doesNotMatch(JSON.stringify(call.body), /dsh-typing-buddy\/media/);
  }
  f.store.activate(original);
  const { id } = f.service.start({ mode: "restyle", prompt: "Use pastel colors" });
  assert.equal((await finished(f.service, id)).status, "completed");
  assert.deepEqual(f.provider.images().at(-1).body.extra_body.image, [source]);
});

test("restyle accepts data images, verifies HTTPS references, and reads current local assets through store capabilities", async (t) => {
  const f = fixture(t);
  for (const reference of [DATA, "https://images.example.com/reference.png"]) {
    const { id } = f.service.start({ mode: "restyle", prompt: "A pen drawing", reference });
    assert.equal((await finished(f.service, id)).status, "completed");
    assert.deepEqual(f.provider.images().at(-1).body.extra_body.image, [DATA]);
  }
  // The bundled active portrait is a local media capability, not a URL sent to Agnes.
  const { id } = f.service.start({ mode: "restyle", prompt: "A graphite sketch" });
  assert.equal((await finished(f.service, id)).status, "completed");
  assert.match(f.provider.images().at(-1).body.extra_body.image[0], /^data:image\/jpeg;base64,/);
  assert.equal(f.provider.calls.some((call) => /localhost|127\.0\.0\.1|\/dsh-typing-buddy\/media\//.test(call.url)), false);
});

test("reference validation rejects filesystem and local URLs, bad data and images above 8 MB", async (t) => {
  const f = fixture(t);
  for (const reference of ["file:///etc/passwd", "/tmp/a.png", "http://127.0.0.1/a.png", "http://images.example.com/a.png", "https://localhost/a.png", "https://10.0.0.1/a.png", "https://192.168.1.1/a.png", "https://[::1]/a.png", "https://user:pass@images.example.com/a.png", "data:text/plain;base64,YQ==", "data:image/svg+xml;base64,YQ==", "data:image/png;base64,%%%="]) {
    assert.throws(() => f.service.start({ mode: "restyle", prompt: "A portrait", reference }), GenerationError);
  }
  assert.throws(() => f.service.start({ mode: "restyle", prompt: "A portrait", reference: `data:image/png;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")}` }), (error) => error.statusCode === 413);
  assert.throws(() => f.service.start({ mode: "restyle", prompt: "A portrait", candidateId: "missing" }), (error) => error.statusCode === 404);
  assert.equal(f.provider.calls.length, 0);
  const oversized = fixture(t, { provider: mockProvider((call) => {
    if (call.url === "https://images.example.com/large.png") return new Response(PNG, { headers: { "content-type": "image/png", "content-length": String(8 * 1024 * 1024 + 1) } });
  }) });
  const { id } = oversized.service.start({ mode: "restyle", prompt: "A portrait", reference: "https://images.example.com/large.png" });
  const job = await finished(oversized.service, id);
  assert.equal(job.status, "failed");
  assert.equal(job.error.status, 413);
  assert.equal(oversized.provider.images().length, 0);
});

test("animation requires activation and independently creates five videos from the same main portrait", async (t) => {
  let release;
  let pause = true;
  const provider = mockProvider(async (call) => {
    if (pause && call.url.includes("/v1/videos/")) {
      pause = false;
      await new Promise((resolve) => { release = resolve; });
    }
  });
  const f = fixture(t, { provider });
  const candidateId = await candidate(f);
  assert.throws(() => f.service.start({ mode: "animate", candidateId }), (error) => error.statusCode === 409);
  f.store.activate(candidateId);
  const source = manifestFor(f, candidateId).record.providerPortraitURL;
  const { id } = f.service.start({ mode: "animate", prompt: "表情温柔", candidateId });
  await until(() => release, "first video poll");
  assert.equal(manifestFor(f, candidateId).manifest.pending, true);
  assert.equal(f.store.snapshot().active.pending, true);
  assert.equal(f.store.snapshot().active.id, manifestFor(f, candidateId).record.packId);
  assert.equal(manifestFor(f, candidateId).manifest.states.generating.video, undefined);
  release();
  const job = await finished(f.service, id);
  assert.equal(job.status, "completed", JSON.stringify(job));
  assert.deepEqual(job.progress, { completed: 5, total: 5 });
  assert.equal(provider.videos().length, 5);
  for (const call of provider.videos()) {
    assert.equal(call.body.model, "agnes-video-v2.0");
    assert.equal(call.body.image, source);
    assert.equal(call.body.mode, "ti2vid");
    assert.equal(call.body.width, 768);
    assert.equal(call.body.height, 768);
    assert.equal(call.body.num_frames, 81);
    assert.equal(call.body.frame_rate, 24);
    assert.match(call.body.prompt, /Face exactly identical to reference/);
    assert.match(call.body.prompt, /visible eyes and mouth/);
    assert.match(call.body.prompt, /white background/);
    assert.match(call.body.prompt, /fixed camera, silent, no audio/);
    assert.doesNotMatch(call.body.prompt, /[\u3400-\u9fff]/);
  }
  const { manifest, record } = manifestFor(f, candidateId);
  assert.equal(manifest.pending, false);
  assert.equal(manifest.states.connecting.video, manifest.states.idle.video);
  assert.equal(manifest.states.waiting_for_subagents.video, manifest.states.working.video);
  assert.equal(manifest.dances[0].video, manifest.states.dancing.video);
  assert.deepEqual(manifest.states.generating, { poster: "portrait.png" });
  for (const state of ["idle", "working", "making_something", "milestone_level_up", "dancing"]) {
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(record.manifestPath), manifest.states[state].video)), MP4);
  }
  assert.equal(f.store.snapshot().active.pending, undefined);
});

test("dark animation generates another five segments, using the same portrait and aliases", async (t) => {
  const f = fixture(t);
  const candidateId = await candidate(f);
  f.store.activate(candidateId);
  const { id } = f.service.start({ mode: "animate", candidateId: "active", dark: true });
  assert.equal((await finished(f.service, id)).status, "completed");
  assert.equal(f.provider.videos().length, 10);
  assert.equal(new Set(f.provider.videos().map((call) => call.body.image)).size, 1);
  const { manifest } = manifestFor(f, candidateId);
  assert.match(manifest.states.idle.video_dark, /-dark\.mp4$/);
  assert.equal(manifest.states.connecting.video_dark, manifest.states.idle.video_dark);
  assert.equal(manifest.states.waiting_for_subagents.video_dark, manifest.states.working.video_dark);
  assert.equal(manifest.dances[0].video_dark, manifest.states.dancing.video_dark);
});

test("provider failures expose only status and fixed messages, and do not stop later jobs", async (t) => {
  let fail = true;
  const f = fixture(t, { provider: mockProvider((call) => {
    if (fail && call.url.endsWith("/images/generations")) {
      fail = false;
      return json({ error: { message: `${KEY}: confidential provider body` } }, 503);
    }
  }) });
  const first = f.service.start({ mode: "create", prompt: "Portrait", count: 1 });
  const next = f.service.start({ mode: "create", prompt: "Another portrait", count: 1 });
  const failed = await finished(f.service, first.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.status, 503);
  assert.equal(failed.retryable, true);
  assert.equal((await finished(f.service, next.id)).status, "completed");
  assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /mock-only-secret|confidential/);
  assert.doesNotMatch(fs.readFileSync(f.stateFile, "utf8"), /mock-only-secret|confidential/);
});

test("failed animation preserves ready media and explicit retry skips paid completed states", async (t) => {
  let fail = true;
  let polls = 0;
  const f = fixture(t, { provider: mockProvider((call) => {
    if (call.url.includes("/v1/videos/") && ++polls === 2 && fail) {
      fail = false;
      return json({ status: "failed", error: { message: KEY } });
    }
  }) });
  const candidateId = await candidate(f);
  f.store.activate(candidateId);
  const { id } = f.service.start({ mode: "animate", candidateId });
  const failed = await finished(f.service, id);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.progress, { completed: 1, total: 5 });
  assert.equal(manifestFor(f, candidateId).manifest.pending, false);
  assert.equal(manifestFor(f, candidateId).manifest.states.idle.video, "idle.mp4");
  assert.equal(manifestFor(f, candidateId).manifest.states.working, undefined);
  const before = f.provider.videos().length;
  const retry = f.service.start({ retryJobId: id });
  const completed = await finished(f.service, retry.id);
  assert.equal(completed.status, "completed", JSON.stringify(completed));
  assert.deepEqual(completed.progress, { completed: 5, total: 5 });
  assert.equal(completed.retryOf, id);
  assert.equal(f.provider.videos().length - before, 4);
  assert.throws(() => f.service.start({ retryJobId: retry.id }), (error) => error.statusCode === 409);
});

test("dispose aborts polling, clears pending and never starts queued work", async (t) => {
  let polling = false;
  let aborted = false;
  const f = fixture(t, { provider: mockProvider(async (call) => {
    if (call.url.includes("/v1/videos/")) {
      polling = true;
      return await new Promise((resolve, reject) => {
        call.options.signal.addEventListener("abort", () => { aborted = true; const error = new Error("mock abort"); error.name = "AbortError"; reject(error); }, { once: true });
      });
    }
  }) });
  const candidateId = await candidate(f);
  f.store.activate(candidateId);
  const animate = f.service.start({ mode: "animate", candidateId });
  const queued = f.service.start({ mode: "create", prompt: "Queued portrait", count: 1 });
  await until(() => polling);
  f.service.dispose();
  await until(() => aborted && manifestFor(f, candidateId).manifest.pending === false);
  assert.equal((await finished(f.service, animate.id)).status, "cancelled");
  assert.equal((await finished(f.service, queued.id)).status, "cancelled");
  assert.equal(f.provider.images().length, 1);
  assert.equal(f.provider.videos().length, 1);
  assert.throws(() => f.service.start({ mode: "create", prompt: "No more" }), (error) => error.statusCode === 503);
});

test("restart marks unfinished jobs interrupted without requests and keeps private references for retry", async (t) => {
  const f = fixture(t);
  const candidateId = await candidate(f);
  const { id } = f.service.start({ mode: "restyle", prompt: "Ink portrait", reference: candidateId });
  assert.equal((await finished(f.service, id)).status, "completed");
  f.service.dispose();
  const state = read(f.stateFile);
  const prior = state.jobs.find((job) => job.id === id);
  prior.status = "running";
  prior.progress.completed = 0;
  prior.candidateIds = [];
  fs.writeFileSync(f.stateFile, JSON.stringify(state));
  const calls = f.provider.calls.length;
  const restored = createGenerationService({ store: f.store, storageDir: f.storageDir, apiKey: KEY, enabled: true, fetchImpl: f.provider.fetchImpl, pollInterval: 0 });
  t.after(() => restored.dispose());
  await tick();
  assert.equal(f.provider.calls.length, calls);
  assert.equal(restored.snapshot().jobs.find((job) => job.id === id).status, "interrupted");
  assert.equal(read(f.stateFile).jobs.find((job) => job.id === id).status, "interrupted");
  const retried = restored.start({ retryJobId: id });
  assert.equal((await finished(restored, retried.id)).status, "completed");
  assert.deepEqual(f.provider.images().at(-1).body.extra_body.image, [manifestFor(f, candidateId).record.providerPortraitURL]);
});

test("download limits apply to both declared size and streamed data; arrayBuffer fallback works", async (t) => {
  let oversized = true;
  const f = fixture(t, { provider: mockProvider((call) => {
    if (call.url.startsWith("https://videos.example.com/")) {
      if (oversized) {
        oversized = false;
        return { ok: true, headers: new Headers({ "content-type": "video/mp4" }),
          body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(64 * 1024 * 1024 + 1)); controller.close(); } }) };
      }
      return { ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: async () => MP4.buffer.slice(MP4.byteOffset, MP4.byteOffset + MP4.byteLength) };
    }
  }) });
  const candidateId = await candidate(f);
  f.store.activate(candidateId);
  const first = f.service.start({ mode: "animate", candidateId });
  const failed = await finished(f.service, first.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.status, 413);
  assert.equal(manifestFor(f, candidateId).manifest.states.idle, undefined);
  const retry = f.service.start({ retryJobId: first.id });
  assert.equal((await finished(f.service, retry.id)).status, "completed");
});

test("create can use an uploaded reference or an existing candidate without activating it", async (t) => {
  const f = fixture(t);
  const original = await candidate(f);
  const before = f.store.snapshot().active.id;
  for (const reference of [DATA, original]) {
    const { id } = f.service.start({ mode: "create", prompt: "Create a watercolor portrait", reference, count: 2 });
    assert.equal((await finished(f.service, id)).status, "completed");
    const expected = reference === DATA ? DATA : manifestFor(f, original).record.providerPortraitURL;
    assert.deepEqual(f.provider.images().at(-1).body.extra_body.image, [expected]);
    assert.equal(f.store.snapshot().active.id, before);
  }
});

test("animating an already-active external pack copies a managed manifest and preserves the same portrait and dark posters", async (t) => {
  const f = fixture(t);
  const external = path.join(f.storageDir, "external");
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "main.png"), PNG);
  fs.writeFileSync(path.join(external, "night.png"), PNG);
  const raw = { id: "external-active", name: "Existing", portrait: "main.png", portrait_dark: "night.png",
    states: { idle: { poster: "main.png", poster_dark: "night.png" } }, dances: [{ poster: "main.png", poster_dark: "night.png" }] };
  const originalFile = path.join(external, "manifest.json");
  fs.writeFileSync(originalFile, JSON.stringify(raw));
  const preview = f.store.preview({ manifestPath: originalFile });
  f.store.activate(preview.id);
  const before = f.store.snapshot().active.portrait;
  const { id } = f.service.start({ mode: "animate", candidateId: "active" });
  const job = await finished(f.service, id);
  assert.equal(job.status, "completed", JSON.stringify(job));
  assert.equal(f.store.snapshot().active.id, raw.id);
  assert.equal(f.store.snapshot().active.portrait, before);
  assert.deepEqual(read(originalFile), raw, "the external source is untouched");
  const managed = read(f.stateFile).records.find((record) => record.packId === raw.id);
  assert.equal(read(managed.manifestPath).states.idle.poster_dark, path.join(external, "night.png"));
  assert.deepEqual(new Set(f.provider.videos().map((call) => call.body.image)), new Set([DATA]));
});

test("retry locks the original active pack and onChange emits only public snapshots", async (t) => {
  const f = fixture(t, { provider: mockProvider((call) => call.url.endsWith("/v1/videos") ? json({ error: KEY }, 500) : undefined) });
  const first = await candidate(f);
  const second = await candidate(f, "Another person");
  f.store.activate(first);
  const { id } = f.service.start({ mode: "animate", candidateId: "active" });
  assert.equal((await finished(f.service, id)).status, "failed");
  f.store.activate(second);
  const calls = f.provider.calls.length;
  assert.throws(() => f.service.start({ retryJobId: id }), (error) => error.statusCode === 409);
  assert.equal(f.provider.calls.length, calls);
  f.service.dispose();
  const changes = [];
  const service = createGenerationService({ store: f.store, storageDir: f.storageDir, apiKey: KEY, enabled: true,
    fetchImpl: f.provider.fetchImpl, onChange: (state) => { changes.push(state); } });
  t.after(() => service.dispose());
  const next = service.start({ mode: "create", count: 1, prompt: "New portrait" });
  assert.equal(changes.at(-1).jobs.at(-1).status, "queued");
  await finished(service, next.id);
  assert.equal(changes.some((state) => state.jobs.at(-1).status === "running"), true);
  assert.equal(changes.at(-1).jobs.at(-1).status, "completed");
  assert.equal(JSON.stringify(changes).includes(KEY), false);
  assert.equal(JSON.stringify(changes).includes(f.storageDir), false);
});

test("image retries pin the first resolved identity even after the active portrait changes", async (t) => {
  for (const mode of ["restyle", "create"]) {
    let failNext = false;
    const f = fixture(t, { provider: mockProvider((call) => {
      if (failNext && call.url.endsWith("/images/generations")) {
        failNext = false;
        return json({ error: "mock failure" }, 503);
      }
    }) });
    const original = await candidate(f);
    const other = await candidate(f, "A different person");
    f.store.activate(original);
    const source = manifestFor(f, original).record.providerPortraitURL;
    failNext = true;
    const job = f.service.start({ mode, prompt: "Use a pencil style", reference: "active", count: 1 });
    assert.equal((await finished(f.service, job.id)).status, "failed");
    assert.deepEqual(f.provider.images().at(-1).body.extra_body.image, [source]);
    f.store.activate(other);
    const retry = f.service.start({ retryJobId: job.id });
    assert.equal((await finished(f.service, retry.id)).status, "completed");
    assert.deepEqual(f.provider.images().at(-1).body.extra_body.image, [source]);
    assert.equal(JSON.stringify(f.service.snapshot()).includes("resolvedReference"), false);
    assert.equal(read(f.stateFile).jobs.find((entry) => entry.id === retry.id).resolvedReference, source);
  }
});

test("each provider request times out rather than leaving a job running indefinitely", async (t) => {
  const originalTimer = globalThis.setTimeout;
  const f = fixture(t, { provider: mockProvider(async (call) => {
    if (call.url.endsWith("/images/generations")) {
      return await new Promise((resolve, reject) => call.options.signal.addEventListener("abort", () => reject(new Error("aborted mock request")), { once: true }));
    }
  }) });
  // Accelerate only the service's 120-second request timer; no real provider is contacted.
  globalThis.setTimeout = (handler, delay, ...args) => originalTimer(handler, delay === 120000 ? 5 : delay, ...args);
  try {
    const { id } = f.service.start({ mode: "create", count: 1, prompt: "Portrait" });
    const job = await finished(f.service, id);
    assert.equal(job.status, "failed");
    assert.equal(job.error.status, 504);
    assert.match(job.error.message, /timed out/);
  } finally { globalThis.setTimeout = originalTimer; }
});

test("video polling has a twenty-minute overall deadline independently of individual HTTP requests", async (t) => {
  const originalTimer = globalThis.setTimeout;
  const f = fixture(t, { provider: mockProvider(async (call) => {
    if (call.url.includes("/v1/videos/")) {
      return await new Promise((resolve, reject) => call.options.signal.addEventListener("abort", () => reject(new Error("aborted mock poll")), { once: true }));
    }
  }) });
  const candidateId = await candidate(f);
  f.store.activate(candidateId);
  globalThis.setTimeout = (handler, delay, ...args) => originalTimer(handler, delay === 20 * 60 * 1000 ? 5 : delay, ...args);
  try {
    const { id } = f.service.start({ mode: "animate", candidateId });
    const job = await finished(f.service, id);
    assert.equal(job.status, "failed");
    assert.equal(job.error.status, 504);
    assert.match(job.error.message, /20 minutes/);
    assert.equal(manifestFor(f, candidateId).manifest.pending, false);
  } finally { globalThis.setTimeout = originalTimer; }
});

test("clear waits for cancellation, deletes only registered generated directories and allows future jobs", async (t) => {
  let polling = false;
  const f = fixture(t, { provider: mockProvider(async (call) => {
    if (call.url.includes("/v1/videos/")) {
      polling = true;
      return await new Promise((resolve, reject) => call.options.signal.addEventListener("abort", () => reject(new Error("mock abort")), { once: true }));
    }
  }) });
  const candidateId = await candidate(f);
  const managed = manifestFor(f, candidateId).record.manifestPath;
  const imported = path.join(f.storageDir, "imported.json");
  fs.writeFileSync(imported, JSON.stringify({ portrait: "keep my original" }));
  const unrelated = path.join(f.storageDir, "generated", "unrelated");
  fs.mkdirSync(unrelated);
  fs.writeFileSync(path.join(unrelated, "keep.txt"), "unregistered directory");
  f.store.activate(candidateId);
  f.service.start({ mode: "animate", candidateId });
  f.service.start({ mode: "create", count: 1, prompt: "Queued" });
  await until(() => polling);
  const clearing = f.service.clear();
  assert.throws(() => f.service.start({ mode: "create", prompt: "During clear" }), (error) => error.statusCode === 409);
  assert.equal(f.service.clear(), clearing, "concurrent clears join the same cancellation");
  await clearing;
  await tick();
  assert.equal(fs.existsSync(managed), false, "animate finally did not recreate a deleted manifest");
  assert.deepEqual(read(imported), { portrait: "keep my original" });
  assert.equal(fs.readFileSync(path.join(unrelated, "keep.txt"), "utf8"), "unregistered directory");
  assert.deepEqual(f.service.snapshot().jobs, []);
  assert.deepEqual(read(f.stateFile).records, []);
  assert.deepEqual(read(f.stateFile).managedDirectories, []);
  assert.equal(f.provider.videos().length, 1);
  assert.equal(f.provider.images().length, 1);
  // The host clears asset candidates after generation cancellation/removal.
  f.store.reset();
  const next = f.service.start({ mode: "create", count: 1, prompt: "Fresh portrait" });
  assert.equal((await finished(f.service, next.id)).status, "completed");
});

test("disabled generation can clear and migrated external sources survive clearing", async (t) => {
  const disabled = fixture(t, { enabled: false });
  assert.deepEqual((await disabled.service.clear()).jobs, []);
  assert.equal(disabled.service.snapshot().available, false);
  const f = fixture(t);
  const directory = path.join(f.storageDir, "original-pack");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "original.png"), PNG);
  const original = path.join(directory, "manifest.json");
  fs.writeFileSync(original, JSON.stringify({ id: "keep-external", portrait: "original.png" }));
  f.store.activate(f.store.preview({ manifestPath: original }).id);
  const job = f.service.start({ mode: "animate", candidateId: "active" });
  assert.equal((await finished(f.service, job.id)).status, "completed");
  const managed = read(f.stateFile).records[0].manifestPath;
  await f.service.clear();
  assert.equal(fs.existsSync(managed), false);
  assert.equal(fs.existsSync(original), true);
  assert.deepEqual(fs.readFileSync(path.join(directory, "original.png")), PNG);
});

test("only the newest twenty jobs persist and restored completed jobs never run automatically", async (t) => {
  const f = fixture(t);
  // Failed jobs avoid the independent asset store's twenty-candidate cap.
  const provider = mockProvider((call) => call.url.endsWith("/images/generations") ? json({ error: "mock" }, 500) : undefined);
  f.service.dispose();
  const service = createGenerationService({ store: f.store, storageDir: f.storageDir, apiKey: KEY, enabled: true, fetchImpl: provider.fetchImpl, pollInterval: 0 });
  t.after(() => service.dispose());
  let first;
  for (let index = 0; index < 23; index++) {
    const { id } = service.start({ mode: "create", prompt: `Portrait ${index}`, count: 1 });
    first ||= id;
    assert.equal((await finished(service, id)).status, "failed");
  }
  assert.equal(service.snapshot().jobs.length, 20);
  assert.equal(read(f.stateFile).jobs.length, 20);
  assert.equal(service.snapshot().jobs.some((job) => job.id === first), false);
  service.dispose();
  const restored = createGenerationService({ store: f.store, storageDir: f.storageDir, apiKey: KEY, enabled: true, fetchImpl: provider.fetchImpl });
  const calls = provider.calls.length;
  await tick();
  assert.equal(provider.calls.length, calls);
  restored.dispose();
});
