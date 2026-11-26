import { createActivityController, AVATAR_STATES } from '../lib/activity.js';
import { AvatarView, builtin } from './avatar.js';
import { CSS } from './styles.js';
import { createFormState } from './form-state.js';

export const inject = ['sessions', 'remote', 'connection'];
const BASE = '/dsh-typing-buddy';
const LS_CONFIG = 'dsh-typing-buddy.config';
const LS_POS = 'dsh-typing-buddy.pos';
const DEFAULTS = {
  size: 110, name: '小鲸鱼', idleLabel: '', pillPadding: 6, position: 'top-right', offsetX: 22, offsetY: 74,
  minStateDuration: 1500, theme: 'auto', respectReducedMotion: true, desktopEnabled: true,
  compactOnNarrow: true, draggable: true, beacon: true,
};
const STATE_NAMES = { idle: '空闲', working: '工作中', making_something: '制作中', waiting_for_subagents: '等待子任务', connecting: '重新连接', milestone_level_up: '搞定啦', dancing: '跳舞', generating: '生成中' };
const readJSON = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const storeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const clamp = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value != null) node.setAttribute(key, value);
  }
  node.append(...children.filter(Boolean)); return node;
}
function service(ctx, name) { try { return ctx.get ? ctx.get(name) : ctx[name]; } catch { return null; } }

export function apply(ctx) {
  const existing = document.getElementById('dsh-typing-buddy-host');
  if (existing) return;
  let disposed = false, cfg = { ...DEFAULTS }, serverConfig = {}, pack = null, packs = null;
  let state = { state: 'idle', label: '', running: 0, ids: [] }, history = [], hostReachable = true;
  let statusBusy = false, assetsBusy = false, tab = 'activity', isOpen = false, hostVersion = '';
  let authoritativeStatus = null, localConnected = true, lastBeacon = '', candidateViews = [];
  let danceUntil = 0, danceTimeout = null, activityPanelKey = '';
  const cleanup = [], timers = [], controllers = new Set();
  let formNotice = null, formMessage = '形象配置会自动保存';
  const formDraft = createFormState({ request, onStatus(message) {
    formMessage = message;
    if (formNotice?.isConnected) formNotice.textContent = message;
  } });
  const host = element('div', { id: 'dsh-typing-buddy-host' });
  const root = host.attachShadow({ mode: 'open' });
  const style = element('style', { text: CSS });
  const portrait = element('div', { class: 'avatar' });
  const nameNode = element('span', { class: 'name', text: cfg.name });
  const statusNode = element('span', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const activityIcon = element('span', { class: 'activity-icon', 'aria-hidden': 'true' });
  activityIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m14.7 6.3 3 3a1 1 0 0 0 1.4 0l2.4-2.4a6 6 0 0 1-8 6.6l-7.6 7.6a2.1 2.1 0 0 1-3-3l7.6-7.6a6 6 0 0 1 6.6-8l-2.4 2.4a1 1 0 0 0 0 1.4Z"/></svg>';
  const statusRow = element('span', { class: 'status-row', hidden: '' }, activityIcon, statusNode);
  const caption = element('span', { class: 'caption' }, nameNode, statusRow);
  const identity = element('button', { class: 'identity', type: 'button', 'aria-label': '打开小鲸鱼状态面板', 'aria-expanded': 'false', 'aria-controls': 'tb-panel' }, portrait, caption);
  const widget = element('div', { class: 'widget' }, identity);
  const content = element('div');
  const tabs = element('div', { class: 'tabs', role: 'tablist', 'aria-label': '状态面板' });
  for (const [id, text] of [['activity', '活动'], ['appearance', '外观'], ['assets', '形象']]) {
    tabs.append(element('button', { type: 'button', role: 'tab', id: `tb-tab-${id}`, 'aria-controls': 'tb-content', text, onclick: () => { tab = id; renderPanel(); } }));
  }
  const close = element('button', { class: 'close', type: 'button', 'aria-label': '关闭面板', text: '×', onclick: () => togglePanel(false) });
  const panel = element('section', { class: 'panel', id: 'tb-panel', role: 'dialog', 'aria-label': '小鲸鱼状态面板', hidden: '' },
    element('div', { class: 'heading' }, element('strong', { text: '小鲸鱼 · 状态面板' }), close), tabs, content);
  content.id = 'tb-content'; content.setAttribute('role', 'tabpanel');
  root.append(style, widget, panel); (document.body || document.documentElement).append(host);
  const view = new AvatarView(portrait, { onEnded: () => {
    if (state.state === 'dancing') { danceUntil = 0; clearTimeout(danceTimeout); receive(authoritativeStatus || fallback.snapshot()); }
  } });
  const colorQuery = matchMedia('(prefers-color-scheme: dark)');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = () => {
    if (cfg.theme !== 'auto') return cfg.theme === 'dark';
    const doc = document.documentElement;
    if (doc.dataset.theme === 'light' || doc.classList.contains('light')) return false;
    if (doc.dataset.theme === 'dark' || doc.classList.contains('dark')) return true;
    const scheme = getComputedStyle(doc).colorScheme;
    return scheme === 'dark' ? true : scheme === 'light' ? false : colorQuery.matches;
  };
  const fallback = createActivityController({ minDuration: 1500, random: Math.random, turnCelebration: true,
    onChange: next => { if (!authoritativeStatus) receive(next); } });

  async function request(route, body, { keepalive = false } = {}) {
    const abort = new AbortController(); controllers.add(abort);
    const timeout = setTimeout(() => abort.abort(), route === '/status.json' ? 1500 : 4500);
    try {
      const response = await fetch(BASE + route, { cache: 'no-store', credentials: 'same-origin', signal: abort.signal, keepalive,
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      if (!response.ok) { const detail = await response.text(); throw new Error(`请求失败 (${response.status}) ${detail.slice(0, 180)}`); }
      return await response.json();
    } finally { clearTimeout(timeout); controllers.delete(abort); }
  }
  function legacyPortrait() {
    const url = cfg.avatarUrl || cfg.avatar;
    if (cfg.avatarKind === 'file') return BASE + '/avatar';
    return typeof url === 'string' && /^(https?:|data:image\/|\/dsh-typing-buddy\/)/.test(url) ? url : '';
  }
  function shownPack() {
    if (pack) return pack;
    const portrait = legacyPortrait() || builtin;
    return { portrait, portrait_dark: portrait, states: {} };
  }
  function render() {
    if (disposed) return;
    const isDark = dark(); host.dataset.dark = String(isDark); host.dataset.state = state.state;
    const size = cfg.compactOnNarrow && innerWidth < 640 ? Math.round(cfg.size * .8) : cfg.size;
    host.style.setProperty('--avatar-size', `${size}px`); host.style.setProperty('--pill-padding', `${cfg.pillPadding}px`);
    nameNode.textContent = cfg.name; identity.setAttribute('aria-label', `打开${cfg.name}状态面板`);
    const workingLabel = state.state === 'working' && (!state.detail || state.detail === 'thinking')
      ? (state.running > 1 && cfg.textMulti ? cfg.textMulti.replace('{n}', String(state.running)) : cfg.textRunning) : '';
    statusNode.textContent = state.state === 'idle' ? cfg.idleLabel : (workingLabel || state.label || STATE_NAMES[state.state] || '正在思考');
    statusNode.textContent = statusNode.textContent.replace(/(?:\s*\.{3}|\s*…)+\s*$/u, '').trim();
    statusNode.title = statusNode.textContent;
    statusRow.hidden = !statusNode.textContent;
    caption.classList.toggle('has-status', !statusRow.hidden);
    activityIcon.hidden = !['working', 'making_something', 'waiting_for_subagents'].includes(state.state);
    const options = { pack: shownPack(), state: state.state, dark: isDark, legacy: legacyPortrait(), reduced: cfg.respectReducedMotion && motionQuery.matches, hidden: document.hidden };
    view.update(options);
    for (const preview of candidateViews) if (preview.options) preview.update({ ...preview.options, dark: isDark, reduced: options.reduced, hidden: options.hidden || !isOpen });
    if (!options.reduced && !options.hidden) view.preload(shownPack(), isDark);
    position(); if (isOpen && tab === 'activity') renderActivity();
  }
  function position() {
    if (disposed) return;
    const saved = cfg.draggable && readJSON(LS_POS);
    const width = host.offsetWidth, height = widget.offsetHeight;
    host.style.left = host.style.right = host.style.top = host.style.bottom = 'auto'; host.style.transform = '';
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      host.style.left = `${clamp(saved.x, 8, Math.max(8, innerWidth - width - 8), 8)}px`;
      host.style.top = `${clamp(saved.y, 8, Math.max(8, innerHeight - height - 8), 8)}px`;
    } else {
      const pos = cfg.position;
      if (pos.endsWith('left')) host.style.left = `${cfg.offsetX}px`;
      else if (pos === 'top-center') host.style.left = `${Math.max(8, (innerWidth - width) / 2)}px`;
      else host.style.right = `${cfg.offsetX}px`;
      host.style[pos.startsWith('bottom') ? 'bottom' : 'top'] = `${cfg.offsetY}px`;
    }
    if (isOpen) {
      const rect = widget.getBoundingClientRect(); const panelWidth = Math.min(370, innerWidth - 24);
      const fitsLeft = rect.left >= panelWidth + 24;
      const fitsRight = innerWidth - rect.right >= panelWidth + 24;
      if (fitsLeft || fitsRight) {
        panel.style.left = `${fitsLeft ? rect.left - panelWidth - 16 : rect.right + 16}px`;
        panel.style.top = `${clamp(rect.top, 12, Math.max(12, innerHeight - panel.offsetHeight - 12), 12)}px`;
      } else {
        panel.style.left = `${clamp(rect.left + rect.width / 2 - panelWidth / 2, 12, innerWidth - panelWidth - 12, 12)}px`;
        const top = rect.bottom + 12;
        panel.style.top = `${Math.max(12, top + panel.offsetHeight > innerHeight - 12 ? rect.top - panel.offsetHeight - 12 : top)}px`;
      }
    }
  }
  let beaconSentAt = 0;
  function beacon(force = false) {
    if (!cfg.beacon || disposed || document.hidden) return;
    const value = JSON.stringify([state.state, state.label, state.running]);
    const now = Date.now();
    // Repeat even when unchanged: the desktop overlay follows the page that is actually open.
    if (!force && value === lastBeacon && now - beaconSentAt < 2500) return;
    lastBeacon = value; beaconSentAt = now;
    const query = new URLSearchParams({ n: String(state.running || 0), state: state.state,
      label: state.label || '', port: String(location.port || ''), t: String(now) });
    const image = new Image(); image.src = `http://127.0.0.1:48620/s?${query}`;
  }
  function receive(next, events) {
    if (disposed) return;
    state = !localConnected || !hostReachable ? { ...next, state: 'connecting', label: '重新连接', connected: false }
      : danceUntil > Date.now() && next.state !== 'connecting' ? { ...next, state: 'dancing', label: '跳支舞' } : next;
    if (events) history = events;
    render(); beacon();
  }
  function syncConnection() {
    fallback.connection(localConnected && hostReachable);
    receive(authoritativeStatus || fallback.snapshot(), history);
  }
  function applyConfig(raw) {
    serverConfig = raw || serverConfig;
    const saved = readJSON(LS_CONFIG) || {};
    cfg = { ...DEFAULTS, ...serverConfig, ...saved };
    cfg.name = String(saved.name ?? saved.textIdle ?? serverConfig.name ?? serverConfig.textIdle ?? DEFAULTS.name).trim().slice(0, 40) || DEFAULTS.name;
    cfg.size = clamp(cfg.size, 16, 256, 110); cfg.pillPadding = clamp(cfg.pillPadding, 2, 24, 6);
    cfg.offsetX = clamp(cfg.offsetX, 0, Math.max(0, innerWidth - cfg.size), 22);
    cfg.offsetY = clamp(cfg.offsetY, 0, Math.max(0, innerHeight - cfg.size - 30), 74);
    if (!['auto', 'light', 'dark'].includes(cfg.theme)) cfg.theme = 'auto';
    render();
    if (cfg.beacon) {
      const image = new Image(); image.src = 'http://127.0.0.1:48620/config?' + new URLSearchParams({ enabled: cfg.desktopEnabled ? '1' : '0', textIdle: cfg.name, textRunning: cfg.textRunning || '正在思考', textMulti: cfg.textMulti || '正在思考·{n}', t: String(Date.now()) });
    }
  }
  async function pollStatus() {
    if (statusBusy || disposed) return; statusBusy = true;
    try {
      const next = await request('/status.json'); if (disposed) return;
      hostReachable = true;
      if (AVATAR_STATES.includes(next.state)) { authoritativeStatus = next; receive(next, next.history || history); }
    } catch { if (!disposed) { hostReachable = false; syncConnection(); } }
    finally { statusBusy = false; }
  }
  async function pollAssets() {
    if (assetsBusy || disposed) return; assetsBusy = true;
    try {
      const [config, nextPack] = await Promise.all([request('/config.json'), request('/asset-pack.json')]);
      if (disposed) return;
      const version = JSON.stringify(nextPack);
      if (version !== hostVersion) { pack = nextPack; hostVersion = version; }
      fallback.setGenerating(Boolean(nextPack.pending)); applyConfig(config);
    } catch { /* Keep a usable portrait while the host reconnects. */ }
    finally { assetsBusy = false; }
  }
  function togglePanel(open = !isOpen) {
    isOpen = open; panel.hidden = !open; identity.setAttribute('aria-expanded', String(open));
    if (open) { renderPanel(); position(); close.focus(); }
    else { void formDraft.flush(); candidateViews.forEach(preview => preview.dispose()); candidateViews = []; identity.focus(); }
  }
  function renderPanel() {
    void formDraft.flush();
    candidateViews.forEach(v => v.dispose()); candidateViews = [];
    for (const button of tabs.children) button.setAttribute('aria-selected', String(button.id === `tb-tab-${tab}`));
    content.setAttribute('aria-labelledby', `tb-tab-${tab}`);
    content.replaceChildren();
    if (tab === 'activity') renderActivity();
    else if (tab === 'appearance') renderAppearance();
    else renderAssets();
    position();
  }
  function renderActivity() {
    const key = JSON.stringify([state.state, state.label, state.running, state.connected, history, pack?.dances?.length]);
    if (key === activityPanelKey && content.querySelector('.history')) return;
    activityPanelKey = key;
    const list = element('ul', { class: 'history', 'aria-label': '最近活动' });
    for (const item of history.slice(-8).reverse()) {
      list.append(element('li', {}, element('time', { text: new Date(item.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }), element('span', { text: item.label || STATE_NAMES[item.state] || '等待输入' })));
    }
    content.replaceChildren(element('div', { class: 'summary' }, element('b', { text: state.label || STATE_NAMES[state.state] }), element('div', { class: 'muted', text: `${state.running || 0} 个会话运行中 · ${state.connected === false ? '连接恢复中' : '已连接'}` })), list,
      element('p', { class: 'muted', text: '活动跟随 DSH 运行事件自动更新。点击头像查看，拖动头像调整位置。' }));
    if (pack?.dances?.length || pack?.states?.dancing?.video) content.append(element('button', { class: 'action', text: '跳支舞', onclick: () => {
      danceUntil = Date.now() + 10000; clearTimeout(danceTimeout);
      receive(authoritativeStatus || fallback.snapshot());
      danceTimeout = setTimeout(() => { danceUntil = 0; receive(authoritativeStatus || fallback.snapshot()); }, 10000);
    } }));
    position();
  }
  function field(label, input) { return element('label', { class: 'field' }, element('span', { text: label }), input); }
  function renderAppearance() {
    const form = element('form'); const fields = {};
    const input = (key, type = 'text', min, max) => {
      const node = element('input', { name: key, type, value: cfg[key] ?? '', min, max }); fields[key] = node; return node;
    };
    const select = (key, choices) => {
      const node = element('select', { name: key });
      for (const [value, label] of choices) { const option = element('option', { value, text: label }); option.selected = value === cfg[key]; node.append(option); }
      fields[key] = node; return node;
    };
    form.append(field('名字胶囊', input('name')), element('div', { class: 'columns' }, field('头像大小（16–256 px）', input('size', 'number', 16, 256)), field('胶囊内边距', input('pillPadding', 'number', 2, 24))),
      field('空闲文案（可留空）', input('idleLabel')), field('外观', select('theme', [['auto', '跟随系统 / DSH'], ['light', '浅色'], ['dark', '深色']])),
      field('位置', select('position', [['top-right', '右上'], ['top-center', '顶部居中'], ['top-left', '左上'], ['bottom-right', '右下'], ['bottom-left', '左下']])),
      element('div', { class: 'columns' }, field('水平边距', input('offsetX', 'number', 0, 2000)), field('垂直边距', input('offsetY', 'number', 0, 2000))));
    for (const [key, label] of [['respectReducedMotion', '遵循系统减少动态效果'], ['compactOnNarrow', '窄窗口缩小头像'], ['draggable', '允许拖动'], ['desktopEnabled', '同步桌面悬浮层']]) {
      const checkbox = element('input', { type: 'checkbox', name: key }); checkbox.checked = cfg[key] !== false; fields[key] = checkbox;
      form.append(element('label', { class: 'check' }, checkbox, document.createTextNode(label)));
    }
    const notice = element('div', { class: 'notice', role: 'status' });
    form.append(element('div', { class: 'actions' }, element('button', { class: 'action', type: 'button', text: '恢复外观默认', onclick: () => {
      try { localStorage.removeItem(LS_CONFIG); localStorage.removeItem(LS_POS); } catch {} applyConfig(serverConfig); renderPanel();
    } }), element('button', { class: 'action primary', type: 'submit', text: '保存外观' })), notice);
    form.addEventListener('submit', event => {
      event.preventDefault(); const saved = { ...(readJSON(LS_CONFIG) || {}) };
      for (const [key, node] of Object.entries(fields)) saved[key] = node.type === 'checkbox' ? node.checked : node.type === 'number' ? Number(node.value) : node.value.trim();
      storeJSON(LS_CONFIG, saved); try { localStorage.removeItem(LS_POS); } catch {} applyConfig(serverConfig); notice.textContent = '已保存，当前窗口立即生效';
    }); content.append(form);
  }
  function renderAssets() {
    const current = element('div', { class: 'summary' }, element('b', { text: pack?.name || '内置形象' }), element('div', { class: 'muted', text: pack?.pending ? '资产准备中，当前显示默认形象；就绪后自动恢复。' : pack?.missingMedia ? '素材待补齐：清单里的本地文件不存在，当前显示主肖像；补齐文件后自动恢复。' : '当前已激活 · 视频缺失时自动使用主肖像' }));
    void formDraft.load();
    const source = formDraft.bind('importSource', element('textarea', { 'aria-label': '资产包 JSON 或本机清单路径', placeholder: '粘贴资产包 JSON，或本机 manifest.json 的绝对路径' }));
    formNotice = element('div', { class: 'muted form-state-message', role: 'status', text: formMessage });
    const notice = element('div', { class: 'notice', role: 'status' });
    const candidates = element('div', { class: 'candidates' });
    const importButton = element('button', { class: 'action primary', type: 'button', text: '创建预览候选', onclick: async () => {
      importButton.disabled = true; notice.textContent = '正在读取资产…'; notice.classList.remove('error');
      try {
        const value = source.value.trim(); if (!value) throw new Error('请先填写资产包 JSON 或清单路径');
        const body = value.startsWith('{') ? { manifest: JSON.parse(value) } : { manifestPath: value };
        await request('/packs/preview', body); await refreshCandidates(); notice.textContent = '候选已准备好，确认激活后才会替换头像';
      } catch (error) { notice.textContent = error.message; notice.classList.add('error'); }
      finally { importButton.disabled = false; position(); }
    } });
    async function refreshCandidates() {
      packs = await request('/packs'); if (disposed || !isOpen || tab !== 'assets') return;
      candidateViews.forEach(v => v.dispose()); candidateViews = []; candidates.replaceChildren();
      for (const entry of packs.candidates || []) {
        const card = element('div', { class: 'pack-card' }); const avatar = element('div', { class: 'avatar' });
        const preview = new AvatarView(avatar); candidateViews.push(preview);
        const selection = element('select', { 'aria-label': '预览状态' });
        for (const id of AVATAR_STATES) selection.append(element('option', { value: id, text: STATE_NAMES[id] }));
        const update = () => preview.update({ pack: entry.pack, state: selection.value, dark: dark(), reduced: cfg.respectReducedMotion && motionQuery.matches, hidden: document.hidden || !isOpen });
        selection.addEventListener('change', update);
        const activate = element('button', { class: 'action primary', type: 'button', text: '确认激活此形象', onclick: async () => {
          activate.disabled = true;
          try { const result = await request('/packs/activate', { id: entry.id }); pack = result.pack; hostVersion = ''; render(); notice.textContent = '形象已激活'; await refreshCandidates(); }
          catch (error) { notice.textContent = error.message; notice.classList.add('error'); }
          finally { activate.disabled = false; }
        } });
        const missing = entry.pack?.missingMedia ? element('div', { class: 'notice error', text: '该候选缺少自定义素材文件，只能预览主肖像；补齐文件后重新创建候选。' }) : null;
        card.append(element('div', { class: 'pack-name', text: entry.pack?.name || entry.id }), avatar, selection);
        if (missing) card.append(missing);
        card.append(element('div', { class: 'actions' }, activate)); candidates.append(card);
        // Attach first, then start media: a detached <video> can reject autoplay and never become visible.
        update();
      }
      if (!packs.candidates?.length) candidates.append(element('p', { class: 'empty', text: '还没有候选形象' })); position();
    }
    content.append(current, element('p', { class: 'muted', text: '导入主肖像、各状态 MP4 与深色变体。新形象和换装均先预览，再确认激活。生成服务可持续补齐清单中的资产。' }), field('资产包 JSON / 本机清单路径', source), formNotice, importButton, notice, candidates,
      element('div', { class: 'actions' }, element('button', { class: 'action', type: 'button', text: '恢复内置形象', onclick: async event => {
        const button = event.currentTarget; button.disabled = true;
        try { const result = await request('/packs/reset', {}); pack = result.pack; hostVersion = ''; render(); notice.textContent = '已恢复内置形象并清理插件候选记录'; await refreshCandidates(); }
        catch (error) { notice.textContent = error.message; notice.classList.add('error'); }
        finally { button.disabled = false; }
      } })));
    refreshCandidates().catch(error => { notice.textContent = error.message; notice.classList.add('error'); });
  }
  let drag = null, suppressClick = false;
  identity.addEventListener('pointerdown', event => {
    if (!cfg.draggable || event.button !== 0) return;
    const rect = widget.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    identity.setPointerCapture(event.pointerId);
  });
  identity.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return; drag.moved = true;
    const x = clamp(drag.left + dx, 8, Math.max(8, innerWidth - widget.offsetWidth - 8), 8);
    const y = clamp(drag.top + dy, 8, Math.max(8, innerHeight - widget.offsetHeight - 8), 8);
    host.style.left = `${x}px`; host.style.top = `${y}px`; host.style.right = host.style.bottom = 'auto'; host.style.transform = '';
    storeJSON(LS_POS, { x, y }); if (isOpen) position();
  });
  const endDrag = () => { suppressClick = Boolean(drag?.moved); drag = null; };
  identity.addEventListener('pointerup', endDrag); identity.addEventListener('pointercancel', endDrag);
  identity.addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } togglePanel(); });
  host.addEventListener('contextmenu', event => { if (event.composedPath().includes(panel)) return; event.preventDefault(); tab = 'appearance'; togglePanel(true); });
  function listen(target, event, handler) { target.addEventListener(event, handler); cleanup.push(() => target.removeEventListener(event, handler)); }
  listen(document, 'pointerdown', event => { if (isOpen && !event.composedPath().includes(host)) togglePanel(false); });
  listen(document, 'keydown', event => { if (event.key === 'Escape' && isOpen) { event.preventDefault(); togglePanel(false); } });
  listen(window, 'resize', render); listen(window, 'online', () => { localConnected = true; syncConnection(); pollStatus(); });
  listen(window, 'offline', () => { localConnected = false; syncConnection(); });
  listen(window, 'pagehide', () => { void formDraft.flush({ keepalive: true }); });
  listen(document, 'visibilitychange', () => { render(); if (!document.hidden) { pollStatus(); pollAssets(); } });
  listen(window, 'storage', event => { if (event.key === LS_CONFIG) applyConfig(serverConfig); });
  listen(colorQuery, 'change', render); listen(motionQuery, 'change', render);
  const observer = new MutationObserver(render); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }); cleanup.push(() => observer.disconnect());

  function attach(c) {
    const sessions = service(c, 'sessions'), remote = service(c, 'remote'), connection = service(c, 'connection');
    function readSessions() {
      try {
        const byId = sessions?.list?.getSnapshot()?.byId || {};
        const ids = new Set(Object.keys(byId));
        for (const [id, session] of Object.entries(byId)) fallback.session(id, session.running === true || session.status === 'running');
        for (const id of fallback.snapshot().ids || []) if (!ids.has(id)) fallback.session(id, false);
      } catch {}
    }
    if (sessions?.list?.subscribe) cleanup.push(sessions.list.subscribe(readSessions)); readSessions();
    if (remote?.$on) {
      cleanup.push(remote.$on('api-session/status', (id, running) => { fallback.session(id, running); pollStatus(); }));
      cleanup.push(remote.$on('api-session/removed', id => fallback.session(id, false)));
    }
    if (connection?.state?.subscribe) {
      const sync = () => {
        const value = connection.state.getSnapshot();
        localConnected = value === 'connected' || value?.status === 'connected' || value?.state === 'connected';
        syncConnection(); if (localConnected) pollStatus();
      };
      cleanup.push(connection.state.subscribe(sync)); sync();
    }
  }
  if (service(ctx, 'sessions')) attach(ctx);
  else if (typeof ctx.inject === 'function') ctx.inject(['sessions'], c => attach(c));
  else attach(ctx);
  applyConfig({}); pollAssets(); pollStatus(); void formDraft.load();
  timers.push(setInterval(pollStatus, 1200), setInterval(pollAssets, 10000), setInterval(() => formDraft.retry(), 5000));
  const dispose = () => {
    if (disposed) return; disposed = true;
    formDraft.dispose();
    controllers.forEach(abort => abort.abort()); timers.forEach(clearInterval); clearTimeout(danceTimeout);
    cleanup.forEach(off => { try { if (typeof off === 'function') off(); } catch {} });
    fallback.dispose(); view.dispose(); candidateViews.forEach(v => v.dispose()); host.remove();
  };
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose);
  return dispose;
}
