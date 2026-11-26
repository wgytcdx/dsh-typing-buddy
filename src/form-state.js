// Host-backed form drafts. Browser cache retains edits while the host reconnects.
export const FORM_DEFAULTS = Object.freeze({
  importSource: '', generationMode: 'create', generationPrompt: '',
  generationReference: '', generationDark: false,
});
const STORAGE_KEY = 'dsh-typing-buddy.form-state';
function fields(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, fallback] of Object.entries(FORM_DEFAULTS)) {
    if (!Object.hasOwn(value, key) || typeof value[key] !== typeof fallback) continue;
    if (key === 'generationMode' && !['create', 'restyle'].includes(value[key])) continue;
    result[key] = value[key];
  }
  return result;
}
export function createFormState({ request, onStatus = () => {} }) {
  let cached;
  try { cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
  let pending = fields(cached?.pending);
  let values = { ...FORM_DEFAULTS, ...fields(cached?.values), ...pending };
  let hydrated = false, disposed = false, loading = null, saving = null, saveTimer = null;
  const nodes = new Map();
  const hasPending = () => Object.keys(pending).length > 0;
  const status = message => { if (!disposed) onStatus(message); };
  function cache() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ values, pending })); return true; }
    catch { status('本地暂存失败，请等待配置保存完成'); return false; }
  }
  function updateNodes() {
    for (const [key, node] of nodes) {
      if (!node.isConnected) continue;
      if (node.type === 'checkbox') node.checked = values[key];
      else if (node.value !== values[key]) node.value = values[key];
    }
  }
  function schedule(delay = 350) {
    clearTimeout(saveTimer);
    if (!disposed && hasPending()) saveTimer = setTimeout(() => { void flush(); }, delay);
  }
  function load() {
    if (disposed || hydrated) return Promise.resolve(hydrated);
    if (loading) return loading;
    loading = (async () => {
      try {
        const saved = await request('/form-state.json');
        if (disposed) return false;
        // New edits always win over a GET started before the user began typing.
        values = { ...FORM_DEFAULTS, ...fields(saved), ...pending };
        hydrated = true;
        cache(); updateNodes();
        status(hasPending() ? '正在保存形象配置' : '形象配置会自动保存');
        schedule();
        return true;
      } catch {
        status('配置已暂存在本窗口，连接恢复后会自动保存');
        return false;
      } finally { loading = null; }
    })();
    return loading;
  }
  function flush(options = {}) {
    clearTimeout(saveTimer);
    if (disposed || !hasPending()) return Promise.resolve();
    if (saving) return saving;
    let success = false;
    saving = (async () => {
      // Finish initial hydration before committing, avoiding stale GET responses.
      if (!hydrated) await load();
      if (disposed || !hasPending()) return;
      const patch = { ...pending };
      try {
        const saved = await request('/form-state', patch, options);
        if (disposed) return;
        for (const key of Object.keys(patch)) if (pending[key] === patch[key]) delete pending[key];
        values = { ...FORM_DEFAULTS, ...fields(saved), ...pending };
        cache(); updateNodes(); success = true;
        status(hasPending() ? '正在保存形象配置' : '形象配置已自动保存');
      } catch {
        cache(); status('配置已暂存在本窗口，连接恢复后会自动保存');
      }
    })().finally(() => {
      saving = null;
      if (!disposed && hasPending()) schedule(success ? 0 : 5000);
    });
    return saving;
  }
  function bind(key, node) {
    if (!Object.hasOwn(FORM_DEFAULTS, key)) throw new Error('Unknown form field');
    nodes.set(key, node);
    if (node.type === 'checkbox') node.checked = values[key]; else node.value = values[key];
    const remember = () => {
      const next = node.type === 'checkbox' ? node.checked : node.value;
      if (values[key] === next) return;
      values[key] = next; pending[key] = next;
      cache(); status('正在保存形象配置'); schedule();
    };
    node.addEventListener('input', remember);
    node.addEventListener('change', () => { remember(); void flush(); });
    node.addEventListener('blur', () => { void flush(); });
    return node;
  }
  return {
    bind, load, flush,
    retry() { if (!hydrated) void load(); if (hasPending()) void flush(); },
    dispose() { disposed = true; clearTimeout(saveTimer); nodes.clear(); },
  };
}
