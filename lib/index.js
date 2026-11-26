import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityController } from "./activity.js";
import { createGenerationService, GenerationError } from "./generation.js";
import { createFormStateStore, FormStateError, MAX_FORM_STATE_BYTES } from "./form-state.js";
import {
  AssetError, MEDIA_PREFIX, MAX_MANIFEST_BYTES, atomicWriteJson, createAssetStore,
  expandLocalPath, normalizeAssetPack,
} from "./assets.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/dsh-typing-buddy";
export const name = "dsh-typing-buddy";
export const inject = [];
export const DEFAULTS = Object.freeze({
  avatar: "", assetPack: "", size: 110, pillPadding: 6, desktopEnabled: true,
  name: "小鲸鱼", idleLabel: "", minStateDuration: 1500, theme: "auto", respectReducedMotion: true,
  position: "top-right", offsetX: 22, offsetY: 74,
  textIdle: "小鲸鱼", textRunning: "正在思考", textMulti: "正在思考·{n}",
  showKeyboardIcon: true, draggable: true, compactOnNarrow: true, beacon: true, generationEnabled: false,
});
const number = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Number(value))) : fallback;
const text = (value, fallback, allowEmpty = false) => typeof value === "string" && (allowEmpty || value.trim())
  ? value.trim().replace(/\s*·\s*/g, "·").slice(0, 200) : fallback;

export function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const config = { ...DEFAULTS, generationEnabled: input.generationEnabled === true,
    turnCelebration: input.turnCelebration !== false, randomWorkVisuals: input.randomWorkVisuals !== false };
  for (const key of ["avatar", "assetPack", "storageDir"]) {
    if (typeof input[key] === "string") config[key] = input[key].trim();
  }
  config.size = number(input.size ?? DEFAULTS.size, DEFAULTS.size, 16, 256);
  config.pillPadding = number(input.pillPadding ?? DEFAULTS.pillPadding, DEFAULTS.pillPadding, 2, 24);
  config.minStateDuration = number(input.minStateDuration ?? DEFAULTS.minStateDuration, DEFAULTS.minStateDuration, 0, 60000);
  for (const key of ["offsetX", "offsetY"]) config[key] = number(input[key] ?? DEFAULTS[key], DEFAULTS[key], -10000, 10000);
  config.name = text(input.name, text(input.textIdle, DEFAULTS.name));
  config.textIdle = config.name; // Read old labels once, then migrate to the display name.
  config.idleLabel = text(input.idleLabel, DEFAULTS.idleLabel, true);
  for (const key of ["textRunning", "textMulti"]) config[key] = text(input[key], DEFAULTS[key]);
  if (["auto", "light", "dark"].includes(input.theme)) config.theme = input.theme;
  if (["top-right", "top-left", "top-center", "bottom-right", "bottom-left"].includes(input.position)) config.position = input.position;
  for (const key of ["desktopEnabled", "respectReducedMotion", "showKeyboardIcon", "draggable", "compactOnNarrow", "beacon"]) {
    config[key] = input[key] !== false;
  }
  return config;
}

function send(req, res, code, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": bytes.length,
    ...headers,
  });
  res.end(req.method === "HEAD" ? undefined : bytes);
}
function json(req, res, code, payload, headers) {
  send(req, res, code, JSON.stringify(payload), { "Content-Type": "application/json; charset=utf-8", ...headers });
}
function service(ctx, key) {
  try { const value = typeof ctx.get === "function" ? ctx.get(key) : undefined; if (value) return value; } catch {}
  try { return ctx[key]; } catch { return undefined; }
}
function sameOrigin(req, web) {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true; // Authenticated CLI callers omit Origin; JSON prevents simple browser form posts.
  try {
    const protocol = web.protocol || (req.socket?.encrypted ? "https:" : "http:");
    return new URL(origin).origin === new URL(`${protocol}//${req.headers.host}`).origin;
  } catch { return false; }
}
async function bodyJson(req, limit = MAX_MANIFEST_BYTES) {
  if (String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new AssetError("Content-Type must be application/json", 415);
  }
  if (Number(req.headers["content-length"]) > limit) throw new AssetError("Request body exceeds size limit", 413);
  const bytes = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timeout);
      req.off("data", data); req.off("end", end); req.off("error", fail); req.off("aborted", aborted);
    };
    const fail = (error) => { cleanup(); req.resume(); reject(error); };
    const aborted = () => fail(new AssetError("Request body was interrupted"));
    const data = (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > limit) fail(new AssetError("Request body exceeds size limit", 413));
      else chunks.push(value);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const timeout = setTimeout(() => fail(new AssetError("Request body timed out", 408)), 10000);
    timeout.unref?.();
    req.on("data", data); req.once("end", end); req.once("error", fail); req.once("aborted", aborted);
  });
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new AssetError("Malformed request JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AssetError("Request body must be an object");
  return value;
}

/** One byte range is enough for browser MP4 seeking; multipart ranges are rejected. */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header));
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
function sendMedia(req, res, media, streams) {
  if (!media) { json(req, res, 404, { error: "Media asset is unavailable" }); return; }
  const range = parseRange(req.headers.range, media.size);
  const headers = { "Content-Type": media.type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
  if (range === false) {
    send(req, res, 416, "", { ...headers, "Content-Range": `bytes */${media.size}` });
    return;
  }
  const start = range?.start || 0;
  const end = range ? range.end : media.size - 1;
  const length = range ? end - start + 1 : media.size;
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${media.size}`;
  if (req.method === "HEAD" || media.size === 0) {
    res.writeHead(range ? 206 : 200, { ...headers, "Content-Length": length });
    res.end();
    return;
  }
  const stream = fs.createReadStream(media.path, { start, end });
  streams.add(stream);
  stream.once("open", () => {
    if (res.destroyed) { stream.destroy(); return; }
    res.writeHead(range ? 206 : 200, { ...headers, "Content-Length": length });
    stream.pipe(res);
  });
  stream.once("error", () => {
    if (!res.headersSent) json(req, res, 404, { error: "Media asset is unavailable" });
    else res.destroy();
  });
  stream.once("close", () => streams.delete(stream));
  res.once("close", () => stream.destroy());
}

export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig);
  const assets = createAssetStore({ assetPack: cfg.assetPack, avatar: cfg.avatar, storageDir: cfg.storageDir });
  const formState = createFormStateStore({ storageDir: cfg.storageDir, recoverImportSource: () => {
    if (assets.snapshot().active?.id === assets.defaultPack.id) return "";
    const source = assets.describeActive();
    return source.manifestPath || JSON.stringify(source.manifest, null, 2);
  } });
  // A custom storage directory redirects the desktop status too, keeping tests out of the user's HOME.
  const statusFile = cfg.storageDir ? path.join(expandLocalPath(cfg.storageDir), "dsh-status.json")
    : path.join(os.homedir(), ".muse", "dsh-status.json");
  const cleanups = [];
  const routeDisposers = [];
  const streams = new Set();
  const requests = new Set();
  let disposed = false;
  let mounted = false;
  let retryTimer;
  let attempts = 0;
  let controller;
  let generation;
  let statusError;
  const generationActive = () => Boolean(generation?.snapshot().jobs.some((job) =>
    ["queued", "running"].includes(job.status)));
  // Missing local files are not a running generation job. Report them as missing assets so the
  // floating avatar keeps its normal state instead of showing "生成中" forever.
  const visibleState = () => {
    const snapshot = assets.snapshot();
    const missingMedia = /missing media/i.test(snapshot.error || "");
    const generating = generationActive();
    return { missingMedia, generating, pending: Boolean(snapshot.pending) && (generating || !missingMedia) };
  };
  const generating = () => { const state = visibleState(); return state.pending || state.generating; };
  const writeStatus = (snapshot = controller?.snapshot()) => {
    if (disposed || !snapshot) return;
    try {
      atomicWriteJson(statusFile, { ...snapshot, activityTs: snapshot.ts, ts: Date.now(), assetPending: generating(), pid: process.pid });
      statusError = undefined;
    } catch { statusError = "Desktop status could not be persisted"; }
  };
  controller = createActivityController({ minDuration: cfg.minStateDuration, onChange: writeStatus,
    random: cfg.randomWorkVisuals ? Math.random : null, turnCelebration: cfg.turnCelebration });
  const syncGenerating = () => { if (!disposed) { controller.setGenerating(generating()); writeStatus(); } };
  generation = createGenerationService({ store: assets, storageDir: cfg.storageDir ? expandLocalPath(cfg.storageDir) : undefined,
    enabled: cfg.generationEnabled, onChange: syncGenerating });
  const refresh = () => { const snapshot = assets.refresh(); syncGenerating(); return snapshot; };
  // Light assets only: never publish dark variants even if a legacy manifest declared them.
  const lightPack = (pack) => {
    if (!pack || typeof pack !== "object") return pack;
    const { portrait_dark: _portraitDark, ...rest } = pack;
    const cleanState = (entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const { video_dark: _videoDark, poster_dark: _posterDark, ...stateRest } = entry;
      return stateRest;
    };
    return { ...rest,
      ...(rest.states ? { states: Object.fromEntries(Object.entries(rest.states).map(([key, entry]) => [key, cleanState(entry)])) } : {}),
      ...(rest.dances ? { dances: rest.dances.map(cleanState) } : {}) };
  };
  const listen = (event, handler) => {
    if (typeof ctx.on !== "function") return;
    const safe = (...args) => { if (!disposed) handler(...args); };
    const stop = ctx.on(event, safe);
    if (typeof stop === "function") cleanups.push(stop);
    else if (typeof ctx.off === "function") cleanups.push(() => ctx.off(event, safe));
  };
  listen("api-session/status", (sessionId, running) => {
    if (typeof sessionId === "string" && typeof running === "boolean") controller.session(sessionId, running);
  });
  listen("api-session/removed", (sessionId) => { if (typeof sessionId === "string") controller.session(sessionId, false); });
  listen("agent/status", ({ agent, status } = {}) => {
    if (typeof agent?.id === "string" && ["running", "idle"].includes(status)) controller.session(agent.id, status === "running");
  });
  listen("agent/disposed", ({ agent } = {}) => { if (typeof agent?.id === "string") controller.session(agent.id, false); });
  listen("dsh-typing-buddy/activity", (event) => { if (event && typeof event === "object") controller.activity(event); });
  // Canonical Session events carry durable tool IDs; no speculative agent-event listener.
  listen("session/event", (session, event) => {
    const id = session?.id;
    if (typeof id !== "string" || !event || typeof event !== "object") return;
    const data = event.data;
    if (event.type === "tool/call" && data && typeof data.callId === "string" && typeof data.name === "string") {
      controller.toolStart(id, data.callId, data.name, data.arguments);
    } else if (event.type === "tool/result" && typeof data?.message?.toolCallId === "string") {
      controller.toolEnd(id, data.message.toolCallId);
    } else if (event.type === "tool/ptc-dispatch-start" && typeof data?.subCallId === "string" && typeof data.name === "string") {
      controller.toolStart(id, `ptc:${data.subCallId}`, data.name, data.arguments);
    } else if (event.type === "tool/ptc-dispatch" && typeof data?.subCallId === "string") {
      controller.toolEnd(id, `ptc:${data.subCallId}`);
    } else if (event.type === "job/registered" && typeof data?.jobId === "string") {
      controller.background(`${id}:${data.jobId}`, true);
    } else if (event.type === "job/settled" && typeof data?.jobId === "string") {
      controller.background(`${id}:${data.jobId}`, false);
    } else if (event.type === "goal/change" && data?.operation === "complete") controller.celebrate();
  });
  // Adopt agents already running when the plugin loads, without replaying old tool events.
  try {
    const agents = service(ctx, "agents");
    for (const agent of typeof agents?.list === "function" ? agents.list() : []) {
      if (typeof agent.id === "string" && agent.status === "running") controller.session(agent.id, true);
    }
  } catch {}
  syncGenerating();
  const timer = setInterval(refresh, 2000);
  timer.unref?.();
  cleanups.push(() => clearInterval(timer));

  const avatar = () => {
    const index = new Map();
    let pack;
    try {
      pack = normalizeAssetPack({ portrait: cfg.avatar || path.join(PKG_ROOT, "assets", "avatar.jpg") }, { index });
      if (pack.pending) throw new Error("missing avatar");
    } catch {
      pack = normalizeAssetPack({ portrait: path.join(PKG_ROOT, "assets", "avatar.jpg") }, { index });
    }
    return { url: pack.portrait, media: index.get(pack.portrait.slice(MEDIA_PREFIX.length)) };
  };
  const publicConfig = () => {
    const { avatar: localAvatar, assetPack: localPack, storageDir: localStorage, ...config } = cfg;
    const ref = avatar();
    return { ...config, avatarKind: !localAvatar ? "builtin" : ref.media ? "file" : "url",
      avatarUrl: ref.media ? `${PREFIX}/avatar` : ref.url,
      assetPackUrl: `${PREFIX}/asset-pack.json`, statusUrl: `${PREFIX}/status.json`, version: "0.2.0" };
  };
  const mountRoutes = (web) => {
    const register = (suffix, method, handler, kind = "exact") => {
      const stop = web.register({ kind, path: `${PREFIX}${suffix}`, handler: async (req, res) => {
        requests.add(req);
        res.once("close", () => requests.delete(req));
        if (disposed) { json(req, res, 503, { error: "Plugin is disposed" }); return; }
        try {
          const connection = service(ctx, "connection");
          if (typeof connection?.requestRejection !== "function") {
            json(req, res, 503, { error: "Host authentication is unavailable" }); return;
          }
          const rejection = connection.requestRejection(req);
          if (rejection !== undefined) { json(req, res, Number(rejection) || 403, { error: "Host authentication required" }); return; }
          if (typeof connection.admit !== "function") {
            json(req, res, 503, { error: "Host owner admission is unavailable" }); return;
          }
          const admission = connection.admit(req);
          if (admission?.peer?.principal?.kind !== "owner") {
            json(req, res, Number(admission?.rejection) || 403, { error: "Host owner access required" }); return;
          }
          const allowed = method === "GET" ? ["GET", "HEAD"] : [method];
          if (!allowed.includes(req.method)) {
            json(req, res, 405, { error: "Method not allowed" }, { Allow: allowed.join(", ") }); return;
          }
          if (method === "POST" && !sameOrigin(req, web)) { json(req, res, 403, { error: "Same-origin request required" }); return; }
          await handler(req, res);
        } catch (failure) {
          req.resume();
          const known = failure instanceof AssetError || failure instanceof GenerationError || failure instanceof FormStateError;
          if (!res.headersSent) json(req, res, known ? failure.statusCode : 500,
            { error: known ? failure.message : "Asset operation failed" });
          else res.destroy();
        }
      } });
      if (typeof stop === "function") routeDisposers.push(stop);
    };
    register("/config.json", "GET", (req, res) => json(req, res, 200, publicConfig()));
    register("/form-state.json", "GET", (req, res) => json(req, res, 200, formState.snapshot()));
    register("/form-state", "POST", async (req, res) => {
      json(req, res, 200, formState.patch(await bodyJson(req, MAX_FORM_STATE_BYTES)));
    });
    register("/avatar", "GET", (req, res) => {
      const spec = avatar();
      if (spec.media) {
        let stat;
        try { stat = fs.statSync(spec.media.path); } catch {}
        sendMedia(req, res, stat?.isFile() ? { ...spec.media, size: stat.size } : undefined, streams);
      } else if (spec.url.startsWith("data:")) {
        const [header, data] = spec.url.split(",", 2);
        send(req, res, 200, Buffer.from(data, "base64"), { "Content-Type": header.slice(5).split(";", 1)[0] });
      } else send(req, res, 302, "", { Location: spec.url });
    });
    register("/status.json", "GET", (req, res) => {
      const state = visibleState();
      json(req, res, 200, {
        ...controller.snapshot(), assetPending: state.pending, generating: state.generating,
        missingMedia: state.missingMedia, history: controller.history(),
        ...(statusError ? { error: statusError } : {}),
      });
    });
    register("/asset-pack.json", "GET", (req, res) => {
      const pack = lightPack(refresh().active);
      const state = visibleState();
      json(req, res, 200, { ...pack, pending: state.pending || undefined,
        ...(state.missingMedia ? { missingMedia: true } : {}) });
    });
    register("/packs", "GET", (req, res) => {
      const snapshot = refresh();
      const state = visibleState();
      json(req, res, 200, { ...lightPack(snapshot), pending: state.pending,
        candidates: (snapshot.candidates || []).map((candidate) => ({ ...candidate, pack: lightPack(candidate.pack) })),
        ...(state.missingMedia ? { missingMedia: true } : {}) });
    });
    // Re-importing the same manifest/path replaces its candidate instead of stacking duplicate cards.
    // Candidates saved before this change carry no fingerprint, so seed the map from the state file.
    const previewIds = new Map();
    const fingerprintOf = (body) => body.manifestPath ? `path\u0000${body.manifestPath}`
      : body.manifest ? `manifest\u0000${JSON.stringify(body.manifest)}` : "";
    try {
      const stateFile = path.join(cfg.storageDir ? expandLocalPath(cfg.storageDir) : path.join(os.homedir(), ".muse", "dsh-typing-buddy"), "selection.json");
      const stored = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      for (const candidate of stored.candidates || []) {
        const source = candidate.source || {};
        const fingerprint = candidate.fingerprint || (source.kind === "path" ? `path\u0000${source.manifestPath}`
          : source.kind === "manifest" ? `manifest\u0000${JSON.stringify(source.manifest)}` : "");
        if (fingerprint) previewIds.set(fingerprint, candidate.id);
      }
    } catch { /* No saved candidates yet. */ }
    register("/packs/preview", "POST", async (req, res) => {
      const body = await bodyJson(req);
      const fingerprint = fingerprintOf(body);
      const existing = fingerprint ? previewIds.get(fingerprint) : undefined;
      const candidate = existing === undefined ? undefined
        : assets.snapshot().candidates.find((entry) => entry.id === existing);
      if (candidate) { json(req, res, 200, { ...candidate, pack: lightPack(candidate.pack), replaced: true }); return; }
      const result = assets.preview(body);
      if (fingerprint) previewIds.set(fingerprint, result.id);
      json(req, res, 200, { ...result, pack: lightPack(result.pack) });
    });
    register("/packs/activate", "POST", async (req, res) => {
      const body = await bodyJson(req);
      if (typeof body.id !== "string") throw new AssetError("Candidate id is required");
      const result = assets.activate(body.id);
      syncGenerating();
      json(req, res, 200, result);
    });
    register("/packs/reset", "POST", async (req, res) => {
      await bodyJson(req);
      await generation.clear();
      const result = assets.reset();
      syncGenerating();
      json(req, res, 200, result);
    });
    register("/generation.json", "GET", (req, res) => json(req, res, 200, generation.snapshot()));
    register("/generation", "POST", async (req, res) => {
      const result = generation.start(await bodyJson(req, 12 * 1024 * 1024));
      syncGenerating();
      json(req, res, 202, result);
    });
    // The host matches a prefix only at a "/" boundary, so register "/media" (not "/media/").
    register("/media", "GET", (req, res) => {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const id = pathname.startsWith(MEDIA_PREFIX) ? pathname.slice(MEDIA_PREFIX.length) : "";
      sendMedia(req, res, /^[a-f\d]{32}$/.test(id) ? assets.media(id) : undefined, streams);
    }, "prefix");
  };
  const tryMount = () => {
    if (disposed) return;
    const web = service(ctx, "webServer");
    if (web && typeof web.register === "function") {
      try {
        mountRoutes(web);
        mounted = true;
      } catch {
        for (const stop of routeDisposers.splice(0)) { try { stop(); } catch {} }
      }
    }
    if (!mounted && attempts++ < 20) {
      retryTimer = setTimeout(tryMount, 500);
      retryTimer.unref?.();
    }
  };
  tryMount();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(retryTimer);
    for (const stop of [...cleanups.splice(0), ...routeDisposers.splice(0)]) { try { stop(); } catch {} }
    for (const stream of streams) stream.destroy();
    streams.clear();
    for (const req of requests) req.destroy();
    requests.clear();
    controller.dispose();
    generation.dispose();
    assets.dispose();
  };
  if (typeof ctx.effect === "function") ctx.effect(() => dispose);
  return { controller, assets, generation, formState, refresh, dispose };
}
