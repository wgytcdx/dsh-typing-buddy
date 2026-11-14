/**
 * dsh-typing-buddy — node half.
 *
 * 职责三件：
 *  1. 把插件 config 暴露成 /dsh-typing-buddy/config.json，浏览器半区据此渲染；
 *  2. 若 avatar 是本机路径，代理成 /dsh-typing-buddy/avatar 给页面用；
 *  3. 把各会话的 running 状态落到 ~/.muse/dsh-status.json，供桌面悬浮窗（可选）读取。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_FILE = path.join(os.homedir(), ".muse", "dsh-status.json");

export const name = "dsh-typing-buddy";
export const inject = [];

export const DEFAULTS = {
  avatar: "",
  size: 46,
  position: "top-right",
  offsetX: 22,
  offsetY: 74,
  textIdle: "小鲸鱼",
  textRunning: "正在回复",
  textMulti: "正在回复 · {n}",
  showKeyboardIcon: true,
  draggable: true,
  compactOnNarrow: true,
};

/** 归一化用户配置：缺项补默认，数值兜底。 */
function normalize(raw) {
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  cfg.size = Math.max(16, Math.min(128, Number(cfg.size) || DEFAULTS.size));
  cfg.offsetX = Number(cfg.offsetX) || 0;
  cfg.offsetY = Number(cfg.offsetY) || 0;
  for (const k of ["textIdle", "textRunning", "textMulti", "position"]) {
    if (typeof cfg[k] !== "string" || cfg[k].trim() === "") cfg[k] = DEFAULTS[k];
  }
  return cfg;
}

/** 判断 avatar 配置该怎么交给浏览器。 */
function avatarSpec(avatar) {
  const v = String(avatar || "").trim();
  if (!v) return { kind: "builtin" };
  if (/^https?:\/\//i.test(v) || v.startsWith("data:")) return { kind: "url", url: v };
  const abs = v.startsWith("~") ? path.join(os.homedir(), v.slice(1)) : v;
  return { kind: "file", path: abs };
}

function contentTypeOf(file) {
  const e = path.extname(file).toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".svg") return "image/svg+xml";
  return "image/png";
}

export function apply(ctx, rawConfig) {
  const cfg = normalize(rawConfig);
  const spec = avatarSpec(cfg.avatar);
  const running = new Set();
  let timer = null;
  let retryTimer = null;
  let routeDisposers = [];
  let mounted = false;
  let attempts = 0;

  /* ---------- 状态文件（给桌面悬浮窗兜底用） ---------- */
  const writeStatus = () => {
    try {
      fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
      fs.writeFileSync(
        STATUS_FILE,
        JSON.stringify({ running: running.size, ids: [...running], ts: Date.now(), pid: process.pid }),
      );
    } catch (err) {}
  };
  try {
    ctx.on("api-session/status", (sessionId, isRunning) => {
      if (isRunning) running.add(sessionId);
      else running.delete(sessionId);
      writeStatus();
    });
  } catch (err) {}
  writeStatus();
  try {
    timer = setInterval(writeStatus, 2000);
  } catch (err) {}

  /* ---------- 只读配置 + 头像代理（webServer 可选，拿不到就跳过） ---------- */
  const mountRoutes = (web) => {
    const disposers = [];
    const send = (res, code, type, body) => {
      res.writeHead(code, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(body);
    };

    try {
      disposers.push(web.register({
        kind: "exact",
        path: "/dsh-typing-buddy/config.json",
        handler: (req, res) => {
          const payload = {
            ...cfg,
            avatarKind: spec.kind,
            avatarUrl: spec.kind === "file" ? "/dsh-typing-buddy/avatar" : spec.kind === "url" ? spec.url : "",
            version: "0.1.0",
          };
          send(res, 200, "application/json; charset=utf-8", JSON.stringify(payload));
        },
      }));
    } catch (err) {}

    try {
      disposers.push(web.register({
        kind: "exact",
        path: "/dsh-typing-buddy/avatar",
        handler: (req, res) => {
          if (spec.kind === "file") {
            try {
              const bytes = fs.readFileSync(spec.path);
              send(res, 200, contentTypeOf(spec.path), bytes);
              return;
            } catch (err) {}
          }
          const builtin = path.join(PKG_ROOT, "assets", "avatar.jpg");
          try {
            send(res, 200, contentTypeOf(builtin), fs.readFileSync(builtin));
          } catch (err) {
            send(res, 404, "text/plain; charset=utf-8", "no builtin avatar");
          }
        },
      }));
    } catch (err) {}
    routeDisposers = disposers.filter((dispose) => typeof dispose === "function");
  };

  // webServer 未必在 apply 时已就绪：先取一次，取不到就短间隔重试几次
  const tryMount = () => {
    let web = null;
    try {
      web = typeof ctx.get === "function" ? ctx.get("webServer") : ctx.webServer;
    } catch (err) {}
    if (web && typeof web.register === "function") {
      if (!mounted) { mounted = true; mountRoutes(web); }
      return;
    }
    if (attempts++ < 20) {
      retryTimer = setTimeout(tryMount, 500);
    }
  };
  tryMount();

  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      if (timer) clearInterval(timer);
      if (retryTimer) clearTimeout(retryTimer);
      for (const dispose of routeDisposers) {
        try { dispose(); } catch (err) {}
      }
    });
  }
}
