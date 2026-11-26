import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, expandLocalPath } from "./assets.js";

export const FORM_STATE_DEFAULTS = Object.freeze({
  importSource: "", generationMode: "create", generationPrompt: "", generationReference: "", generationDark: false,
});
export const MAX_IMPORT_SOURCE_BYTES = 1024 * 1024;
export const MAX_GENERATION_PROMPT_LENGTH = 20000;
export const MAX_GENERATION_REFERENCE_LENGTH = 8000;
// JSON escapes can take six bytes per input character (for example, an unfinished \u0000 string).
export const MAX_FORM_STATE_BYTES = 6 * (MAX_IMPORT_SOURCE_BYTES
  + MAX_GENERATION_PROMPT_LENGTH + MAX_GENERATION_REFERENCE_LENGTH) + 2048;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = Object.keys(FORM_STATE_DEFAULTS);

export class FormStateError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "FormStateError";
    this.statusCode = statusCode;
  }
}

/** Validate shape and size only: incomplete URLs, paths and manifest JSON are valid drafts. */
function validate(value, saved = false) {
  if (!object(value)) throw new FormStateError("Form draft must be an object");
  for (const key of Object.keys(value)) {
    if (!fields.includes(key) && !(saved && key === "updatedAt")) throw new FormStateError("Unknown form draft field");
  }
  if (saved && fields.some((key) => !Object.hasOwn(value, key))) throw new FormStateError("Incomplete stored form draft");
  for (const key of fields) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== typeof FORM_STATE_DEFAULTS[key]) throw new FormStateError(`Invalid ${key} type`);
  }
  if (Object.hasOwn(value, "generationMode") && !["create", "restyle"].includes(value.generationMode)) {
    throw new FormStateError("Invalid generationMode");
  }
  if ((Object.hasOwn(value, "importSource") && Buffer.byteLength(value.importSource) > MAX_IMPORT_SOURCE_BYTES)
    || (value.generationPrompt?.length > MAX_GENERATION_PROMPT_LENGTH)
    || (value.generationReference?.length > MAX_GENERATION_REFERENCE_LENGTH)) {
    throw new FormStateError("Form draft field exceeds size limit", 413);
  }
  if (saved && Object.hasOwn(value, "updatedAt")
    && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)))) {
    throw new FormStateError("Invalid stored form draft timestamp");
  }
  return { ...value };
}

/** A dedicated host file keeps drafts independent of browser origins and profile secrets. */
export function createFormStateStore(options = {}) {
  const storageDir = expandLocalPath(options.storageDir || path.join(os.homedir(), ".muse", "dsh-typing-buddy"));
  const file = path.join(storageDir, "form-state.json");
  const defaults = () => {
    const state = { ...FORM_STATE_DEFAULTS };
    // Recover only when no draft file exists. An explicit empty source is never re-seeded.
    try {
      const source = options.recoverImportSource?.();
      if (typeof source === "string" && Buffer.byteLength(source) <= MAX_IMPORT_SOURCE_BYTES) state.importSource = source;
    } catch { /* An unavailable active pack must not prevent saving a new draft. */ }
    return state;
  };
  const snapshot = () => {
    let fd;
    try { fd = fs.openSync(file, "r"); }
    catch (error) {
      if (error.code === "ENOENT") return defaults();
      throw new FormStateError("Form draft could not be read", 500);
    }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_FORM_STATE_BYTES) throw new Error("Invalid draft file");
      const bytes = Buffer.alloc(stat.size + 1);
      const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (count > stat.size || count > MAX_FORM_STATE_BYTES) throw new Error("Draft changed during read");
      return validate(JSON.parse(bytes.subarray(0, count).toString("utf8")), true);
    } catch {
      // Never fall back to defaults and overwrite a damaged or unsupported saved draft.
      throw new FormStateError("Stored form draft is invalid; original file was preserved", 409);
    } finally { fs.closeSync(fd); }
  };
  const patch = (input) => {
    const changes = validate(input);
    // Re-read for each synchronous patch so separate store instances preserve unrelated edits.
    const next = { ...snapshot(), ...changes, updatedAt: new Date().toISOString() };
    try { atomicWriteJson(file, next); }
    catch { throw new FormStateError("Form draft could not be persisted", 500); }
    return { ...next };
  };
  return { snapshot, patch };
}
