import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-typing-buddy-"));
process.env.HOME = home;

const { apply, inject, name } = await import("../lib/index.js");
const routes = new Map();
const listeners = new Map();
const cleanups = [];
let disposed = 0;

const ctx = {
  on(event, handler) { listeners.set(event, handler); },
  get(service) {
    assert.equal(service, "webServer");
    return {
      register(spec) {
        routes.set(spec.path, spec.handler);
        return () => { disposed++; };
      },
    };
  },
  effect(factory) { cleanups.push(factory()); },
};

apply(ctx, {});
assert.equal(name, "dsh-typing-buddy");
assert.deepEqual(inject, []);
assert.deepEqual([...routes.keys()], [
  "/dsh-typing-buddy/config.json",
  "/dsh-typing-buddy/avatar",
]);

listeners.get("api-session/status")("smoke-session", true);
const status = JSON.parse(fs.readFileSync(path.join(home, ".muse", "dsh-status.json"), "utf8"));
assert.deepEqual(status.ids, ["smoke-session"]);
assert.equal(status.running, 1);

for (const cleanup of cleanups) cleanup();
assert.equal(disposed, 2);
console.log("host smoke ok");
