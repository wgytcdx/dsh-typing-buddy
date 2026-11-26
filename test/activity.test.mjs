import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_STATES, DEFAULT_LABELS, classifyTool, createActivityController } from "../lib/activity.js";

function virtualClock(start = 0) {
  let time = start;
  let nextId = 0;
  const timers = new Map();
  const callbacks = [];
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: time + delay });
      callbacks.push(callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(delta) {
      const end = time + delta;
      let steps = 0;
      while (true) {
        const due = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due || due[1].at > end) break;
        assert.ok(++steps < 1000, "timer should make progress");
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = end;
    },
    pending: () => timers.size,
    callbacks,
  };
}

function fixture(t, options = {}, start = 0) {
  const clock = virtualClock(start);
  const changes = [];
  const controller = createActivityController({
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    onChange: (snapshot) => changes.push(snapshot), ...options,
  });
  t.after(() => controller.dispose());
  return { controller, clock, changes };
}

function state(controller, expected, detail) {
  const snapshot = controller.snapshot();
  assert.equal(snapshot.state, expected);
  if (detail !== undefined) assert.equal(snapshot.detail, detail);
  return snapshot;
}

test("exports the eight states and classifies namespaced tools without treating dispatch as a wait", () => {
  assert.deepEqual(AVATAR_STATES, [
    "idle", "working", "making_something", "waiting_for_subagents", "connecting",
    "milestone_level_up", "dancing", "generating",
  ]);
  assert.ok(Object.isFrozen(AVATAR_STATES));
  assert.ok(Object.isFrozen(DEFAULT_LABELS));
  const cases = [
    ["functions.web_search", {}, "working", "web_browsing"],
    ["web_fetch", {}, "working", "web_browsing"],
    ["yunai_read_page", {}, "working", "web_browsing"],
    ["read", {}, "working", "files"],
    ["write", {}, "making_something", "files", "在整理文档"],
    ["edit", {}, "making_something", "files", "在整理文档"],
    ["present", {}, "making_something", "artifact"],
    ["bash", { command: "node --test" }, "working", "terminal"],
    ["wait_agent", {}, "waiting_for_subagents", "subagents"],
    ["job_output", { wait: true }, "waiting_for_subagents", "subagents"],
    ["job_output", '{"wait":true}', "waiting_for_subagents", "subagents"],
    ["job_output", { wait: false }, "working", "terminal"],
    ["send_message", { target: "worker" }, "working", "thinking"],
    ["spawn_teammate", {}, "working", "thinking"],
    ["subagent", {}, "working", "thinking"],
    ["create_goal", {}, "working", "thinking"],
    ["update_goal", { action: "complete" }, "milestone_level_up", "milestone_level_up"],
    ["update_goal", { action: "edit" }, "working", "thinking"],
    ["unknown", null, "working", "thinking"],
  ];
  for (const [name, args, expected, detail, label = DEFAULT_LABELS[detail]] of cases) {
    assert.deepEqual(classifyTool(name, args), { state: expected, detail, label }, name);
  }
});

test("write and edit distinguish document work from explicit web source paths", () => {
  for (const [tool, args] of [
    ["write", { file_path: "docs/report.md" }], ["edit", { path: "notes.txt" }],
  ]) assert.equal(classifyTool(tool, args).label, "在整理文档");
  for (const [tool, args] of [
    ["write", { file_path: "index.html" }], ["edit", { path: "styles/app.css" }],
    ["write", { filePath: "lib/client.js" }], ["functions.edit", { filename: "src/App.tsx" }],
    ["edit", { file_path: "src/Widget.JSX" }],
  ]) {
    assert.deepEqual(classifyTool(tool, args), { state: "making_something", detail: "files", label: "正在做网页" });
  }
  assert.equal(classifyTool("read", { file_path: "index.html" }).label, "在翻文件");
});

test("only clear build invocations are classified as artifact creation", () => {
  for (const command of [
    "npm run build", "npm build", "pnpm build", "pnpm run build -- --mode production", "yarn build", "yarn run build",
    "vite build", "npx vite build --mode production", "pnpm exec vite build", "esbuild build",
    "esbuild src/app.js --bundle --outfile=dist/app.js", "esbuild --bundle src/app.js", "npx esbuild app.js --bundle",
  ]) {
    assert.deepEqual(classifyTool("bash", { command }), {
      state: "making_something", detail: "artifact", label: "正在制作",
    }, command);
  }
  for (const command of [
    "echo npm run build", "printf 'pnpm build'", "node scripts/build.mjs", "npm run rebuild", "npm run build:watch",
    "npm install build", "vite preview", "esbuild --version", "npm test", "git show HEAD:build",
    "npm run build && npm test", "echo done; npm run build",
  ]) assert.equal(classifyTool("bash", { command }).state, "working", command);
});

test("first activity is immediate; short tools do not flash or leave a stale pending transition", (t) => {
  const { controller: c, clock, changes } = fixture(t);
  assert.equal(changes.length, 0);
  c.session("a", true);
  state(c, "working", "thinking");
  clock.advance(100);
  c.toolStart("a", "edit", "edit");
  state(c, "working");
  clock.advance(100);
  c.toolEnd("a", "edit");
  clock.advance(1300);
  state(c, "working", "thinking");
  assert.equal(changes.length, 1);
  assert.equal(clock.pending(), 0);

  clock.advance(100);
  c.toolStart("a", "write", "write");
  state(c, "making_something", "files");
  clock.advance(100);
  c.toolEnd("a", "write");
  clock.advance(1399);
  state(c, "making_something");
  clock.advance(1);
  state(c, "working", "thinking");
  assert.equal(c.snapshot().ts, 3100);
});

test("minimum display chooses the latest live candidate, not the first queued snapshot", (t) => {
  const { controller: c, clock } = fixture(t);
  c.session("a", true);
  clock.advance(100);
  c.toolStart("a", "edit", "edit");
  clock.advance(100);
  c.toolStart("a", "wait", "wait_agent");
  clock.advance(200);
  c.toolEnd("a", "edit");
  clock.advance(1100);
  state(c, "waiting_for_subagents");
  c.toolEnd("a", "wait");
  clock.advance(1500);
  state(c, "working");
});

test("parallel tools are prioritized across sessions and identical call IDs stay isolated", (t) => {
  const { controller: c } = fixture(t, { minDuration: 0 });
  c.session("a", true);
  c.session("b", true);
  c.toolStart("a", "same", "web_fetch");
  c.toolStart("b", "same", "edit");
  state(c, "making_something", "files");
  assert.deepEqual(c.snapshot().ids, ["a", "b"]);
  assert.equal(c.snapshot().running, 2);
  c.toolEnd("b", "same");
  state(c, "working", "web_browsing");
  c.toolStart("a", "newer", "read");
  state(c, "working", "files");
  c.toolEnd("a", "newer");
  state(c, "working", "web_browsing");
  c.session("a", false);
  state(c, "working", "thinking");
  assert.deepEqual(c.snapshot().ids, ["b"]);
  c.toolEnd("a", "same");
  assert.equal(c.snapshot().running, 1);
  c.session("b", false);
  state(c, "idle");
});

test("all eight states follow priority and generating is visible only while otherwise idle", (t) => {
  const { controller: c } = fixture(t, { minDuration: 0 });
  state(c, "idle");
  c.setGenerating(true);
  state(c, "generating");
  c.session("a", true);
  state(c, "working");
  c.toolStart("a", "wait", "job_output", { wait: true });
  state(c, "waiting_for_subagents");
  c.toolStart("a", "edit", "edit");
  state(c, "making_something");
  c.dance();
  state(c, "dancing");
  c.celebrate();
  state(c, "milestone_level_up");
  c.connection(false);
  assert.equal(state(c, "connecting").connected, false);
  c.connection(true);
  state(c, "milestone_level_up");
});

test("generating activity patches still require assetPending and yield to active work", (t) => {
  const { controller: c } = fixture(t, { minDuration: 0 });
  assert.equal(c.snapshot().label, "");
  c.activity({ state: "generating", label: "生成资源" });
  state(c, "idle");
  c.setGenerating(true);
  assert.equal(state(c, "generating").label, "生成资源");
  c.session("a", true);
  state(c, "working");
  c.session("a", false);
  state(c, "generating");
  c.setGenerating(false);
  assert.equal(state(c, "idle").label, "");
});

test("connection failure and recovery immediately reveal the current underlying state", (t) => {
  const { controller: c, clock } = fixture(t);
  c.session("a", true);
  clock.advance(100);
  c.toolStart("a", "write", "write");
  state(c, "working");
  clock.advance(100);
  c.connection(false);
  state(c, "connecting");
  clock.advance(100);
  c.session("a", false);
  c.setGenerating(true);
  state(c, "connecting");
  clock.advance(100);
  c.connection(true);
  const snapshot = state(c, "generating");
  assert.equal(snapshot.running, 0);
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.ts, 400);
});

test("repeated healthy connection notifications preserve minimum display duration", (t) => {
  const { controller: c, clock } = fixture(t);
  c.session("a", true);
  clock.advance(100);
  c.toolStart("a", "edit", "edit");
  c.connection(true);
  state(c, "working");
  clock.advance(1400);
  state(c, "making_something");
});

test("celebration expires after four seconds into current base instead of a saved snapshot", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 });
  c.session("a", true);
  c.celebrate();
  state(c, "milestone_level_up");
  clock.advance(100);
  c.toolStart("a", "edit", "edit");
  clock.advance(100);
  c.session("a", false);
  c.setGenerating(true);
  clock.advance(3799);
  state(c, "milestone_level_up");
  clock.advance(1);
  state(c, "generating");
  assert.equal(clock.pending(), 0);
});

test("dance and celebration have independent deadlines and fall through to live work", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 });
  c.dance();
  clock.advance(1000);
  c.celebrate();
  clock.advance(1000);
  c.toolStart("a", "edit", "edit");
  clock.advance(2999);
  state(c, "milestone_level_up");
  clock.advance(1);
  state(c, "dancing");
  clock.advance(4999);
  state(c, "dancing");
  clock.advance(1);
  state(c, "making_something");
});

test("overrides expire while disconnected and recovery does not resurrect them", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 });
  c.session("a", true);
  c.dance();
  c.celebrate();
  c.connection(false);
  clock.advance(10_000);
  state(c, "connecting");
  c.connection(true);
  state(c, "working");
});

test("custom short celebration expires on time even when minimum display is longer", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 5000, celebrationDuration: 500 });
  c.celebrate();
  state(c, "milestone_level_up");
  clock.advance(100);
  c.toolStart("a", "edit", "edit");
  clock.advance(400);
  state(c, "making_something");
});

test("repeated celebrations extend their deadline; a zero celebration duration stays disabled", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 });
  c.celebrate();
  clock.advance(3000);
  c.celebrate();
  clock.advance(3999);
  state(c, "milestone_level_up");
  clock.advance(1);
  state(c, "idle");
  const { controller: disabled } = fixture(t, { celebrationDuration: 0 });
  disabled.celebrate();
  state(disabled, "idle");
});

test("external patches have finite leases, honor labels and timestamps, and ignore older messages", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 });
  c.session("a", true);
  clock.advance(100);
  c.activity({ sessionId: "a", state: "making_something", detail: "artifact", label: "写文档", ts: 100 });
  assert.equal(state(c, "making_something").label, "写文档");
  c.activity({ sessionId: "a", state: "waiting_for_subagents", ts: 99 });
  state(c, "making_something");
  clock.advance(14_999);
  state(c, "making_something");
  clock.advance(1);
  state(c, "working", "thinking");
  assert.equal(clock.pending(), 0);
  c.activity({ state: "making_something", ts: 0 }); // Already expired on arrival.
  state(c, "working");
});

test("Unix-second activity timestamps normalize to milliseconds without immediately expiring", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 }, 1_794_890_000_123);
  c.activity({ state: "making_something", ts: 1_794_890_000 });
  state(c, "making_something");
  clock.advance(14_876);
  state(c, "making_something");
  clock.advance(1);
  state(c, "idle");
  c.activity({ state: "working", detail: "web_browsing", ts: clock.now(), durationMs: 1000 });
  state(c, "working", "web_browsing");
  clock.advance(1000);
  state(c, "idle");
});

test("global and per-session patches are independent and session stop clears its patch", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 });
  c.session("a", true);
  c.session("b", true);
  c.activity({ state: "working", detail: "web_browsing", durationMs: 3000 });
  c.activity({ sessionId: "a", state: "making_something", detail: "files", durationMs: 1000 });
  state(c, "making_something", "files");
  c.session("a", false);
  state(c, "working", "web_browsing");
  c.activity({ sessionId: "b", state: "waiting_for_subagents", durationMs: 250 });
  state(c, "waiting_for_subagents");
  clock.advance(250);
  state(c, "working", "web_browsing");
  clock.advance(2750);
  state(c, "working", "thinking");
});

test("partial activity patches retain details and may clear a lease with idle or duration zero", (t) => {
  const { controller: c } = fixture(t, { minDuration: 0 });
  c.activity({ state: "working", detail: "web_browsing" });
  assert.equal(c.snapshot().label, DEFAULT_LABELS.web_browsing);
  c.activity({ label: "在读页面" });
  assert.equal(state(c, "working", "web_browsing").label, "在读页面");
  c.activity({ label: "" });
  assert.equal(state(c, "working", "web_browsing").label, "");
  c.activity({ state: "idle" });
  state(c, "idle");
  c.activity({ detail: "artifact" });
  state(c, "making_something", "artifact");
  c.activity({ state: "making_something", durationMs: 0 });
  state(c, "idle");
  c.activity({ state: "unexpected" });
  c.activity(null);
  state(c, "idle");
});

test("leased connecting activity is immediate and explicit recovery clears it immediately", (t) => {
  const { controller: c, clock } = fixture(t);
  c.session("a", true);
  clock.advance(100);
  c.activity({ state: "connecting", durationMs: 200 });
  state(c, "connecting");
  c.toolStart("a", "write", "write");
  clock.advance(200);
  state(c, "making_something");
  c.activity({ state: "connecting" });
  state(c, "connecting");
  c.connection(true);
  state(c, "making_something");
});

test("background work and dispatch do not imply waiting, blocking calls do", (t) => {
  const { controller: c } = fixture(t, { minDuration: 0 });
  c.background("job", true);
  assert.equal(state(c, "working").background, 1);
  assert.equal(c.snapshot().running, 0);
  c.toolStart("a", "dispatch", "subagent", {});
  state(c, "working", "thinking");
  c.toolEnd("a", "dispatch");
  c.toolStart("a", "poll", "job_output", { wait: false });
  state(c, "working", "terminal");
  c.toolStart("a", "wait", "job_output", { wait: true });
  state(c, "waiting_for_subagents");
  c.toolEnd("a", "wait");
  state(c, "working", "terminal");
  c.toolEnd("a", "poll");
  c.session("a", false);
  state(c, "working");
  c.background("job", false);
  state(c, "idle");
});

test("goal completion attempts remain work until an explicit confirmed success celebration", (t) => {
  const { controller: c, clock } = fixture(t, { minDuration: 0 });
  c.toolStart("a", "complete", "functions.update_goal", { action: "complete" });
  state(c, "working", "thinking");
  clock.advance(100);
  c.toolEnd("a", "complete"); // This call may have failed validation; tool end is not success.
  clock.advance(4000);
  state(c, "working", "thinking");
  assert.ok(c.history().every(entry => entry.state !== "milestone_level_up"));
  c.celebrate(); // The host's goal/change success notification is authoritative.
  state(c, "milestone_level_up");
  clock.advance(3999);
  state(c, "milestone_level_up");
  clock.advance(1);
  state(c, "working", "thinking");
});

test("running metadata updates during display dwell and all returned snapshots are detached", (t) => {
  const { controller: c, clock, changes } = fixture(t);
  const returned = c.session("a", true);
  returned.ids.push("forged");
  changes[0].ids.push("changed callback");
  clock.advance(100);
  c.toolStart("a", "edit", "edit");
  c.session("b", true);
  assert.equal(changes.at(-1).state, "working");
  assert.equal(changes.at(-1).running, 2);
  assert.deepEqual(c.snapshot().ids, ["a", "b"]);
  const snapshot = c.snapshot();
  snapshot.ids.length = 0;
  assert.equal(c.snapshot().running, 2);
  clock.advance(1400);
  state(c, "making_something");
});

test("history is chronological, bounded at thirty records and detached from callers", (t) => {
  const { controller: c } = fixture(t, { minDuration: 0 });
  for (let i = 0; i < 40; i++) c.session("a", i % 2 === 0);
  const history = c.history();
  assert.equal(history.length, 30);
  assert.equal(history.at(-1).state, "idle");
  assert.equal(history[0].state, "working");
  history[0].label = "modified";
  history[0].ids.push("forged");
  history.pop();
  assert.equal(c.history().length, 30);
  assert.notEqual(c.history()[0].label, "modified");
  assert.deepEqual(c.history()[0].ids, ["a"]);
});

test("dispose cancels pending dwell and lease timers, including handle zero and queued callbacks", (t) => {
  const { controller: c, clock, changes } = fixture(t);
  c.session("a", true);
  clock.advance(100);
  c.toolStart("a", "edit", "edit");
  assert.equal(clock.pending(), 1); // The first timer has ID zero.
  c.activity({ state: "making_something", durationMs: 5000 });
  c.celebrate();
  c.dance();
  assert.equal(clock.pending(), 1);
  const before = c.snapshot();
  const count = changes.length;
  c.dispose();
  c.dispose();
  assert.equal(clock.pending(), 0);
  for (const callback of [...clock.callbacks]) callback(); // A callback may already be queued by a host.
  clock.advance(30_000);
  c.session("b", true);
  c.activity({ state: "connecting" });
  c.toolStart("b", "write", "write");
  c.toolEnd("a", "edit");
  c.background("task", true);
  c.connection(false);
  c.setGenerating(true);
  c.celebrate();
  c.dance();
  assert.deepEqual(c.snapshot(), before);
  assert.equal(changes.length, count);
  assert.equal(clock.pending(), 0);
});
