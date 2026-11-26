import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { apply, inject, name, DEFAULTS, normalizeConfig, parseRange } from "../lib/index.js";

async function fixture(t, config = {}, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-host-"));
  const storageDir = path.join(root, "managed");
  const routes = new Map();
  const listeners = new Map();
  const cleanups = [];
  let disposedRoutes = 0;
  let disposedListeners = 0;
  const connection = {
    requestRejection(req) { return req.headers["x-test-owner"] ? undefined : 401; },
    admit(req) { return { peer: { principal: { kind: req.headers["x-test-owner"] === "owner" ? "owner" : "member" } } }; },
  };
  const web = {
    protocol: "http:",
    register(spec) {
      assert.ok(!routes.has(spec.path), `Duplicate route ${spec.path}`);
      routes.set(spec.path, spec);
      return () => { disposedRoutes++; routes.delete(spec.path); };
    },
  };
  const ctx = {
    on(event, handler) {
      assert.ok(!listeners.has(event), `Duplicate listener ${event}`);
      listeners.set(event, handler);
      return () => { disposedListeners++; listeners.delete(event); };
    },
    get(key) {
      return { webServer: web, connection: options.noAuth ? undefined : connection,
        agents: { list: () => options.initialAgents || [] } }[key];
    },
    effect(factory) { cleanups.push(factory()); },
  };
  options.setup?.(root, storageDir);
  const plugin = apply(ctx, { storageDir, minStateDuration: 0, randomWorkVisuals: false, ...config });
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const spec = routes.get(pathname) || [...routes.values()].find((entry) => entry.kind === "prefix" && pathname.startsWith(entry.path));
    if (!spec) { res.writeHead(404); res.end(); return; }
    Promise.resolve(spec.handler(req, res)).catch((error) => { res.writeHead(500); res.end(error.message); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, init = {}) => fetch(`${base}${url}`, { ...init, headers: { "x-test-owner": "owner", ...init.headers } });
  const post = (suffix, body, headers = {}) => request(`/dsh-typing-buddy${suffix}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base, ...headers }, body: JSON.stringify(body),
  });
  t.after(async () => {
    plugin.dispose();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, storageDir, routes, listeners, cleanups, plugin, base, request, post,
    disposed: () => ({ routes: disposedRoutes, listeners: disposedListeners }) };
}
const configPath = "/dsh-typing-buddy/config.json";
const statusPath = "/dsh-typing-buddy/status.json";

test("config defaults and migration preserve supported UI settings", () => {
  assert.equal(name, "dsh-typing-buddy");
  assert.deepEqual(inject, []);
  assert.equal(DEFAULTS.size, 110);
  assert.equal(DEFAULTS.pillPadding, 6);
  assert.equal(DEFAULTS.minStateDuration, 1500);
  assert.equal(DEFAULTS.desktopEnabled, true);
  assert.equal(DEFAULTS.name, "小鲸鱼");
  assert.equal(DEFAULTS.idleLabel, "");
  assert.equal(DEFAULTS.theme, "auto");
  assert.equal(DEFAULTS.beacon, true);
  const config = normalizeConfig({ textIdle: "旧名字", size: 999, pillPadding: 0, offsetX: 0,
    theme: "no-theme", position: "bad", textMulti: "思考 · {n}", respectReducedMotion: false });
  assert.equal(config.name, "旧名字");
  assert.equal(config.textIdle, "旧名字");
  assert.equal(config.size, 256);
  assert.equal(normalizeConfig({ size: -1 }).size, 16);
  assert.equal(config.pillPadding, 2);
  assert.equal(config.offsetX, 0);
  assert.equal(config.theme, "auto");
  assert.equal(config.position, "top-right");
  assert.equal(config.textMulti, "思考·{n}");
  assert.equal(config.respectReducedMotion, false);
});

test("host mounts routes, authenticates, and strips all host paths from config", async (t) => {
  const f = await fixture(t, { avatar: "/missing/private/portrait.jpg", assetPack: "/missing/private/pack.json" });
  const result = await f.request(configPath);
  assert.equal(result.status, 200);
  const config = await result.json();
  assert.equal(config.version, "0.2.0");
  assert.equal(config.size, 110);
  assert.equal(config.assetPackUrl, "/dsh-typing-buddy/asset-pack.json");
  for (const key of ["avatar", "assetPack", "storageDir"]) assert.equal(config[key], undefined);
  assert.ok(!JSON.stringify(config).includes(f.root));
  assert.ok(!JSON.stringify(config).includes("/missing/private"));
  assert.equal((await fetch(`${f.base}${configPath}`)).status, 401);
  assert.equal((await f.request(configPath, { headers: { "x-test-owner": "member" } })).status, 403);
  assert.equal((await f.request(configPath, { method: "PUT" })).status, 405);
  assert.equal((await f.request("/dsh-typing-buddy/avatar", { method: "HEAD" })).headers.get("content-type"), "image/jpeg");
  assert.equal((await f.request("/dsh-typing-buddy/packs")).status, 200);
  assert.equal((await f.request("/dsh-typing-buddy/packs")).headers.get("access-control-allow-origin"), null);
  assert.ok(!f.listeners.has("agent-event"));
});

test("missing host authentication fails closed", async (t) => {
  const f = await fixture(t, {}, { noAuth: true });
  assert.equal((await f.request(configPath)).status, 503);
});

test("status events write complete atomic desktop snapshots and bounded history", async (t) => {
  const f = await fixture(t, { turnCelebration: false }, { initialAgents: [{ id: "existing", status: "running" }] });
  let status = await (await f.request(statusPath)).json();
  assert.deepEqual(status.ids, ["existing"]);
  f.listeners.get("api-session/status")("existing", false);
  f.listeners.get("api-session/status")("session-a", true);
  f.listeners.get("api-session/status")("session-b", true);
  status = JSON.parse(fs.readFileSync(path.join(f.storageDir, "dsh-status.json"), "utf8"));
  assert.equal(status.running, 2);
  assert.deepEqual(status.ids, ["session-a", "session-b"]);
  assert.equal(status.pid, process.pid);
  assert.equal(status.state, "working");
  assert.equal(typeof status.detail, "string");
  assert.equal(typeof status.label, "string");
  assert.equal(typeof status.ts, "number");
  assert.equal(status.connected, true);
  f.listeners.get("dsh-typing-buddy/activity")({ state: "making_something", detail: "artifact", sessionId: "session-a" });
  status = await (await f.request(statusPath)).json();
  assert.equal(status.state, "making_something");
  assert.ok(status.history.length > 0 && status.history.length <= 30);
  f.listeners.get("api-session/status")("session-a", false);
  f.listeners.get("api-session/removed")("session-b");
  status = await (await f.request(statusPath)).json();
  assert.equal(status.running, 0);
  assert.equal(status.state, "idle");
  assert.deepEqual(fs.readdirSync(f.storageDir).filter((entry) => entry.endsWith(".tmp")), []);
});

test("desktop heartbeat timestamps advance while the activity timestamp remains stable", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.storageDir, "dsh-status.json");
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  const realNow = Date.now;
  try {
    Date.now = () => before.ts + 5000;
    f.plugin.refresh();
  } finally { Date.now = realNow; }
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.ts, before.ts + 5000);
  assert.equal(after.activityTs, before.activityTs);
  assert.equal((await (await f.request(statusPath)).json()).ts, before.activityTs);
});

test("canonical tool, PTC, background and goal events drive activity", async (t) => {
  const f = await fixture(t);
  const emit = (type, data) => f.listeners.get("session/event")({ id: "event-session" }, { type, data, time: Date.now(), seq: 1 });
  const status = async () => (await f.request(statusPath)).json();
  emit("tool/call", { callId: "write-1", name: "functions.write", arguments: '{"file_path":"x"}' });
  assert.equal((await status()).state, "making_something");
  emit("tool/result", { message: { toolCallId: "write-1" } });
  assert.equal((await status()).state, "working");
  emit("tool/ptc-dispatch-start", { subCallId: "ptc-1", name: "wait_agent", arguments: {} });
  assert.equal((await status()).state, "waiting_for_subagents");
  emit("tool/ptc-dispatch", { subCallId: "ptc-1" });
  assert.equal((await status()).state, "working");
  emit("job/registered", { jobId: "job-1" });
  assert.equal((await status()).background, 1);
  emit("job/settled", { jobId: "job-1" });
  assert.equal((await status()).background, 0);
  emit("goal/change", { operation: "complete" });
  assert.equal((await status()).state, "milestone_level_up");
});

test("pack preview/activation/reset enforce JSON, same-origin, and body limits", async (t) => {
  const generatedId = "11111111-1111-4111-8111-111111111111";
  const f = await fixture(t, {}, { setup(root, storageDir) {
    const generated = path.join(storageDir, "generated", generatedId);
    fs.mkdirSync(generated, { recursive: true });
    fs.writeFileSync(path.join(generated, "portrait.png"), "managed");
    fs.writeFileSync(path.join(storageDir, "generation.json"), JSON.stringify({
      version: 1, jobs: [], records: [], managedDirectories: [generated],
    }));
  } });
  const file = path.join(f.root, "portrait.jpg");
  fs.writeFileSync(file, "test-portrait");
  const manifestPath = path.join(f.root, "input.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ id: "host-pack", portrait: "portrait.jpg" }));
  assert.equal((await f.post("/packs/preview", { manifestPath }, { Origin: "https://other.test" })).status, 403);
  assert.equal((await f.post("/packs/preview", { manifestPath }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const invalid = await f.request("/dsh-typing-buddy/packs/preview", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Malformed/);
  assert.equal((await f.request("/dsh-typing-buddy/packs/preview", { method: "POST", body: "{}" })).status, 415);
  const oversized = await f.post("/packs/preview", { manifest: { portrait: file, name: "x".repeat(1024 * 1024) } });
  assert.equal(oversized.status, 413);
  const candidate = await (await f.post("/packs/preview", { manifestPath })).json();
  assert.equal(typeof candidate.id, "string");
  assert.equal(candidate.pack.id, "host-pack");
  assert.ok(!JSON.stringify(candidate).includes(f.root));
  assert.equal((await (await f.request("/dsh-typing-buddy/asset-pack.json")).json()).id, "default");
  assert.equal((await f.post("/packs/activate", { id: "missing" })).status, 404);
  const activated = await (await f.post("/packs/activate", { id: candidate.id })).json();
  assert.equal(activated.pack.id, "host-pack");
  assert.equal((await (await f.request("/dsh-typing-buddy/packs")).json()).active.id, "host-pack");
  const generated = path.join(f.storageDir, "generated", generatedId);
  const unmanaged = path.join(f.storageDir, "unmanaged.txt");
  fs.writeFileSync(unmanaged, "keep");
  assert.equal((await (await f.post("/packs/reset", {})).json()).pack.id, "default");
  assert.equal(fs.existsSync(generated), false);
  assert.ok(fs.existsSync(unmanaged));
  assert.ok(fs.existsSync(manifestPath));
  assert.ok(fs.existsSync(file));
});

test("pending activation enters generating while unconfirmed pending candidates stay idle", async (t) => {
  const f = await fixture(t);
  const portrait = path.join(f.root, "pending.jpg");
  fs.writeFileSync(portrait, "pending-portrait");
  const candidate = await (await f.post("/packs/preview", { manifest: { id: "pending-pack", portrait, pending: true } })).json();
  assert.equal((await (await f.request(statusPath)).json()).state, "idle");
  await f.post("/packs/activate", { id: candidate.id });
  let status = await (await f.request(statusPath)).json();
  assert.equal(status.state, "generating");
  assert.equal(status.assetPending, true);
  await f.post("/packs/reset", {});
  status = await (await f.request(statusPath)).json();
  assert.equal(status.state, "idle");
  assert.equal(status.assetPending, false);
});

test("generation endpoints default to disabled, keep metadata private, and allow image-sized JSON", async (t) => {
  const f = await fixture(t);
  const metadata = await (await f.request("/dsh-typing-buddy/generation.json")).json();
  assert.equal(metadata.available, false);
  assert.deepEqual(metadata.jobs, []);
  assert.equal(typeof metadata.models.image, "string");
  assert.ok(!JSON.stringify(metadata).includes(f.root));
  const config = await (await f.request(configPath)).json();
  assert.equal(config.generationEnabled, false);
  let response = await f.post("/generation", { mode: "create", prompt: "test" });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /disabled/);
  response = await f.post("/generation", { mode: "restyle", reference: "data:image/png;base64," + "YQ==".repeat(300000) });
  assert.equal(response.status, 503); // >1 MB is admitted by the generation body limit before feature validation.
  assert.equal((await f.post("/generation", {}, { Origin: "https://other.test" })).status, 403);
});

test("agent lifecycle provides status without the API-session bridge", async (t) => {
  const f = await fixture(t);
  f.listeners.get("agent/status")({ agent: { id: "native-agent" }, status: "running" });
  assert.deepEqual((await (await f.request(statusPath)).json()).ids, ["native-agent"]);
  f.listeners.get("agent/disposed")({ agent: { id: "native-agent" } });
  assert.equal((await (await f.request(statusPath)).json()).running, 0);
});

test("chunked oversized JSON receives a JSON 413 response", async (t) => {
  const f = await fixture(t);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(`${f.base}/dsh-typing-buddy/packs/preview`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": "owner" },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.once("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      res.once("error", reject);
    });
    req.once("error", reject);
    req.write('{"manifest":{"portrait":"https://example.test/a.jpg","name":"');
    req.write("x".repeat(700000));
    req.write("x".repeat(700000));
    req.end('"}}');
  });
  assert.equal(response.status, 413);
  assert.match(JSON.parse(response.body).error, /size limit/);
});

test("local video proxy supports byte ranges, suffixes, HEAD and unsatisfiable ranges", async (t) => {
  const f = await fixture(t);
  const portrait = path.join(f.root, "portrait.jpg");
  const video = path.join(f.root, "movie.mp4");
  fs.writeFileSync(portrait, "portrait");
  fs.writeFileSync(video, "0123456789abcdef");
  const candidate = await (await f.post("/packs/preview", { manifest: {
    id: "range-pack", portrait, states: { working: { video } },
  } })).json();
  const url = candidate.pack.states.working.video;
  let result = await f.request(url);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-type"), "video/mp4");
  assert.equal(await result.text(), "0123456789abcdef");
  result = await f.request(url, { headers: { Range: "bytes=2-5" } });
  assert.equal(result.status, 206);
  assert.equal(result.headers.get("content-range"), "bytes 2-5/16");
  assert.equal(await result.text(), "2345");
  result = await f.request(url, { headers: { Range: "bytes=-3" } });
  assert.equal(await result.text(), "def");
  result = await f.request(url, { headers: { Range: "bytes=14-" } });
  assert.equal(await result.text(), "ef");
  result = await f.request(url, { method: "HEAD", headers: { Range: "bytes=2-5" } });
  assert.equal(result.status, 206);
  assert.equal(result.headers.get("content-length"), "4");
  assert.equal(await result.text(), "");
  for (const range of ["bytes=20-30", "bytes=5-2", "bytes=-0", "bytes=0-1,4-5", "bad"]) {
    result = await f.request(url, { headers: { Range: range } });
    assert.equal(result.status, 416, range);
    assert.equal(result.headers.get("content-range"), "bytes */16");
  }
  assert.equal((await f.request("/dsh-typing-buddy/media/../../etc/passwd")).status, 404);
  assert.equal((await f.request("/dsh-typing-buddy/media/" + "0".repeat(32))).status, 404);
  fs.unlinkSync(video);
  assert.equal((await f.request(url)).status, 404);
});

test("legacy avatar local file is proxied and dangerous URL schemes fall back", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-legacy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "face.jpg");
  fs.writeFileSync(file, "legacy");
  const f = await fixture(t, { avatar: file });
  const config = await (await f.request(configPath)).json();
  assert.equal(config.avatarKind, "file");
  assert.equal(config.avatarUrl, "/dsh-typing-buddy/avatar");
  assert.equal(await (await f.request(config.avatarUrl)).text(), "legacy");
  assert.equal((await (await f.request("/dsh-typing-buddy/asset-pack.json")).json()).id, "legacy-avatar");
  const bad = await fixture(t, { avatar: "javascript:alert(1)" });
  assert.equal((await bad.request("/dsh-typing-buddy/avatar")).headers.get("content-type"), "image/jpeg");
});

test("every listener, route and controller is released, and cleanup is idempotent", async (t) => {
  const f = await fixture(t);
  const routes = f.routes.size;
  const listeners = f.listeners.size;
  const oldHandler = f.listeners.get("api-session/status");
  for (const cleanup of f.cleanups) cleanup();
  f.plugin.dispose();
  assert.deepEqual(f.disposed(), { routes, listeners });
  assert.equal(f.routes.size, 0);
  assert.equal(f.listeners.size, 0);
  const before = fs.readFileSync(path.join(f.storageDir, "dsh-status.json"), "utf8");
  oldHandler("late-session", true);
  assert.equal(fs.readFileSync(path.join(f.storageDir, "dsh-status.json"), "utf8"), before);
});

test("range parsing handles empty files and upper end clamping", () => {
  assert.equal(parseRange("bytes=0-1", 0), false);
  assert.equal(parseRange(undefined, 10), null);
  assert.deepEqual(parseRange("bytes=0-999", 10), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=-999", 10), { start: 0, end: 9 });
});
