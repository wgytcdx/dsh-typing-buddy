import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const ASSET_STATES = Object.freeze([
  "idle", "working", "making_something", "waiting_for_subagents", "connecting", "milestone_level_up", "dancing", "generating",
]);
export const MEDIA_PREFIX = "/dsh-typing-buddy/media/";
export const MAX_MANIFEST_BYTES = 1024 * 1024;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
const MAX_CANDIDATES = 20;
const MIME = Object.freeze({
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
});
const IMAGE_TYPES = new Set(Object.values(MIME).filter((type) => type.startsWith("image/")));
const VIDEO_TYPES = new Set(Object.values(MIME).filter((type) => type.startsWith("video/")));
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const MISSING_MEDIA = new WeakSet();
const INCOMPLETE_MEDIA = new WeakSet();

export class AssetError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AssetError";
    this.statusCode = statusCode;
  }
}

export function expandLocalPath(value, baseDir = process.cwd()) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new AssetError("Expected a local file path");
  }
  const input = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) throw new AssetError("Expected a local file path");
  return input === "~" ? os.homedir() : input.startsWith("~/")
    ? path.join(os.homedir(), input.slice(2)) : path.resolve(baseDir, input);
}

/** Atomic replacement prevents readers seeing partially written status or selections. */
export function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function readJson(file, limit = MAX_MANIFEST_BYTES) {
  // A descriptor also closes the stat/read race for growing files and symlink replacements.
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new AssetError("Manifest must be a regular file");
    if (stat.size > limit) throw new AssetError("Manifest exceeds size limit", 413);
    const bytes = Buffer.alloc(stat.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count > limit) throw new AssetError("Manifest exceeds size limit", 413);
    if (count > stat.size) throw new AssetError("Manifest changed during read; retry");
    try { return JSON.parse(bytes.subarray(0, count).toString("utf8")); }
    catch { throw new AssetError("Malformed manifest JSON"); }
  } finally { fs.closeSync(fd); }
}

function mediaType(value, kind) {
  const type = MIME[path.extname(value).toLowerCase()];
  const allowed = kind === "video" ? VIDEO_TYPES : IMAGE_TYPES;
  if (!allowed.has(type)) throw new AssetError(`Unsupported ${kind} asset type`);
  return type;
}

/** Only manifest references can enter this index; HTTP requests never resolve filesystem paths. */
function resolver(baseDir, index, missing) {
  return (raw, kind, required = false) => {
    if (raw === undefined || raw === null || raw === "") {
      if (required) throw new AssetError("Asset pack requires a portrait");
      return undefined;
    }
    if (typeof raw !== "string" || raw.length > MAX_MANIFEST_BYTES || /[\u0000-\u001f]/.test(raw)) {
      throw new AssetError("Invalid asset reference");
    }
    const ref = raw.trim();
    if (/^https?:\/\//i.test(ref)) {
      let url;
      try { url = new URL(ref); } catch { throw new AssetError("Invalid asset URL"); }
      if (url.username || url.password) throw new AssetError("Asset URL credentials are not supported");
      return url.href;
    }
    if (/^data:/i.test(ref)) {
      const match = /^data:([^;,]+);base64,([a-z\d+/]*={0,2})$/i.exec(ref);
      const allowed = kind === "video" ? VIDEO_TYPES : IMAGE_TYPES;
      if (!match || !allowed.has(match[1].toLowerCase()) || match[2].length % 4 !== 0) {
        throw new AssetError(`Unsupported ${kind} data URL`);
      }
      return ref;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith("//") || ref.includes("\\")) {
      throw new AssetError("Unsupported asset URL scheme");
    }
    const file = expandLocalPath(ref, baseDir);
    const type = mediaType(file, kind);
    const id = digest(`${kind}\0${file}`);
    let realPath;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new AssetError("Media must be a regular file");
      if (stat.size > MAX_MEDIA_BYTES) throw new AssetError("Media exceeds size limit", 413);
      realPath = fs.realpathSync(file);
    } catch (error) {
      if (error instanceof AssetError) throw error;
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw new AssetError("Media is not readable");
      missing.push({ id, required });
    }
    index.set(id, { id, path: file, realPath, type });
    return !realPath && !required ? undefined : `${MEDIA_PREFIX}${id}`;
  };
}

/** Return a public pack; local filenames never appear in its JSON. */
export function normalizeAssetPack(manifest, options = {}) {
  if (!object(manifest)) throw new AssetError("Manifest must be a JSON object");
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST_BYTES) {
    throw new AssetError("Manifest exceeds size limit", 413);
  }
  if (manifest.states !== undefined && !object(manifest.states)) throw new AssetError("states must be an object");
  if (manifest.dances !== undefined && !Array.isArray(manifest.dances)) throw new AssetError("dances must be an array");
  if ((manifest.dances?.length || 0) > 64) throw new AssetError("Too many dance assets");
  const index = options.index || new Map();
  const missing = [];
  const resolve = resolver(options.baseDir || process.cwd(), index, missing);
  const portrait = resolve(manifest.portrait, "image", true);
  // Light assets only: dark variants are ignored so one portrait and one video set stay authoritative.
  const normalizeState = (raw = {}) => {
    if (!object(raw)) throw new AssetError("State asset must be an object");
    const result = { poster: resolve(raw.poster, "image") || portrait };
    const video = resolve(raw.video, "video");
    if (video) result.video = video;
    return result;
  };
  const pack = {
    id: typeof manifest.id === "string" && /^[a-z\d_-]{1,80}$/i.test(manifest.id)
      ? manifest.id : `pack-${digest(JSON.stringify(manifest))}`,
    name: typeof manifest.name === "string" && manifest.name.trim()
      ? manifest.name.trim().slice(0, 120) : "自定义头像",
    portrait,
    states: Object.fromEntries(ASSET_STATES.map((state) => [state, normalizeState(manifest.states?.[state])])),
    dances: (manifest.dances || []).map(normalizeState),
  };
  if (missing.length) INCOMPLETE_MEDIA.add(pack);
  if (missing.some((entry) => entry.required)) MISSING_MEDIA.add(pack);
  // Missing files are a local asset problem, not a running production job: report them without
  // claiming that something is being generated. Only an explicit `pending` marks active production.
  if (missing.length) pack.missingMedia = true;
  if (missing.some((entry) => entry.required) || manifest.pending === true) pack.pending = true;
  return pack;
}

/**
 * Persist references rather than copies. Refresh reopens the selected manifest, so a
 * temporarily unmounted asset directory returns automatically when it is restored.
 */
export function createAssetStore(options = {}) {
  const packageRoot = options.packageRoot || PACKAGE_ROOT;
  const storageDir = expandLocalPath(options.storageDir || path.join(os.homedir(), ".muse", "dsh-typing-buddy"));
  const stateFile = path.join(storageDir, "selection.json");
  const defaultFile = path.join(packageRoot, "assets", "default-pack.json");
  let disposed = false;
  let selection = null;
  let candidates = [];
  let publicCandidates = [];
  let index = new Map();
  let active;
  let defaultPack;
  let pending = false;
  let error;
  let loadedState = false;
  const configured = options.assetPack
    ? { kind: "path", manifestPath: expandLocalPath(options.assetPack, options.baseDir) } : { kind: "default" };
  const legacy = options.avatar ? { kind: "manifest", baseDir: options.baseDir || process.cwd(), manifest: {
    id: "legacy-avatar", name: "自定义头像", portrait: options.avatar,
  } } : null;

  const safeError = (failure) => failure instanceof AssetError ? failure.message : "Asset pack source is unavailable";
  const normalizeSource = (source, mediaIndex) => {
    if (!object(source)) throw new AssetError("Invalid stored selection");
    if (source.kind === "default") return normalizeAssetPack(readJson(defaultFile), { baseDir: packageRoot, index: mediaIndex });
    if (source.kind === "path") {
      const file = expandLocalPath(source.manifestPath);
      return normalizeAssetPack(readJson(file), { baseDir: path.dirname(file), index: mediaIndex });
    }
    if (source.kind === "manifest") {
      return normalizeAssetPack(source.manifest, { baseDir: source.baseDir || process.cwd(), index: mediaIndex });
    }
    throw new AssetError("Invalid stored selection");
  };
  const persist = (nextSelection, nextCandidates) => {
    atomicWriteJson(stateFile, { version: 1, selection: nextSelection, candidates: nextCandidates });
    selection = nextSelection;
    candidates = nextCandidates;
    loadedState = true;
  };
  const snapshot = () => clone({
    active, candidates: publicCandidates, pending, ...(error ? { error } : {}),
  });
  const refresh = () => {
    if (disposed) return snapshot();
    error = undefined;
    pending = false;
    try {
      const stored = readJson(stateFile, MAX_MANIFEST_BYTES * (MAX_CANDIDATES + 2));
      if (!object(stored) || stored.version !== 1 || !object(stored.selection) || !Array.isArray(stored.candidates)
        || stored.candidates.length > MAX_CANDIDATES) throw new AssetError("Invalid stored asset selection");
      selection = stored.selection;
      candidates = stored.candidates;
      loadedState = true;
    } catch (failure) {
      if (failure.code !== "ENOENT") { error = safeError(failure); pending = true; }
      if (!loadedState) selection = configured.kind === "default" && legacy ? legacy : configured;
    }
    const nextIndex = new Map();
    try { defaultPack = normalizeSource({ kind: "default" }, nextIndex); }
    catch (failure) {
      // Keep routes usable even when the bundled manifest itself is damaged.
      defaultPack = normalizeAssetPack({ id: "default", name: "小鲸鱼", portrait: "assets/avatar.jpg" }, {
        baseDir: packageRoot, index: nextIndex,
      });
      error = safeError(failure);
    }
    try {
      const selected = normalizeSource(selection, nextIndex);
      if (MISSING_MEDIA.has(selected)) throw new AssetError("Selected asset pack has missing media");
      active = selected;
      pending ||= selected.pending === true;
      if (INCOMPLETE_MEDIA.has(selected)) error ||= "Selected asset pack has missing media; static fallbacks are active";
    } catch (failure) {
      pending = true;
      error = safeError(failure);
      active = { ...defaultPack, pending: true };
    }
    if (pending) active = { ...active, pending: true };
    publicCandidates = [];
    for (const candidate of candidates) {
      if (!object(candidate) || typeof candidate.id !== "string" || !/^[a-f\d-]{36}$/i.test(candidate.id)) {
        error ||= "Invalid stored candidate";
        continue;
      }
      try { publicCandidates.push({ id: candidate.id, pack: normalizeSource(candidate.source, nextIndex) }); }
      catch (failure) { error ||= safeError(failure); }
    }
    index = nextIndex;
    return snapshot();
  };
  const checkLive = () => { if (disposed) throw new AssetError("Asset store is disposed", 503); };
  const preview = (input) => {
    checkLive();
    if (!object(input) || (Object.hasOwn(input, "manifest") === Object.hasOwn(input, "manifestPath"))) {
      throw new AssetError("Provide exactly one of manifest or manifestPath");
    }
    refresh();
    if (candidates.length >= MAX_CANDIDATES) throw new AssetError("Candidate limit reached; reset to clear candidates", 409);
    if (Object.hasOwn(input, "manifest") && !object(input.manifest)) throw new AssetError("Manifest must be a JSON object");
    const source = Object.hasOwn(input, "manifestPath")
      ? { kind: "path", manifestPath: expandLocalPath(input.manifestPath, options.baseDir) }
      : { kind: "manifest", manifest: clone(input.manifest), baseDir: options.baseDir || process.cwd() };
    const staged = new Map(index);
    let pack;
    try { pack = normalizeSource(source, staged); }
    catch (failure) { throw failure instanceof AssetError ? failure : new AssetError("Manifest source is unavailable"); }
    // Re-previewing the same manifest/path replaces its candidate instead of stacking a duplicate card.
    const fingerprint = source.kind === "path" ? `path ${source.manifestPath}`
      : source.kind === "manifest" ? `manifest ${JSON.stringify(source.manifest)} ${source.baseDir || ""}` : "default";
    const previous = candidates.find((entry) => {
      if (entry.source?.kind !== source.kind) return false;
      if (source.kind === "path") return entry.source.manifestPath === source.manifestPath;
      return JSON.stringify(entry.source.manifest) === JSON.stringify(source.manifest);
    });
    const id = previous?.id || randomUUID();
    persist(selection, [...candidates.filter((entry) => entry.id !== id), { id, source, fingerprint }]);
    refresh();
    return clone({ id, pack, replaced: Boolean(previous) });
  };
  const activate = (id) => {
    checkLive();
    refresh();
    const candidate = candidates.find((entry) => entry.id === id);
    if (!candidate) throw new AssetError("Unknown asset candidate", 404);
    // Revalidate before committing; invalid JSON must never replace a working selection.
    try { normalizeSource(candidate.source, new Map()); }
    catch (failure) { throw new AssetError(safeError(failure)); }
    persist(candidate.source, candidates.filter((entry) => entry.id !== id));
    return { pack: refresh().active };
  };
  const reset = () => {
    checkLive();
    // Only replace this plugin's metadata. Original manifest/media inputs are untouched.
    persist({ kind: "default" }, []);
    return { pack: refresh().active };
  };
  const media = (id) => {
    const entry = index.get(id);
    if (!entry) return undefined;
    try {
      // A referenced symlink cannot be retargeted to an unrelated local file after preview.
      if (entry.realPath && fs.realpathSync(entry.path) !== entry.realPath) return undefined;
      const stat = fs.statSync(entry.path);
      if (!stat.isFile() || stat.size > MAX_MEDIA_BYTES) return undefined;
      return { ...entry, size: stat.size };
    } catch { return undefined; }
  };
  refresh();
  return {
    snapshot, refresh, preview, activate, reset, media,
    get active() { return clone(active); },
    get defaultPack() { return clone(defaultPack); },
    // Host-only generation helpers. Never serialize these objects in public routes.
    describeActive() {
      checkLive();
      refresh();
      if (active.id === defaultPack.id && selection.kind !== "default") {
        throw new AssetError("Selected source is unavailable", 409);
      }
      if (selection.kind === "manifest") return clone({
        pack: active, manifest: selection.manifest, baseDir: selection.baseDir,
      });
      const manifestPath = selection.kind === "default" ? defaultFile : expandLocalPath(selection.manifestPath);
      return clone({ pack: active, manifest: readJson(manifestPath), manifestPath,
        baseDir: selection.kind === "default" ? packageRoot : path.dirname(manifestPath) });
    },
    resolveMedia(reference) {
      if (typeof reference !== "string" || !reference.startsWith(MEDIA_PREFIX)) return undefined;
      return media(reference.slice(MEDIA_PREFIX.length));
    },
    dispose() { disposed = true; index.clear(); },
  };
}
