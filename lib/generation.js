import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const API = "https://apihub.agnes-ai.com";
const MODELS = Object.freeze({ text: "agnes-2.0-flash", image: "agnes-image-2.1-flash", video: "agnes-video-v2.0" });
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = 64 * 1024 * 1024;
const MAX_JOBS = 20;
const POLL_TIMEOUT = 20 * 60 * 1000;
const STATES = ["idle", "working", "making_something", "milestone_level_up", "dancing"];
const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);
const IMAGE_EXTENSIONS = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" });
const IMAGE_TYPES = new Set(Object.keys(IMAGE_EXTENSIONS));
const SHOT = "Face exactly identical to reference, visible eyes and mouth, white background, head and shoulders centered, fixed camera, silent, no audio, no text or overlays.";
const MOTION = {
  idle: "Relaxed breathing and a gentle natural blink, subtle seamless idle motion.",
  working: "Focused expression, subtle eye movement and a thoughtful nod. Keep the original clothing and accessories; do not add headphones or a laptop.",
  making_something: "A quietly creative expression with a subtle pleased smile and small natural head movement.",
  milestone_level_up: "A brief delighted smile and a small celebratory nod, then settle back into the centered pose.",
  dancing: "A playful gentle shoulder dance, keeping the face and head fully visible and centered.",
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Public failures contain a fixed message and HTTP status, never a provider body. */
export class GenerationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "GenerationError";
    this.statusCode = statusCode;
  }
}
function abortError() { const error = new Error("Generation cancelled"); error.name = "AbortError"; return error; }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
function atomicBytes(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
function publicHttps(value) {
  let url;
  try { url = new URL(value); } catch { throw new GenerationError("Expected a public HTTPS image or video URL"); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || !host.includes(".") || host.includes(":") || /^(0|10|127)\./.test(host)
    || /^169\.254\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^(22[4-9]|23\d|24\d|25[0-5])\./.test(host);
  if (url.protocol !== "https:" || url.username || url.password || local) {
    throw new GenerationError("Expected a public HTTPS image or video URL");
  }
  return url.href;
}
function dataImage(value) {
  // Check encoded length before allocating a decoded buffer.
  if (value.length > Math.ceil(MAX_IMAGE / 3) * 4 + 100) throw new GenerationError("Reference image exceeds 8 MB", 413);
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z\d+/]*={0,2})$/i.exec(value);
  if (!match || !IMAGE_TYPES.has(match[1].toLowerCase()) || match[2].length % 4 !== 0 || !match[2]) {
    throw new GenerationError("Expected a base64 image data URL");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_IMAGE) throw new GenerationError("Reference image exceeds 8 MB", 413);
  return value;
}
function validateReference(value) {
  if (typeof value !== "string" || !value.trim()) throw new GenerationError("Invalid image reference");
  return value.startsWith("data:") ? dataImage(value) : publicHttps(value);
}
function readLocalImage(media) {
  if (!media || !IMAGE_TYPES.has(media.type)) throw new GenerationError("Portrait resource is unavailable", 409);
  const fd = fs.openSync(media.path, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_IMAGE) throw new GenerationError("Reference image exceeds 8 MB", 413);
    const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_IMAGE + 1));
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > MAX_IMAGE) throw new GenerationError("Reference image exceeds 8 MB", 413);
    return `data:${media.type};base64,${bytes.subarray(0, length).toString("base64")}`;
  } finally { fs.closeSync(fd); }
}
function readJson(file, max = 1024 * 1024) {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new Error("Invalid generation metadata");
    const bytes = Buffer.alloc(stat.size + 1);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > max) throw new Error("Invalid generation metadata");
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally { fs.closeSync(fd); }
}

/** Optional, serial generation queue. start() validates and enqueues without awaiting any network operation. */
export function createGenerationService({
  store, storageDir = path.join(os.homedir(), ".muse", "dsh-typing-buddy"),
  apiKey = process.env.AGNES_API_KEY || process.env.AGNES_API_TOKEN || process.env.APIHUB_AGNES_API_KEY,
  enabled = false, fetchImpl = globalThis.fetch, pollInterval = 5000, onChange,
} = {}) {
  if (!store || typeof store.snapshot !== "function" || typeof store.preview !== "function") {
    throw new GenerationError("An asset store is required");
  }
  const root = path.resolve(storageDir === "~" ? os.homedir() : storageDir.startsWith("~/")
    ? path.join(os.homedir(), storageDir.slice(2)) : storageDir);
  const stateFile = path.join(root, "generation.json");
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const available = Boolean(enabled && key);
  let jobs = [];
  let records = [];
  let managedDirectories = [];
  let disposed = false;
  let clearing = false;
  let clearPromise;
  let activeDrain = Promise.resolve();
  let scheduled;
  let running = false;
  let currentController;
  let persistenceError;
  let notify = () => {};
  const safe = (value) => typeof value === "string" && key ? value.split(key).join("[redacted]") : value;
  const persist = () => {
    try {
      // Inputs and provider portrait URLs are private metadata; snapshots never expose them.
      atomicJson(stateFile, { version: 1, jobs, records, managedDirectories });
      persistenceError = undefined;
    } catch { persistenceError = { status: 500, message: "Generation metadata could not be persisted" }; }
    notify();
  };
  try {
    const saved = readJson(stateFile, 256 * 1024 * 1024);
    if (saved.version === 1 && Array.isArray(saved.jobs) && Array.isArray(saved.records)) {
      jobs = saved.jobs.filter((job) => object(job) && typeof job.id === "string" && object(job.input)).slice(-MAX_JOBS);
      records = saved.records.filter((record) => object(record) && typeof record.packId === "string");
      managedDirectories = Array.isArray(saved.managedDirectories) ? saved.managedDirectories.filter((entry) => typeof entry === "string")
        : records.filter((record) => typeof record.manifestPath === "string").map((record) => path.dirname(record.manifestPath));
      let interrupted = saved.jobs.length > MAX_JOBS;
      for (const job of jobs) {
        if (!TERMINAL.has(job.status)) {
          job.status = "interrupted";
          job.error = { status: 409, message: "Generation interrupted; retry explicitly to continue" };
          job.updatedAt = new Date().toISOString();
          interrupted = true;
        }
      }
      if (interrupted) persist();
    }
  } catch (error) { if (error.code !== "ENOENT") persistenceError = { status: 500, message: "Generation metadata could not be read" }; }
  const publicJob = (job) => ({
    id: job.id, mode: job.input.mode, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
    progress: job.progress, candidateIds: job.candidateIds || [],
    ...(job.packId ? { packId: job.packId } : {}), ...(job.retryOf ? { retryOf: job.retryOf } : {}),
    ...(job.error ? { error: job.error } : {}), retryable: ["failed", "interrupted", "cancelled"].includes(job.status),
  });
  const snapshot = () => copy({ available, models: MODELS, jobs: jobs.map(publicJob), ...(persistenceError ? { error: persistenceError } : {}) });
  notify = () => {
    try { if (typeof onChange === "function") onChange(snapshot())?.catch?.(() => {}); } catch {}
  };
  const registerDirectory = (directory) => {
    if (!managedDirectories.includes(directory)) managedDirectories.push(directory);
    persist();
    if (persistenceError) throw new GenerationError("Generation metadata could not be persisted", 500);
  };
  const check = (signal) => { if (disposed || signal?.aborted) throw abortError(); };
  const touch = (job) => { job.updatedAt = new Date().toISOString(); persist(); };
  const wait = (signal) => new Promise((resolve, reject) => {
    check(signal);
    const timer = setTimeout(done, Math.max(0, Number(pollInterval) || 0));
    function done() { signal.removeEventListener("abort", cancel); resolve(); }
    function cancel() { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(abortError()); }
    signal.addEventListener("abort", cancel, { once: true });
  });
  const withTimeout = async (signal, action) => {
    check(signal);
    const controller = new AbortController();
    let cancel;
    const interruption = new Promise((resolve, reject) => {
      cancel = () => {
        reject(controller.signal.reason === "request-timeout"
          ? new GenerationError("Agnes request timed out after 2 minutes", 504) : abortError());
      };
      controller.signal.addEventListener("abort", cancel, { once: true });
    });
    const propagate = () => controller.abort(signal.reason);
    signal.addEventListener("abort", propagate, { once: true });
    const timer = setTimeout(() => controller.abort("request-timeout"), 120000);
    try { return await Promise.race([action(controller.signal), interruption]); }
    finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", propagate);
      controller.signal.removeEventListener("abort", cancel);
    }
  };
  const requestRaw = async (route, body, signal) => {
    check(signal);
    let response;
    try {
      response = await fetchImpl(`${API}${route}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal,
        headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) { check(signal); throw new GenerationError("Agnes request failed", 502); }
    check(signal);
    if (!response.ok) throw new GenerationError(`Agnes request failed (HTTP ${Number(response.status) || 502})`, Number(response.status) || 502);
    let result;
    try { result = await response.json(); }
    catch { throw new GenerationError("Agnes returned invalid JSON", 502); }
    check(signal);
    if (!object(result)) throw new GenerationError("Agnes returned invalid JSON", 502);
    if (result.error) throw new GenerationError("Agnes reported a provider error", 502);
    return result;
  };
  const request = (route, body, signal) => withTimeout(signal, (bounded) => requestRaw(route, body, bounded));
  const downloadRaw = async (url, limit, kind, signal) => {
    check(signal);
    const ref = publicHttps(url);
    let response;
    try { response = await fetchImpl(ref, { signal, redirect: "error" }); }
    catch { check(signal); throw new GenerationError("Generated asset download failed", 502); }
    check(signal);
    if (!response.ok) throw new GenerationError(`Asset download failed (HTTP ${Number(response.status) || 502})`, Number(response.status) || 502);
    const type = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].toLowerCase();
    if (type && !(kind === "image" ? IMAGE_TYPES.has(type) : type.startsWith("video/") || type === "application/octet-stream")) {
      throw new GenerationError("Provider returned an unexpected asset type", 502);
    }
    if (Number(response.headers?.get?.("content-length")) > limit) {
      await response.body?.cancel?.().catch?.(() => {});
      throw new GenerationError(`Asset exceeds ${limit / 1024 / 1024} MB`, 413);
    }
    const chunks = [];
    let size = 0;
    const append = (chunk) => {
      check(signal);
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) throw new GenerationError(`Asset exceeds ${limit / 1024 / 1024} MB`, 413);
      chunks.push(bytes);
    };
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        while (true) { const { done, value } = await reader.read(); check(signal); if (done) break; append(value); }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    } else if (response.body?.[Symbol.asyncIterator]) {
      for await (const chunk of response.body) append(chunk);
    } else {
      append(await response.arrayBuffer());
    }
    check(signal);
    if (!size) throw new GenerationError("Provider returned an empty asset", 502);
    return { bytes: Buffer.concat(chunks, size), type: IMAGE_TYPES.has(type) ? type : "image/png" };
  };
  const download = (url, limit, kind, signal) => withTimeout(signal, (bounded) => downloadRaw(url, limit, kind, bounded));
  const translate = async (prompt, signal) => {
    if (!/[^\u0000-\u007f]/.test(prompt)) return prompt;
    const result = await request("/v1/chat/completions", {
      model: MODELS.text, temperature: 0,
      messages: [
        { role: "system", content: "Translate the user's visual description into fluent English for image/video generation. Preserve identity, concrete visual details, style, lighting, composition, motion, camera instructions and constraints. Return only the English description; do not generate an image." },
        { role: "user", content: prompt },
      ],
    }, signal);
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim() || /[\u3400-\u9fff]/.test(content)) {
      throw new GenerationError("Agnes returned an invalid English translation", 502);
    }
    return content.trim();
  };
  const findRecord = (id, active) => records.find((record) => record.candidateId === id || record.packId === id
    || id === "active" && record.packId === active?.id);
  const packReference = async (pack, signal) => {
    if (!pack || typeof pack.portrait !== "string") throw new GenerationError("Portrait resource is unavailable", 409);
    if (pack.portrait.startsWith("data:")) return dataImage(pack.portrait);
    const media = typeof store.resolveMedia === "function" ? store.resolveMedia(pack.portrait)
      : /^\/dsh-typing-buddy\/media\/([a-f\d]{32})$/.test(pack.portrait) && typeof store.media === "function"
        ? store.media(pack.portrait.split("/").pop()) : undefined;
    if (media) return readLocalImage(media);
    const downloaded = await download(publicHttps(pack.portrait), MAX_IMAGE, "image", signal);
    return `data:${downloaded.type};base64,${downloaded.bytes.toString("base64")}`;
  };
  const referenceFor = async (input, signal) => {
    const state = store.snapshot();
    const id = input.referenceId || input.candidateId || "active";
    if (input.reference) {
      if (input.reference.startsWith("data:")) return dataImage(input.reference);
      const image = await download(input.reference, MAX_IMAGE, "image", signal);
      return `data:${image.type};base64,${image.bytes.toString("base64")}`;
    }
    const record = findRecord(id, state.active);
    if (record?.providerPortraitURL) return validateReference(record.providerPortraitURL);
    const pack = id === "active" || id === state.active?.id ? state.active
      : state.candidates?.find((candidate) => candidate.id === id || candidate.pack.id === id)?.pack;
    return packReference(pack, signal);
  };
  const commitManifest = async (record, manifest, signal) => {
    check(signal);
    atomicJson(record.manifestPath, manifest);
    if (typeof store.refresh === "function") await store.refresh();
    check(signal);
  };
  const portraits = async (job, signal) => {
    const input = job.input;
    const prompt = job.englishPrompt || await translate(input.prompt, signal);
    job.englishPrompt = prompt;
    const reference = job.resolvedReference || (input.mode === "restyle" || input.reference || input.referenceId || input.candidateId
      ? await referenceFor(input, signal) : undefined);
    if (reference && !job.resolvedReference) {
      job.resolvedReference = reference;
      if (input.reference === reference && reference.startsWith("data:")) delete input.reference;
      // Pin identity before the first paid image request, including across explicit retries.
      touch(job);
    }
    const identity = reference ? "Keep the person's identity and face exactly identical to reference while applying the requested style. Create one independent main portrait, never a grid or collage. " : "Create one independent main portrait of one person, never a contact sheet, grid or collage. ";
    for (let index = job.progress.completed; index < input.count; index++) {
      check(signal);
      const result = await request("/v1/images/generations", {
        model: MODELS.image, prompt: `${prompt}\n${identity}Visible eyes and mouth, white background, head and shoulders centered. No text or overlays.`,
        size: "1024x1024", extra_body: { image: reference ? [reference] : [], response_format: "url" },
      }, signal);
      const portraitURL = result.data?.[0]?.url || result.images?.[0]?.url || result.url;
      if (typeof portraitURL !== "string") throw new GenerationError("Agnes returned no portrait URL", 502);
      const { bytes, type } = await download(portraitURL, MAX_IMAGE, "image", signal);
      const portraitFile = `portrait.${IMAGE_EXTENSIONS[type] || "png"}`;
      const packId = randomUUID();
      const directory = path.join(root, "generated", packId);
      const record = { packId, manifestPath: path.join(directory, "manifest.json"), providerPortraitURL: publicHttps(portraitURL) };
      check(signal);
      registerDirectory(directory);
      atomicBytes(path.join(directory, portraitFile), bytes);
      const manifest = { id: packId, name: input.name || "生成头像", portrait: portraitFile, states: {}, dances: [], pending: false };
      atomicJson(record.manifestPath, manifest);
      const candidate = await store.preview({ manifestPath: record.manifestPath });
      record.candidateId = candidate.id;
      records.push(record);
      job.candidateIds.push(candidate.id);
      job.progress.completed++;
      touch(job);
    }
  };
  const activeTarget = (input) => {
    const state = store.snapshot();
    const id = input.candidateId || "active";
    const record = findRecord(id, state.active);
    const selected = id === "active" || id === state.active?.id || record?.packId === state.active?.id;
    if (!state.active || !selected) throw new GenerationError("Activate the target candidate before animating it", 409);
    if (input.targetPackId && input.targetPackId !== state.active.id) throw new GenerationError("The original animation target is no longer active", 409);
    return { state, record };
  };
  const managedTarget = async (input, signal) => {
    const { state, record } = activeTarget(input);
    if (record) return record;
    const description = typeof store.describeActive === "function" ? store.describeActive() : undefined;
    if (!description || !object(description.manifest) || typeof store.activate !== "function") {
      throw new GenerationError("Active pack is not managed by the generation service", 409);
    }
    const reference = await packReference(state.active, signal);
    const directory = path.join(root, "generated", randomUUID());
    const next = { packId: state.active.id, manifestPath: path.join(directory, "manifest.json"), providerPortraitURL: reference };
    // Preserve all existing assets through their registered public refs or absolute raw source refs.
    const manifest = copy(description.manifest);
    const absolutize = (ref) => typeof ref === "string" && ref && !/^[a-z][a-z\d+.-]*:/i.test(ref) && !path.isAbsolute(ref)
      ? path.resolve(description.baseDir, ref) : ref;
    for (const field of ["portrait", "portrait_dark"]) if (manifest[field]) manifest[field] = absolutize(manifest[field]);
    for (const entry of [...Object.values(manifest.states || {}), ...(manifest.dances || [])]) {
      for (const field of ["video", "video_dark", "poster", "poster_dark"]) if (entry[field]) entry[field] = absolutize(entry[field]);
    }
    manifest.id = state.active.id;
    manifest.states ||= {};
    manifest.dances ||= [];
    check(signal);
    registerDirectory(directory);
    atomicJson(next.manifestPath, manifest);
    const candidate = await store.preview({ manifestPath: next.manifestPath });
    check(signal);
    // Recheck after staging; never replace a different pack activated during asynchronous work.
    if (store.snapshot().active?.id !== state.active.id) throw new GenerationError("Active pack changed before animation started", 409);
    await store.activate(candidate.id);
    next.candidateId = candidate.id;
    records.push(next);
    persist();
    return next;
  };
  const video = async (prompt, reference, signal) => {
    const started = Date.now();
    const deadline = new AbortController();
    const cancelled = () => deadline.abort(signal.reason);
    signal.addEventListener("abort", cancelled, { once: true });
    const timeout = setTimeout(() => deadline.abort("timeout"), POLL_TIMEOUT);
    try {
      const created = await request("/v1/videos", {
        model: MODELS.video, prompt, image: reference, mode: "ti2vid",
        width: 768, height: 768, num_frames: 81, frame_rate: 24,
      }, deadline.signal);
      const id = created.id || created.task_id || created.data?.id;
      if (typeof id !== "string" || !id) throw new GenerationError("Agnes returned no video task id", 502);
      while (Date.now() - started < POLL_TIMEOUT) {
        check(signal);
        const result = await request(`/v1/videos/${encodeURIComponent(id)}`, undefined, deadline.signal);
        const status = result.status || result.data?.status;
        if (["failed", "error", "cancelled"].includes(status)) throw new GenerationError("Agnes video task failed", 502);
        if (status === "completed") {
          const url = result.video_url || result.url || result.remixed_from_video_id
            || result.data?.video_url || result.data?.url || result.data?.remixed_from_video_id;
          if (typeof url !== "string") throw new GenerationError("Completed video task returned no video URL", 502);
          return await download(url, MAX_VIDEO, "video", deadline.signal);
        }
        await wait(deadline.signal);
      }
      throw new GenerationError("Agnes video polling timed out after 20 minutes", 504);
    } catch (error) {
      check(signal);
      if (deadline.signal.aborted && deadline.signal.reason === "timeout") throw new GenerationError("Agnes video polling timed out after 20 minutes", 504);
      throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener("abort", cancelled); }
  };
  const animate = async (job, signal) => {
    const record = await managedTarget(job.input, signal);
    const manifest = readJson(record.manifestPath);
    job.packId = record.packId;
    // Resolve once: every state, including dark variants, starts from this exact same portrait.
    const reference = record.providerPortraitURL || await referenceFor({ candidateId: "active" }, signal);
    const english = job.englishPrompt || await translate(job.input.prompt, signal);
    job.englishPrompt = english;
    manifest.pending = true;
    manifest.states ||= {};
    manifest.dances ||= [];
    manifest.states.generating = { poster: manifest.portrait };
    const variants = job.input.dark ? ["video", "video_dark"] : ["video"];
    try {
      await commitManifest(record, manifest, signal);
      for (const field of variants) {
        for (const state of STATES) {
          check(signal);
          if (store.snapshot().active?.id !== record.packId) throw new GenerationError("Active pack changed during animation", 409);
          const assetKey = `${state}:${field}`;
          if (job.ready?.includes(assetKey)) continue;
          const lighting = field === "video_dark" ? "Dark-theme compatible soft lighting; keep a clean white background." : "Soft natural even lighting.";
          const { bytes } = await video(`${english}\n${MOTION[state]} ${SHOT} ${lighting}`, validateReference(reference), signal);
          check(signal);
          const file = `${state}${field === "video_dark" ? "-dark" : ""}.mp4`;
          atomicBytes(path.join(path.dirname(record.manifestPath), file), bytes);
          manifest.states[state] = { ...manifest.states[state], poster: manifest.portrait, [field]: file };
          if (state === "idle") manifest.states.connecting = { ...manifest.states[state] };
          if (state === "working") manifest.states.waiting_for_subagents = { ...manifest.states[state] };
          if (state === "dancing") manifest.dances = [{ ...manifest.states[state] }];
          await commitManifest(record, manifest, signal);
          (job.ready ||= []).push(assetKey);
          job.progress.completed++;
          touch(job);
        }
      }
    } finally {
      // Keep ready media and clear the busy marker even on a provider failure or unload.
      manifest.pending = false;
      atomicJson(record.manifestPath, manifest);
      if (!disposed && typeof store.refresh === "function") await store.refresh();
    }
  };
  const drain = async () => {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed) {
        // Find afresh: start() may evict an old terminal job while this queue is awaiting I/O.
        const job = jobs.find((entry) => entry.status === "queued");
        if (!job) break;
        const controller = new AbortController();
        currentController = controller;
        job.status = "running";
        touch(job);
        try {
          await (job.input.mode === "animate" ? animate(job, controller.signal) : portraits(job, controller.signal));
          check(controller.signal);
          job.status = "completed";
          delete job.error;
        } catch (error) {
          job.status = disposed || error.name === "AbortError" ? "cancelled" : "failed";
          job.error = { status: job.status === "cancelled" ? 499 : error instanceof GenerationError ? error.statusCode : 500,
            message: job.status === "cancelled" ? "Generation cancelled" : error instanceof GenerationError ? safe(error.message) : "Generation operation failed" };
        } finally { currentController = undefined; touch(job); }
      }
    } finally { running = false; }
  };
  const start = (raw) => {
    if (disposed) throw new GenerationError("Generation service is disposed", 503);
    if (clearing) throw new GenerationError("Generation results are being cleared", 409);
    if (!available) throw new GenerationError("Agnes generation is disabled or missing an API key", 503);
    if (typeof fetchImpl !== "function") throw new GenerationError("Fetch implementation is unavailable", 503);
    if (!object(raw)) throw new GenerationError("Generation input must be an object");
    let prior;
    if (raw.retryJobId !== undefined) {
      prior = jobs.find((job) => job.id === raw.retryJobId);
      if (!prior || !["failed", "interrupted", "cancelled"].includes(prior.status)) throw new GenerationError("Job is not available for retry", 409);
    }
    const source = prior ? { ...prior.input } : raw;
    if (!["create", "restyle", "animate"].includes(source.mode)) throw new GenerationError("Unknown generation mode");
    const prompt = typeof source.prompt === "string" ? source.prompt.trim() : "";
    if (!prompt && source.mode !== "animate") throw new GenerationError("A generation prompt is required");
    if (prompt.length > 8000) throw new GenerationError("Generation prompt exceeds size limit", 413);
    const count = source.mode === "animate" ? 1 : source.count ?? (source.mode === "create" ? 3 : 1);
    if (!Number.isInteger(count) || count < 1 || count > 3) throw new GenerationError("Candidate count must be between 1 and 3");
    const input = { mode: source.mode, prompt, count, dark: source.dark === true };
    if (prior?.input.referenceId) input.referenceId = prior.input.referenceId;
    if (source.name !== undefined) {
      if (typeof source.name !== "string" || !source.name.trim() || source.name.length > 120) throw new GenerationError("Pack name must contain 1 to 120 characters");
      input.name = source.name.trim();
    }
    if (source.candidateId !== undefined) {
      if (typeof source.candidateId !== "string" || !source.candidateId || source.candidateId.length > 120) throw new GenerationError("Invalid candidate id");
      input.candidateId = source.candidateId;
    }
    if (source.reference !== undefined) {
      const state = store.snapshot();
      const reference = source.reference;
      if (typeof reference === "string" && (reference === "active" || findRecord(reference, state.active)
        || state.candidates?.some((candidate) => candidate.id === reference))) input.referenceId = reference;
      else input.reference = validateReference(reference);
    }
    if (source.mode === "animate") {
      if (prior) input.targetPackId = prior.input.targetPackId || prior.packId;
      input.targetPackId = activeTarget(input).state.active.id;
    }
    if (source.mode === "restyle" && !input.reference && !input.referenceId) {
      const state = store.snapshot();
      const id = input.candidateId || "active";
      if (id !== "active" && id !== state.active?.id && !findRecord(id, state.active)
        && !state.candidates?.some((candidate) => candidate.id === id)) throw new GenerationError("Unknown image candidate", 404);
    }
    if (jobs.length >= MAX_JOBS) {
      const index = jobs.findIndex((job) => TERMINAL.has(job.status));
      if (index < 0) throw new GenerationError("Generation queue is full", 429);
      jobs.splice(index, 1);
    }
    const now = new Date().toISOString();
    const job = { id: randomUUID(), input, status: "queued", createdAt: now, updatedAt: now,
      progress: { completed: prior?.progress.completed || 0, total: input.mode === "animate" ? STATES.length * (input.dark ? 2 : 1) : count },
      candidateIds: prior?.candidateIds ? [...prior.candidateIds] : [],
      ...(prior ? { retryOf: prior.id, ready: [...(prior.ready || [])], englishPrompt: prior.englishPrompt,
        ...(prior.resolvedReference ? { resolvedReference: prior.resolvedReference } : {}) } : {}),
    };
    jobs.push(job);
    persist();
    if (persistenceError) { jobs.pop(); throw new GenerationError("Generation metadata could not be persisted", 500); }
    if (!running && !scheduled) scheduled = setImmediate(() => { scheduled = undefined; activeDrain = drain(); });
    return { id: job.id };
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (scheduled) clearImmediate(scheduled);
    scheduled = undefined;
    currentController?.abort();
    for (const job of jobs) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "cancelled";
        job.error = { status: 499, message: "Generation cancelled" };
        job.updatedAt = new Date().toISOString();
      }
    }
    persist();
  };
  const clear = () => {
    if (disposed) return Promise.reject(new GenerationError("Generation service is disposed", 503));
    if (clearPromise) return clearPromise;
    clearing = true;
    if (scheduled) clearImmediate(scheduled);
    scheduled = undefined;
    currentController?.abort();
    for (const job of jobs) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "cancelled";
        job.error = { status: 499, message: "Generation cancelled" };
        job.updatedAt = new Date().toISOString();
      }
    }
    persist();
    clearPromise = (async () => {
      try {
        // In particular, wait for animate's finally to finish before deleting its manifest.
        await activeDrain;
        const generatedRoot = path.join(root, "generated");
        let stat;
        try { stat = fs.lstatSync(generatedRoot); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (stat?.isSymbolicLink()) throw new GenerationError("Managed generation directory is not a regular directory", 409);
        for (const directory of new Set(managedDirectories)) {
          const resolved = path.resolve(directory);
          if (path.dirname(resolved) !== generatedRoot || !/^[a-f\d-]{36}$/i.test(path.basename(resolved))) continue;
          fs.rmSync(resolved, { recursive: true, force: true });
        }
        jobs = [];
        records = [];
        managedDirectories = [];
        persist();
        if (persistenceError) throw new GenerationError("Generation metadata could not be persisted", 500);
        return snapshot();
      } catch (error) {
        throw error instanceof GenerationError ? error : new GenerationError("Generation results could not be cleared", 500);
      } finally { clearing = false; clearPromise = undefined; }
    })();
    return clearPromise;
  };
  return { snapshot, start, clear, dispose };
}
