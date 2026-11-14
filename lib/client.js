window.__ModuleLoader__.load({
  id: "dsh-typing-buddy",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const HOST_ID = "dsh-typing-buddy-host";
    const LS_KEY = "dsh-typing-buddy.config";
    const LS_POS = "dsh-typing-buddy.pos";
    const SETTINGS_EVENT = "dsh-typing-buddy:config";
    let react = null;
    try { react = require("react"); } catch (e) {}
    const BUILTIN_AVA = "data:image/jpeg;base64,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";
    const BEACON = "http://127.0.0.1:48620/s";

    const DEFAULTS = {
      avatarKind: "builtin", avatarUrl: "", size: 46,
      position: "top-right", offsetX: 22, offsetY: 74,
      textIdle: "小鲸鱼", textRunning: "正在回复", textMulti: "正在回复 · {n}",
      showKeyboardIcon: true, draggable: true, compactOnNarrow: true,
      beacon: true,
    };

    function readStoredConfig() {
      try {
        const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
        return saved && typeof saved === "object" ? { ...DEFAULTS, ...saved } : { ...DEFAULTS };
      } catch (e) {
        return { ...DEFAULTS };
      }
    }

    function saveStoredConfig(next) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: next })); } catch (e) {}
    }

    function SettingsRow({ label, hint, children }) {
      return react.createElement("label", { style: { display: "grid", gap: 4, marginBottom: 12 } },
        react.createElement("span", { style: { fontWeight: 600 } }, label),
        children,
        hint ? react.createElement("small", { style: { opacity: 0.65 } }, hint) : null);
    }

    function SettingsSection() {
      if (!react) return null;
      const [values, setValues] = react.useState(readStoredConfig);
      const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
      const inputStyle = { width: "100%", boxSizing: "border-box", padding: "7px 9px", border: "1px solid var(--dsw-alias-border-default, #444)", borderRadius: 6, background: "var(--dsw-alias-bg-tertiary, #222)", color: "inherit" };
      const save = () => saveStoredConfig({
        ...values,
        size: Math.max(16, Math.min(128, Number(values.size) || DEFAULTS.size)),
        offsetX: Number(values.offsetX) || 0,
        offsetY: Number(values.offsetY) || 0,
      });
      const reset = () => {
        try { localStorage.removeItem(LS_KEY); } catch (e) {}
        setValues({ ...DEFAULTS });
        try { window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { ...DEFAULTS } })); } catch (e) {}
      };
      const textInput = (key, placeholder) => react.createElement("input", {
        type: "text", value: values[key] || "", placeholder, style: inputStyle,
        onChange: (event) => set(key, event.target.value),
      });
      const numberInput = (key, min, max) => react.createElement("input", {
        type: "number", value: values[key], min, max, style: inputStyle,
        onChange: (event) => set(key, event.target.value),
      });
      return react.createElement("div", { style: { maxWidth: 560, padding: "4px 0 20px" } },
        react.createElement("h2", { style: { margin: "0 0 6px" } }, "小鲸鱼悬浮窗"),
        react.createElement("p", { style: { margin: "0 0 18px", opacity: 0.7 } }, "自定义头像、名称和任务状态文字，保存后立即作用于当前窗口。"),
        react.createElement(SettingsRow, { label: "头像 URL 或本机路径", hint: "留空使用包内头像。" }, textInput("avatarUrl", "https://… 或 /Users/…/avatar.png")),
        react.createElement(SettingsRow, { label: "名称 / 空闲文字" }, textInput("textIdle", "例如：小鲸鱼")),
        react.createElement(SettingsRow, { label: "单任务状态文字" }, textInput("textRunning", "例如：正在回复")),
        react.createElement(SettingsRow, { label: "多任务状态文字", hint: "使用 {n} 插入运行中的会话数量。" }, textInput("textMulti", "例如：正在回复 · {n}")),
        react.createElement(SettingsRow, { label: "位置" }, react.createElement("select", { value: values.position, style: inputStyle, onChange: (event) => set("position", event.target.value) },
          ["top-right", "top-center", "top-left", "bottom-right", "bottom-left"].map((item) => react.createElement("option", { key: item, value: item }, item)))),
        react.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 } },
          react.createElement(SettingsRow, { label: "尺寸（px）" }, numberInput("size", 16, 128)),
          react.createElement(SettingsRow, { label: "横向偏移（px）" }, numberInput("offsetX", 0, 500)),
          react.createElement(SettingsRow, { label: "纵向偏移（px）" }, numberInput("offsetY", 0, 500))),
        react.createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, margin: "4px 0 18px" } },
          react.createElement("input", { type: "checkbox", checked: values.showKeyboardIcon !== false, onChange: (event) => set("showKeyboardIcon", event.target.checked) }),
          "任务运行时显示键盘图标"),
        react.createElement("div", { style: { display: "flex", gap: 8 } },
          react.createElement("button", { type: "button", onClick: reset }, "恢复默认"),
          react.createElement("button", { type: "button", onClick: save }, "保存设置")));
    }

    let cfg = { ...DEFAULTS };
    let host = null, timer = null, panel = null;
    const runningIds = new Set();

    const CSS = `
    #${HOST_ID}{position:fixed;z-index:2147483000;display:flex;flex-direction:row;align-items:center;
      opacity:0;pointer-events:none;transition:opacity .18s ease;user-select:none;-webkit-user-select:none;
      font-family:-apple-system,"PingFang SC","Noto Sans SC",system-ui,sans-serif;}
    #${HOST_ID}.on{opacity:1;pointer-events:auto;}
    #${HOST_ID}.drag{cursor:grab}
    #${HOST_ID}.dragging{cursor:grabbing}
    #${HOST_ID} .tb-ava{border-radius:50%;object-fit:cover;display:block;
      box-shadow:0 0 0 3px rgba(255,255,255,.6),0 8px 22px rgba(0,0,0,.35);}
    #${HOST_ID} .tb-pill{display:flex;align-items:center;gap:6px;padding:10px 16px 10px 20px;border-radius:999px;
      background:rgba(88,88,86,.93);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
      box-shadow:0 6px 18px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.08);}
    #${HOST_ID} .tb-label{color:#fff;font-size:14px;font-weight:600;line-height:1;white-space:nowrap;}
    #${HOST_ID} .tb-kb{display:flex;align-items:center;}
    #${HOST_ID} .tb-kb svg{width:14px;height:14px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
    #${HOST_ID} .tb-panel{position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:8px;
      width:260px;background:rgba(28,28,30,.97);border:1px solid rgba(255,255,255,.12);border-radius:12px;
      padding:12px;color:#eee;font-size:12px;box-shadow:0 12px 32px rgba(0,0,0,.45);pointer-events:auto;display:none}
    #${HOST_ID} .tb-panel.on{display:block}
    #${HOST_ID} .tb-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0}
    #${HOST_ID} .tb-row label{opacity:.75;white-space:nowrap}
    #${HOST_ID} .tb-row input[type=text],#${HOST_ID} .tb-row input[type=number],#${HOST_ID} .tb-row select{
      flex:1;min-width:0;background:#1b1b1e;border:1px solid #333;border-radius:6px;color:#eee;padding:3px 6px;font-size:12px}
    #${HOST_ID} .tb-actions{display:flex;gap:8px;margin-top:10px}
    #${HOST_ID} .tb-actions button{flex:1;background:#2a2a2e;border:1px solid #3a3a40;color:#eee;border-radius:6px;padding:5px;font-size:12px;cursor:pointer}
    #${HOST_ID} .tb-actions button.primary{background:#3b6ea5;border-color:#4a7fbc}
    `;

    function applyPosition() {
      if (!host) return;
      const pos = cfg.position;
      host.style.left = host.style.right = host.style.top = host.style.bottom = "auto";
      if (pos === "top-center") { host.style.left = "50%"; host.style.transform = "translateX(-50%)"; host.style.top = cfg.offsetY + "px"; }
      else if (pos === "bottom-right") { host.style.right = cfg.offsetX + "px"; host.style.bottom = cfg.offsetY + "px"; }
      else if (pos === "bottom-left") { host.style.left = cfg.offsetX + "px"; host.style.bottom = cfg.offsetY + "px"; }
      else if (pos === "top-left") { host.style.left = cfg.offsetX + "px"; host.style.top = cfg.offsetY + "px"; }
      else { host.style.right = cfg.offsetX + "px"; host.style.top = cfg.offsetY + "px"; }
      try {
        const saved = JSON.parse(localStorage.getItem(LS_POS) || "null");
        if (saved && typeof saved.x === "number" && cfg.draggable) {
          host.style.left = saved.x + "px"; host.style.top = saved.y + "px";
          host.style.right = host.style.bottom = "auto"; host.style.transform = "none";
        }
      } catch (e) {}
    }

    function avatarSrc() {
      if (cfg.avatarKind === "url" && cfg.avatarUrl) return cfg.avatarUrl;
      if (cfg.avatarKind === "file") return "/dsh-typing-buddy/avatar";
      return BUILTIN_AVA;
    }

    function render() {
      if (!host) return;
      const size = cfg.compactOnNarrow && window.innerWidth < 640 ? Math.round(cfg.size * 0.8) : cfg.size;
      const ava = host.querySelector(".tb-ava");
      ava.style.width = size + "px"; ava.style.height = size + "px";
      ava.style.marginRight = "-8px";
      const pill = host.querySelector(".tb-pill");
      pill.style.marginTop = "0";
      const kb = host.querySelector(".tb-kb");
      if (kb) kb.style.display = cfg.showKeyboardIcon && host.dataset.running === "1" ? "flex" : "none";
      applyPosition();
    }

    function textFor(n) {
      if (n <= 0) return cfg.textIdle;
      if (n > 1) return String(cfg.textMulti).replace("{n}", String(n));
      return cfg.textRunning;
    }

    function build() {
      if (document.getElementById(HOST_ID)) { host = document.getElementById(HOST_ID); return; }
      host = document.createElement("div");
      host.id = HOST_ID;
      host.innerHTML =
        "<style>" + CSS + "</style>" +
        '<img class="tb-ava" alt="" draggable="false">' +
        '<div class="tb-pill"><span class="tb-kb"><svg viewBox="0 0 24 24">' +
          '<rect x="2.5" y="6.5" width="19" height="11" rx="3"/>' +
          '<circle cx="7" cy="10.3" r=".8" fill="#fff" stroke="none"/><circle cx="12" cy="10.3" r=".8" fill="#fff" stroke="none"/>' +
          '<circle cx="17" cy="10.3" r=".8" fill="#fff" stroke="none"/><circle cx="7" cy="13.8" r=".8" fill="#fff" stroke="none"/>' +
          '<circle cx="12" cy="13.8" r=".8" fill="#fff" stroke="none"/><circle cx="17" cy="13.8" r=".8" fill="#fff" stroke="none"/>' +
        '</svg></span><span class="tb-label">…</span></div>' +
        '<div class="tb-panel"></div>';
      (document.body || document.documentElement).appendChild(host);
      host.querySelector(".tb-ava").src = avatarSrc();
      bindDrag();
      bindPanel();
      host.addEventListener("contextmenu", (e) => { e.preventDefault(); togglePanel(); });
    }

    function bindDrag() {
      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      host.addEventListener("pointerdown", (e) => {
        if (!cfg.draggable || e.button !== 0) return;
        const r = host.getBoundingClientRect();
        dragging = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        host.classList.add("dragging");
        try { host.setPointerCapture(e.pointerId); } catch (err) {}
      });
      host.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const x = Math.max(0, Math.min(window.innerWidth - host.offsetWidth, ox + e.clientX - sx));
        const y = Math.max(0, Math.min(window.innerHeight - host.offsetHeight, oy + e.clientY - sy));
        host.style.left = x + "px"; host.style.top = y + "px";
        host.style.right = host.style.bottom = "auto"; host.style.transform = "none";
      });
      const end = () => {
        if (!dragging) return;
        dragging = false; host.classList.remove("dragging");
        try { localStorage.setItem(LS_POS, JSON.stringify({ x: host.offsetLeft, y: host.offsetTop })); } catch (e) {}
      };
      host.addEventListener("pointerup", end);
      host.addEventListener("pointercancel", end);
    }

    function togglePanel() {
      if (!panel) return;
      if (panel.classList.contains("on")) { panel.classList.remove("on"); return; }
      panel.innerHTML =
        '<div class="tb-row"><label>头像 URL / 路径</label><input type="text" id="tb-ava" value="' + (cfg.avatarUrl || "") + '" placeholder="https://… 或 /Users/…"></div>' +
        '<div class="tb-row"><label>尺寸</label><input type="number" id="tb-size" min="16" max="128" value="' + cfg.size + '"></div>' +
        '<div class="tb-row"><label>位置</label><select id="tb-pos">' +
          ["top-right","top-center","top-left","bottom-right","bottom-left"].map(function(p){return '<option value="'+p+'"'+(cfg.position===p?' selected':'')+'>'+p+'</option>';}).join("") +
        '</select></div>' +
        '<div class="tb-row"><label>空闲文字</label><input type="text" id="tb-idle" value="' + cfg.textIdle + '"></div>' +
        '<div class="tb-row"><label>工作文字</label><input type="text" id="tb-run" value="' + cfg.textRunning + '"></div>' +
        '<div class="tb-row"><label>多会话文字</label><input type="text" id="tb-multi" value="' + cfg.textMulti + '"></div>' +
        '<div class="tb-actions"><button id="tb-reset">恢复默认</button><button class="primary" id="tb-save">保存</button></div>';
      panel.classList.add("on");
      panel.querySelector("#tb-save").onclick = () => {
        cfg.avatarUrl = panel.querySelector("#tb-ava").value.trim();
        cfg.avatarKind = cfg.avatarUrl ? (/^https?:\/\//i.test(cfg.avatarUrl) ? "url" : "file") : "builtin";
        cfg.size = Math.max(16, Math.min(128, Number(panel.querySelector("#tb-size").value) || 46));
        cfg.position = panel.querySelector("#tb-pos").value;
        cfg.textIdle = panel.querySelector("#tb-idle").value || DEFAULTS.textIdle;
        cfg.textRunning = panel.querySelector("#tb-run").value || DEFAULTS.textRunning;
        cfg.textMulti = panel.querySelector("#tb-multi").value || DEFAULTS.textMulti;
        try { localStorage.setItem(LS_KEY, JSON.stringify({
          avatarUrl: cfg.avatarUrl, avatarKind: cfg.avatarKind, size: cfg.size, position: cfg.position,
          textIdle: cfg.textIdle, textRunning: cfg.textRunning, textMulti: cfg.textMulti })); } catch (e) {}
        try { localStorage.removeItem(LS_POS); } catch (e) {}
        host.querySelector(".tb-ava").src = avatarSrc();
        render();
        panel.classList.remove("on");
      };
      panel.querySelector("#tb-reset").onclick = () => {
        try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_POS); } catch (e) {}
        location.reload();
      };
    }

    function beacon(n) {
      if (!cfg.beacon) return;
      try { const img = new Image(); img.src = BEACON + "?n=" + n + "&t=" + Date.now(); } catch (e) {}
    }

    function update(n) {
      if (!host) return;
      const running = n > 0;
      host.dataset.running = running ? "1" : "0";
      host.classList.add("on");
      const label = host.querySelector(".tb-label");
      if (label) label.textContent = textFor(n);
      const kb = host.querySelector(".tb-kb");
      if (kb) kb.style.display = cfg.showKeyboardIcon && running ? "flex" : "none";
      beacon(n);
    }

    function readState(sessions) {
      let n = 0;
      try {
        const snap = sessions && sessions.list && sessions.list.getSnapshot && sessions.list.getSnapshot();
        if (snap && snap.byId) for (const k in snap.byId) {
          const s = snap.byId[k];
          if (s && (s.running === true || s.status === "running")) n++;
        }
      } catch (e) {}
      if (runningIds.size > n) n = runningIds.size;
      update(n);
    }

    function applyConfig(raw) {
      cfg = { ...DEFAULTS, ...(raw || {}) };
      if ((!cfg.avatarUrl || cfg.avatarKind === "builtin") && raw && raw.avatar) {
        cfg.avatarKind = /^https?:\/\//i.test(raw.avatar) || String(raw.avatar).startsWith("data:") ? "url" : "file";
        cfg.avatarUrl = raw.avatar;
      }
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) {}
      if (saved) cfg = { ...cfg, ...saved };
      if (cfg.avatarUrl) cfg.avatarKind = /^https?:\/\//i.test(cfg.avatarUrl) || String(cfg.avatarUrl).startsWith("data:") ? "url" : "file";
      if (host) host.querySelector(".tb-ava").src = avatarSrc();
      render();
    }

    async function loadConfig() {
      const urls = ["/dsh-typing-buddy/config.json", "http://127.0.0.1:62223/dsh-typing-buddy/config.json"];
      for (const u of urls) {
        try {
          const res = await fetch(u, { cache: "no-store" });
          if (res.ok) return applyConfig(await res.json());
        } catch (e) {}
      }
      applyConfig(null);
    }

    function start(sessions, remote) {
      const tick = () => { try { readState(sessions); } catch (e) {} };
      let offStore = null, offStatus = null;
      try { if (sessions && sessions.list && sessions.list.subscribe) offStore = sessions.list.subscribe(tick); } catch (e) {}
      try {
        if (remote && typeof remote.$on === "function") {
          offStatus = remote.$on("api-session/status", (id, isRunning) => {
            if (isRunning) runningIds.add(id); else runningIds.delete(id);
            setTimeout(tick, 20);
          });
        }
      } catch (e) {}
      tick();
      timer = setInterval(tick, 1200);
      return () => {
        try { offStore && offStore(); } catch (e) {}
        try { offStatus && offStatus(); } catch (e) {}
        clearInterval(timer);
        const el = document.getElementById(HOST_ID);
        if (el) el.remove();
      };
    }

    function registerSettings(ctx) {
      if (!ctx.slots || typeof ctx.slots.inject !== "function" || typeof ctx.slots.register !== "function") return () => {};
      try {
        return ctx.slots.inject("settings.section", () => {
          const unregister = ctx.slots.register({
            name: "settings.section",
            id: "dsh-typing-buddy",
            order: 180,
            label: () => "小鲸鱼悬浮窗",
          }, SettingsSection);
          return () => { try { unregister && unregister(); } catch (e) {} };
        });
      } catch (e) {
        return () => {};
      }
    }

    function apply(ctx) {
      build();
      panel = host.querySelector(".tb-panel");
      loadConfig();
      const onSettingsConfig = (event) => applyConfig(event.detail || {});
      window.addEventListener(SETTINGS_EVENT, onSettingsConfig);
      let dispose = null;
      const boot = (s, r) => { try { dispose = start(s, r); } catch (e) { console.warn("[dsh-typing-buddy]", e); } };
      let s = null, r = null;
      try { s = ctx.get ? ctx.get("sessions") : ctx.sessions; } catch (e) {}
      try { r = ctx.get ? ctx.get("remote") : ctx.remote; } catch (e) {}
      if (s) boot(s, r);
      else if (typeof ctx.inject === "function") {
        try { ctx.inject(["sessions"], (c) => {
          let ss = null, rr = null;
          try { ss = c.get ? c.get("sessions") : c.sessions; } catch (e) { try { ss = c.sessions; } catch (e2) {} }
          try { rr = c.get ? c.get("remote") : c.remote; } catch (e) {}
          boot(ss, rr);
        }); } catch (e) {}
      }
      window.addEventListener("resize", render);
      const disposeSettings = registerSettings(ctx);
      if (typeof ctx.effect === "function") ctx.effect(() => () => {
        try { dispose && dispose(); } catch (e) {}
        try { disposeSettings(); } catch (e) {}
        window.removeEventListener(SETTINGS_EVENT, onSettingsConfig);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
