/** Shared, dependency-free activity state for the host and browser. */
export const AVATAR_STATES = Object.freeze([
  "idle",
  "working",
  "making_something",
  "waiting_for_subagents",
  "connecting",
  "milestone_level_up",
  "dancing",
  "generating",
]);

export const DEFAULT_LABELS = Object.freeze({
  idle: "",
  working: "正在思考",
  making_something: "正在制作",
  waiting_for_subagents: "等结果回来",
  connecting: "重新连接",
  milestone_level_up: "搞定啦",
  dancing: "跳支舞",
  generating: "生成中",
  web_browsing: "翻阅网站",
  files: "在翻文件",
  artifact: "正在制作",
  thinking: "正在思考",
  terminal: "运行命令",
  subagents: "等结果回来",
});

const PRIORITY = Object.freeze({
  idle: 0, generating: 1, working: 2, waiting_for_subagents: 3,
  making_something: 4, dancing: 5, milestone_level_up: 6, connecting: 7,
});
const DEFAULT_DETAILS = Object.freeze({
  idle: "idle", working: "thinking", making_something: "artifact",
  waiting_for_subagents: "subagents", connecting: "connecting",
  milestone_level_up: "milestone_level_up", dancing: "dancing", generating: "generating",
});
const STATE_SET = new Set(AVATAR_STATES);
const ACTIVITY_DURATION = 15_000;
const DANCE_DURATION = 10_000;
const GLOBAL_ACTIVITY = Symbol("global activity");

function description(state, detail = DEFAULT_DETAILS[state], label) {
  return { state, detail, label: label ?? DEFAULT_LABELS[detail] ?? DEFAULT_LABELS[state] };
}

function isBuildCommand(value) {
  if (typeof value !== "string") return false;
  const command = value.trim();
  // Recognize direct invocations only; quoted text, shell chains and scripts
  // mentioning a build tool are not enough evidence that a build is running.
  if (/[;&|`\n\r]/.test(command)) return false;
  return /^(?:npm|pnpm|yarn)\s+(?:run\s+)?build(?:\s|$)/.test(command)
    || /^(?:(?:npx|pnpm\s+exec|yarn\s+exec)\s+)?(?:vite|esbuild)\s+build(?:\s|$)/.test(command)
    || /^(?:(?:npx|pnpm\s+exec|yarn\s+exec)\s+)?esbuild\s+(?:[^\n]*\s)?--bundle(?:\s|=|$)/.test(command);
}

/** Tool dispatch itself is work; only an actual blocking wait becomes waiting. */
export function classifyTool(name, args = {}) {
  const tool = String(name ?? "").split(/[./:]/).pop().toLowerCase().replaceAll("-", "_");
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  if (!args || typeof args !== "object") args = {};
  if (tool === "wait_agent" || (tool === "job_output" && args.wait === true)) {
    return description("waiting_for_subagents");
  }
  if (tool === "update_goal" && args.action === "complete") {
    return description("milestone_level_up");
  }
  if (/^(web_search|web_fetch|yunai_read_page|browser|browser_.*|tracking_search)$/.test(tool)) {
    return description("working", "web_browsing");
  }
  if (/^(write|edit|apply_patch|write_file|edit_file)$/.test(tool)) {
    const file = args.file_path ?? args.path ?? args.filePath ?? args.filename;
    const web = typeof file === "string" && /\.(?:html?|css|scss|sass|less|[jt]sx?)$/i.test(file);
    return description("making_something", "files", web ? "正在做网页" : "在整理文档");
  }
  if (/^(read|read_image|glob|grep|read_file|list_files|tracking_read)$/.test(tool)) {
    return description("working", "files");
  }
  if (/^(present|generate_image|generate_video|create_artifact|build_artifact|render.*)$/.test(tool)) {
    return description("making_something", "artifact");
  }
  if (/^(bash|exec|exec_command)$/.test(tool) && isBuildCommand(args.command ?? args.cmd)) {
    return description("making_something", "artifact");
  }
  if (/^(bash|exec|exec_command|job_output|job_kill)$/.test(tool)) {
    return description("working", "terminal");
  }
  return description("working", "thinking");
}

function duration(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function timestamp(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  // Accept real Unix seconds while leaving small virtual-clock values intact.
  return value >= 1e9 && value < 1e11 ? value * 1000 : value;
}

function idOf(value) {
  return value == null || String(value) === "" ? null : String(value);
}

function copy(snapshot) {
  return { ...snapshot, ids: [...snapshot.ids] };
}

function sameDisplay(a, b) {
  return a.state === b.state && a.detail === b.detail && a.label === b.label;
}

function sameSnapshot(a, b) {
  return sameDisplay(a, b) && a.ts === b.ts && a.running === b.running
    && a.background === b.background && a.connected === b.connected
    && a.assetPending === b.assetPending && a.ids.length === b.ids.length
    && a.ids.every((id, index) => id === b.ids[index]);
}

/**
 * Every mutation returns a detached snapshot. Presentation changes honor the
 * current display's minimum duration; connectivity and expired leases bypass it.
 * Activity patches are per-session (or global), expire after 15s by default, and
 * accept durationMs. Event ts is used to reject stale patches, not as a clock.
 */
export function createActivityController({
  onChange = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  minDuration = 1500,
  celebrationDuration = 4000,
  random = null,
  turnCelebration = false,
} = {}) {
  minDuration = duration(minDuration, 1500);
  celebrationDuration = duration(celebrationDuration, 4000);
  const sessions = new Set();
  const tools = new Map();
  const backgrounds = new Set();
  const patches = new Map();
  const overrides = new Map();
  let connected = true;
  let assetPending = false;
  let disposed = false;
  let sequence = 0;
  let timer = null;
  let flair = null;
  let lastTurnCelebration = -Infinity;
  const WORK_VISUALS = Object.freeze(["working", "making_something", "dancing"]);
  // A stable random visual among the three work looks; re-rolled on a 6-12s window.
  const workFlair = (time) => {
    if (random === null) return null;
    if (flair === null || time >= flair.until) {
      let pick = WORK_VISUALS[Math.min(WORK_VISUALS.length - 1,
        Math.max(0, Math.floor(random() * WORK_VISUALS.length)))];
      // Never repeat the same look twice in a row, so a run never looks stuck.
      if (flair !== null && pick === flair.state) {
        pick = WORK_VISUALS[(WORK_VISUALS.indexOf(pick) + 1) % WORK_VISUALS.length];
      }
      flair = { state: pick, until: time + 4000 + Math.floor(random() * 2000) };
    }
    return flair.state;
  };
  let shownAt = -Infinity; // The first real activity need not wait behind startup idle.
  let view = { ...description("idle"), ts: now(), source: "idle" };

  const makeSnapshot = () => ({
    state: view.state, detail: view.detail, label: view.label, ts: view.ts,
    running: sessions.size, ids: [...sessions], connected,
    background: backgrounds.size, assetPending,
  });
  let published = makeSnapshot();
  const records = [copy(published)];

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const choose = () => {
    let best = { ...description("idle"), sequence: -1, source: "idle" };
    const consider = (entry) => {
      if (entry.state === "generating" && !assetPending) return;
      const rank = PRIORITY[entry.state];
      const currentRank = PRIORITY[best.state];
      if (rank > currentRank || (rank === currentRank && entry.sequence > best.sequence)) best = entry;
    };
    if (assetPending) consider({ ...description("generating"), sequence: 0, source: "generating" });
    if (sessions.size || backgrounds.size) {
      consider({ ...description("working"), sequence: 0, source: "working" });
    }
    for (const calls of tools.values()) for (const call of calls.values()) consider(call);
    for (const entry of patches.values()) consider(entry);
    for (const entry of overrides.values()) consider(entry);
    if (!connected) consider({ ...description("connecting"), sequence: Infinity, source: "connection" });
    if (best.state === "working" || best.state === "making_something") {
      const visual = workFlair(now());
      if (visual !== null) best = { ...description(visual), sequence: best.sequence, source: "flair" };
    }
    return best;
  };

  const refresh = (force = false) => {
    if (disposed) return copy(published);
    stopTimer();
    const time = now();
    for (const entries of [patches, overrides]) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= time) {
          entries.delete(key);
          if (entry.source === view.source) force = true;
        }
      }
    }
    const next = choose();
    // Both directions bypass dwell, including a leased connecting activity.
    if (view.state === "connecting" || next.state === "connecting") force = true;
    const changed = !sameDisplay(view, next);
    const canChange = force || time - shownAt >= minDuration;
    if (changed && canChange) {
      view = { ...next, ts: time };
      shownAt = time;
    } else if (!changed) {
      // An equivalent live source must outlast the source it replaced.
      view.source = next.source;
    }

    let deadline = changed && !canChange ? shownAt + minDuration : Infinity;
    for (const entries of [patches, overrides]) {
      for (const entry of entries.values()) deadline = Math.min(deadline, entry.expiresAt);
    }
    if (flair !== null && random !== null) {
      // A stale flair window that no longer applies must not schedule a zero-delay timer.
      if (flair.until > time) deadline = Math.min(deadline, flair.until);
      else if (sessions.size === 0 && tools.size === 0 && backgrounds.size === 0) flair = null;
    }
    if (deadline !== Infinity) {
      timer = setTimer(() => {
        timer = null;
        refresh();
      }, Math.min(2_147_483_647, Math.max(0, deadline - time)));
      if (timer && typeof timer.unref === "function") timer.unref();
    }

    const snapshot = makeSnapshot();
    if (!sameSnapshot(snapshot, published)) {
      if (!sameDisplay(snapshot, published)) {
        records.push(copy(snapshot));
        if (records.length > 30) records.shift();
      }
      published = snapshot;
      onChange(copy(snapshot));
    }
    return copy(published);
  };

  const overlay = (state, lifetime, options = {}) => {
    const time = now();
    overrides.set(state, {
      ...description(state, options.detail || DEFAULT_DETAILS[state], options.label),
      sequence: ++sequence, source: Symbol(state), expiresAt: time + lifetime,
    });
  };

  return {
    session(id, running) {
      if (disposed) return copy(published);
      id = idOf(id);
      if (id === null) return copy(published);
      const wasRunning = sessions.has(id);
      let celebrated = false;
      if (running) sessions.add(id);
      else {
        sessions.delete(id);
        tools.delete(id);
        patches.delete(id);
        // A turn that returned completely counts as a milestone, once per finish.
        if (turnCelebration && wasRunning && now() - lastTurnCelebration > 1000) {
          lastTurnCelebration = now();
          overlay("milestone_level_up", celebrationDuration);
          celebrated = true;
        }
      }
      return refresh(celebrated);
    },

    activity(event) {
      if (disposed || !event || typeof event !== "object") return copy(published);
      const sessionId = idOf(event.sessionId);
      const key = sessionId ?? GLOBAL_ACTIVITY;
      const previous = patches.get(key);
      const time = now();
      const ts = timestamp(event.ts, time);
      if (previous && ts < previous.ts) return copy(published);
      const detail = typeof event.detail === "string" && event.detail.trim() ? event.detail.trim() : undefined;
      const impliedState = detail === "artifact" ? "making_something" : "working";
      const state = event.state ?? (detail ? impliedState : previous?.state ?? "working");
      if (!STATE_SET.has(state)) return copy(published);
      const lifetime = duration(event.durationMs,
        state === "milestone_level_up" ? celebrationDuration : state === "dancing" ? DANCE_DURATION : ACTIVITY_DURATION);
      const expiresAt = Math.min(ts, time) + lifetime;
      if (state === "idle" || expiresAt <= time) {
        patches.delete(key);
      } else {
        const label = typeof event.label === "string" ? event.label.trim() : undefined;
        patches.set(key, {
          ...description(state, detail || (event.state ? DEFAULT_DETAILS[state] : previous?.detail),
            label ?? (!event.state && !detail ? previous?.label : undefined)),
          ts, expiresAt, sequence: ++sequence, source: Symbol("activity"),
        });
      }
      return refresh();
    },

    toolStart(sessionId, callId, name, args) {
      if (disposed) return copy(published);
      sessionId = idOf(sessionId);
      callId = idOf(callId);
      if (sessionId === null || callId === null) return copy(published);
      sessions.add(sessionId);
      let calls = tools.get(sessionId);
      if (!calls) tools.set(sessionId, calls = new Map());
      let activity = classifyTool(name, args);
      if (activity.state === "milestone_level_up") {
        // An attempted goal update is work; celebrate only a confirmed success event.
        activity = description("working", "thinking");
      }
      calls.set(callId, { ...activity, sequence: ++sequence, source: Symbol("tool") });
      return refresh();
    },

    toolEnd(sessionId, callId) {
      if (disposed) return copy(published);
      const id = idOf(sessionId);
      const calls = tools.get(id);
      calls?.delete(idOf(callId));
      if (calls?.size === 0) tools.delete(id);
      return refresh();
    },

    background(id, running) {
      if (disposed) return copy(published);
      id = idOf(id);
      if (id === null) return copy(published);
      if (running) backgrounds.add(id);
      else backgrounds.delete(id);
      return refresh();
    },

    connection(value) {
      if (disposed) return copy(published);
      const previous = connected;
      connected = Boolean(value);
      if (connected) {
        for (const [key, entry] of patches) if (entry.state === "connecting") patches.delete(key);
      }
      return refresh(previous !== connected || view.state === "connecting");
    },

    setGenerating(value) {
      if (disposed) return copy(published);
      assetPending = Boolean(value);
      return refresh();
    },

    celebrate() {
      if (disposed) return copy(published);
      overlay("milestone_level_up", celebrationDuration);
      return refresh();
    },

    dance() {
      if (disposed) return copy(published);
      overlay("dancing", DANCE_DURATION);
      return refresh();
    },

    snapshot() { return copy(published); },
    history() { return records.map(copy); },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      sessions.clear();
      tools.clear();
      backgrounds.clear();
      patches.clear();
      overrides.clear();
    },
  };
}
