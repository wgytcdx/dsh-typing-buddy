// Standalone smoke test: actual client bundle, an isolated HTTP fixture, no real profile or HOME writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AVATAR_STATES, DEFAULT_LABELS } from '../lib/activity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, 'test-results');
const [bundle, portrait] = await Promise.all([
  fs.readFile(path.join(root, 'lib/client.js')),
  fs.readFile(path.join(root, 'assets/avatar.jpg')),
]);
// A 1s, 32x32 H.264 fixture, embedded so the test does not need ffmpeg or network access.
const video = Buffer.from('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', 'base64');
const base = '/dsh-typing-buddy';
const imageURL = `${base}/media/portrait.jpg`;
const initialPack = {
  id: 'smoke-active', name: '浏览器测试形象', portrait: imageURL, portrait_dark: `${imageURL}?dark`,
  states: {
    idle: { poster: imageURL },
    working: { video: `${base}/media/light.mp4`, video_dark: `${base}/media/dark.mp4`, poster: imageURL, poster_dark: `${imageURL}?dark` },
    making_something: { video: `${base}/media/broken.mp4`, poster: imageURL },
    dancing: { video: `${base}/media/light.mp4`, poster: imageURL },
    milestone_level_up: { video: `${base}/media/light.mp4`, poster: imageURL },
  },
};
let activePack = structuredClone(initialPack);
let candidates = [];
let activations = 0;
let configOverrides = {};
let generationInfo = { available: false, models: {}, jobs: [] };
const generationCalls = [];
const requests = [];
const history = [];
let status;
function setStatus(state, label = DEFAULT_LABELS[state]) {
  const running = ['working', 'making_something', 'waiting_for_subagents'].includes(state) ? 2 : 0;
  status = { state, label, detail: state, running, ids: running ? ['one', 'two'] : [], connected: state !== 'connecting', ts: Date.now() };
  history.push({ ...status });
  status.history = history.slice(-30);
}
setStatus('idle');

const bootstrap = `
const sessionListeners = new Set(), connectionListeners = new Set(), remoteListeners = new Map(), effects = [];
let byId = {}, connectionValue = { status: 'connected' };
window.__media = { plays: 0, elements: new Set() };
for (const method of ['play', 'load']) {
  const original = HTMLMediaElement.prototype[method];
  HTMLMediaElement.prototype[method] = function(...args) {
    window.__media.elements.add(this); if (method === 'play') window.__media.plays++;
    return original.apply(this, args);
  };
}
function store(listeners, snapshot) { return {
  getSnapshot: snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
}; }
const services = {
  sessions: { list: store(sessionListeners, () => ({ byId })) },
  connection: { state: store(connectionListeners, () => connectionValue) },
  remote: { $on(event, fn) {
    if (!remoteListeners.has(event)) remoteListeners.set(event, new Set());
    remoteListeners.get(event).add(fn); return () => remoteListeners.get(event).delete(fn);
  } },
};
window.harness = {
  emit(event, ...args) { for (const fn of [...(remoteListeners.get(event) || [])]) fn(...args); },
  sessions(value) { byId = value; for (const fn of [...sessionListeners]) fn(); },
  connection(value) { connectionValue = { status: value }; for (const fn of [...connectionListeners]) fn(); },
  stats() { return { sessions: sessionListeners.size, connection: connectionListeners.size,
    remote: [...remoteListeners.values()].reduce((n, set) => n + set.size, 0), effects: effects.length }; },
  dispose() { for (const dispose of effects.splice(0)) dispose(); },
};
window.__ModuleLoader__ = { load(spec) {
  window.plugin = spec.factory(() => { throw new Error('Unexpected external module'); });
  window.plugin.apply({ get(name) { return services[name]; }, effect(factory) { effects.push(factory()); } });
} };
`;
const html = `<!doctype html><meta charset="utf-8"><title>Buddy isolated browser smoke</title>
<style>body{margin:0;min-height:100vh;background:#f5f7fb;color:#334155;font:16px system-ui}main{padding:48px;max-width:650px}h1{font-size:26px}p{color:#64748b}html.dark body{background:#0f1723;color:#eef2f8}html.dark p{color:#a3b3ca}</style>
<main><h1>小鲸鱼 · 浏览器冒烟</h1><p>独立测试页面：真实客户端、同源模拟 API、隔离的浏览器存储。</p></main>
<script>${bootstrap}</script><script src="/client.js"></script>`;

function json(res, value, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let value = '';
  for await (const chunk of req) { value += chunk; if (value.length > 100_000) throw new Error('Fixture body too large'); }
  return JSON.parse(value || '{}');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  requests.push({ method: req.method, path: url.pathname });
  try {
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
    if (url.pathname === '/client.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle); }
    if (url.pathname === `${base}/config.json`) return json(res, { name: '测试小鲸鱼', beacon: false, size: 110, theme: 'auto', respectReducedMotion: true, ...configOverrides });
    if (url.pathname === `${base}/status.json`) return json(res, status);
    if (url.pathname === `${base}/asset-pack.json`) return json(res, activePack);
    if (url.pathname === `${base}/packs` && req.method === 'GET') return json(res, { active: activePack, candidates });
    if (url.pathname === `${base}/packs/preview` && req.method === 'POST') {
      const input = await body(req);
      const pack = input.manifest || { ...initialPack, id: 'candidate-path', name: '本机候选' };
      candidates.push({ id: pack.id || 'candidate', pack });
      return json(res, candidates.at(-1));
    }
    if (url.pathname === `${base}/packs/activate` && req.method === 'POST') {
      const { id } = await body(req);
      const match = candidates.find(item => item.id === id);
      if (!match) return json(res, { error: 'missing candidate' }, 404);
      activePack = structuredClone(match.pack); activations++;
      return json(res, { pack: activePack });
    }
    if (url.pathname === `${base}/packs/reset` && req.method === 'POST') {
      activePack = structuredClone(initialPack); candidates = [];
      return json(res, { pack: activePack });
    }
    if (url.pathname === `${base}/media/portrait.jpg`) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(portrait); }
    if ([`${base}/media/light.mp4`, `${base}/media/dark.mp4`].includes(url.pathname)) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), video.length - 1) : video.length - 1;
      res.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(match ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` } : {}) });
      return res.end(video.subarray(start, end + 1));
    }
    if (url.pathname === `${base}/generation.json`) return json(res, generationInfo);
    if (url.pathname === `${base}/generation` && req.method === 'POST') {
      const input = await body(req);
      generationCalls.push(input);
      return json(res, { job: { id: `mock-job-${generationCalls.length}`, status: 'queued', ...input } });
    }
    return json(res, { error: 'fixture route not found' }, 404);
  } catch (error) { return json(res, { error: error.message }, 500); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(value => value && existsSync(value));
let browser;
let checked = 0;
const errors = [];
async function check(title, run) { await run(); console.log(`ok ${++checked} - ${title}`); }
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  // Do not send legacy beacons to any real desktop agent listening on the machine.
  await context.route('http://127.0.0.1:48620/**', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push(`Unexpected dialog: ${dialog.message()}`); await dialog.dismiss(); });
  page.setDefaultTimeout(7000);
  const host = page.locator('#dsh-typing-buddy-host');
  const mainImage = host.locator('.widget .portrait');
  const identity = host.locator('.identity');
  const panel = host.locator('.panel');
  const waitState = expected => page.waitForFunction(value => document.querySelector('#dsh-typing-buddy-host')?.dataset.state === value, expected);
  async function publish(next, label) {
    setStatus(next, label);
    await page.evaluate(running => window.harness.emit('api-session/status', 'smoke-session', running), status.running > 0);
    await waitState(next);
    await page.waitForFunction(expected => {
      const node = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.status');
      return node?.textContent === expected;
    }, next === 'idle' ? '' : status.label);
  }
  await page.goto(origin);
  await mainImage.waitFor();
  await page.waitForFunction(() => document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.name').textContent === '测试小鲸鱼');

  await check('actual bundle mounts, eight states render, identity stays independent', async () => {
    assert.equal(await host.evaluate(node => node.shadowRoot.mode), 'open');
    assert.deepEqual(await page.evaluate(() => window.harness.stats()), { sessions: 1, connection: 1, remote: 2, effects: 1 });
    for (const next of AVATAR_STATES) {
      await publish(next);
      assert.equal(await host.locator('.name').textContent(), '测试小鲸鱼');
      assert.equal(await host.locator('.widget .avatar').getAttribute('data-state'), next);
    }
  });

  await check('click opens activity history and closes without changing identity', async () => {
    await publish('waiting_for_subagents');
    await identity.click();
    assert.equal(await panel.isVisible(), true);
    assert.equal(await identity.getAttribute('aria-expanded'), 'true');
    assert.ok(await host.locator('.history li').count() > 0);
    assert.match(await host.locator('.summary').textContent(), /2 个会话运行中/);
    const avatarBox = await host.locator('.widget .avatar').boundingBox();
    const panelBox = await panel.boundingBox();
    const overlaps = avatarBox.x < panelBox.x + panelBox.width && avatarBox.x + avatarBox.width > panelBox.x
      && avatarBox.y < panelBox.y + panelBox.height && avatarBox.y + avatarBox.height > panelBox.y;
    assert.equal(overlaps, false, 'activity panel must leave the avatar visible at an 800px viewport height');
    await fs.mkdir(results, { recursive: true });
    await page.screenshot({ path: path.join(results, 'buddy-light.png') });
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
  });

  await check('appearance persists across reload and user strings remain text, without XSS', async () => {
    await identity.click();
    await host.getByRole('tab', { name: '外观', exact: true }).click();
    const payload = '<img src=x onerror=window.xss=1>';
    await host.locator('input[name=name]').fill(payload);
    await host.locator('input[name=size]').fill('126');
    await host.getByRole('button', { name: '保存外观', exact: true }).click();
    assert.equal(await host.locator('.name').textContent(), payload);
    assert.equal(await host.locator('.name img').count(), 0);
    assert.equal(await page.evaluate(() => window.xss), undefined);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-typing-buddy.config')).size), 126);
    await page.reload();
    await page.waitForFunction(value => document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.name').textContent === value, payload);
    assert.equal(await host.evaluate(node => node.style.getPropertyValue('--avatar-size')), '126px');
    await identity.click();
    await host.getByRole('tab', { name: '外观', exact: true }).click();
    await host.locator('input[name=name]').fill('浏览器小鲸鱼');
    await host.getByRole('button', { name: '保存外观', exact: true }).click();
    await page.keyboard.press('Escape');
  });

  await check('dark mode selects dark video, normal video really decodes and plays', async () => {
    await publish('working');
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget video.visible');
      return video?.src.endsWith('/light.mp4') && !video.paused && video.readyState >= 2;
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForFunction(() => {
      const host = document.querySelector('#dsh-typing-buddy-host');
      const video = host?.shadowRoot.querySelector('.widget video.visible');
      return host?.dataset.dark === 'true' && video?.src.endsWith('/dark.mp4') && !video.paused;
    });
    assert.equal(await mainImage.getAttribute('src'), `${imageURL}?dark`);
    await publish('waiting_for_subagents');
    await identity.click();
    await host.getByRole('tab', { name: '活动', exact: true }).click();
    await page.screenshot({ path: path.join(results, 'buddy-dark.png') });
    await page.keyboard.press('Escape');
  });

  await check('bad video falls back to a loaded image with all video layers hidden', async () => {
    await publish('making_something');
    await page.waitForFunction(() => {
      const root = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot;
      const image = root?.querySelector('.widget img');
      const videos = [...(root?.querySelectorAll('.widget video') || [])];
      return image?.naturalWidth > 0 && videos.every(video => video.paused && !video.classList.contains('visible'));
    });
    assert.ok(requests.some(item => item.path.endsWith('/broken.mp4')));
  });

  await check('candidate previews do not activate until confirmation, and candidate names are escaped', async () => {
    await publish('idle');
    await identity.click();
    await host.getByRole('tab', { name: '形象', exact: true }).click();
    const candidate = {
      id: 'candidate-smoke', name: '<img src=x onerror=window.xss=2>', portrait: `${imageURL}?candidate`,
      states: { idle: { video: `${base}/media/light.mp4`, video_dark: `${base}/media/dark.mp4` } },
    };
    await host.getByRole('textbox', { name: '资产包 JSON 或本机清单路径' }).fill(JSON.stringify(candidate));
    await host.getByRole('button', { name: '创建预览候选', exact: true }).click();
    await host.locator('.candidates .pack-card').first().waitFor();
    assert.equal(activations, 0);
    assert.equal(activePack.id, 'smoke-active');
    assert.equal(await mainImage.getAttribute('src'), imageURL);
    assert.equal(await host.locator('.candidates .pack-name').textContent(), candidate.name);
    assert.equal(await host.locator('.candidates .pack-name img').count(), 0);
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.candidates video.visible');
      return video?.src.endsWith('/dark.mp4') && video.loop && !video.paused && video.readyState >= 2;
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await host.locator('.candidates video').evaluateAll(videos => videos.every(video => video.paused)), true);
    const hiddenPlays = await page.evaluate(() => window.__media.plays);
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => window.__media.plays), hiddenPlays);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.candidates video.visible');
      return video && !video.paused;
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => {
      const videos = [...document.querySelector('#dsh-typing-buddy-host').shadowRoot.querySelectorAll('.candidates video')];
      return videos.length > 0 && videos.every(video => video.paused && !video.classList.contains('visible'));
    });
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.candidates video.visible');
      return video?.src.endsWith('/light.mp4') && !video.paused;
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.candidates video.visible');
      return video?.src.endsWith('/dark.mp4') && !video.paused;
    });
    await page.evaluate(() => {
      window.__candidateVideos = [...document.querySelector('#dsh-typing-buddy-host').shadowRoot.querySelectorAll('.candidates video')];
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__candidateVideos.length > 0
      && window.__candidateVideos.every(video => video.paused && !video.hasAttribute('src'))), true);
    const generationPolls = requests.filter(item => item.path === `${base}/generation.json`).length;
    await page.waitForTimeout(2600);
    assert.equal(requests.filter(item => item.path === `${base}/generation.json`).length, generationPolls,
      'closing the panel must stop generation polling');
    await identity.click();
    await host.getByRole('combobox', { name: '预览状态' }).waitFor();
    await host.getByRole('combobox', { name: '预览状态' }).selectOption('dancing');
    assert.equal(activePack.id, 'smoke-active');
    await host.getByRole('button', { name: '确认激活此形象', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget img').getAttribute('src').endsWith('?candidate'));
    assert.equal(activations, 1);
    assert.equal(activePack.id, candidate.id);
    assert.equal(await page.evaluate(() => window.xss), undefined);
    await host.getByRole('button', { name: '恢复内置形象', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget img').getAttribute('src') === '/dsh-typing-buddy/media/portrait.jpg');
    assert.equal(activePack.id, 'smoke-active');
    await page.keyboard.press('Escape');
  });

  await check('server default portrait and dark portrait override configured legacy avatar URLs', async () => {
    configOverrides = { avatarKind: 'url', avatarUrl: `${imageURL}?legacy-custom` };
    activePack = { id: 'default', name: '内置形象', portrait: `${imageURL}?default`, portrait_dark: `${imageURL}?default-dark`, states: {} };
    setStatus('idle');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await page.waitForFunction(expected => {
      const image = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget img');
      return image?.getAttribute('src') === expected && image.naturalWidth > 0;
    }, `${imageURL}?default`);
    assert.notEqual(await mainImage.getAttribute('src'), configOverrides.avatarUrl);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(expected => {
      const image = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget img');
      return image?.getAttribute('src') === expected && image.naturalWidth > 0;
    }, `${imageURL}?default-dark`);
    assert.equal(await host.locator('.name').textContent(), '浏览器小鲸鱼');
    configOverrides = {};
    activePack = structuredClone(initialPack);
    await page.reload();
    await page.waitForFunction(expected => document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget img').getAttribute('src') === expected, imageURL);
  });

  await check('enabled generation UI submits create, restyle, dark animation and retry to the local fixture', async () => {
    generationInfo = {
      available: true, models: { image: 'mock-image', video: 'mock-video' },
      jobs: [
        { id: 'running-smoke', mode: 'animate', status: 'running', progress: { completed: 2, total: 5 } },
        { id: 'failed-smoke', mode: 'create', status: 'failed', error: 'mock transient failure', retryable: true },
      ],
    };
    await identity.click();
    await host.getByRole('tab', { name: '形象', exact: true }).click();
    await host.locator('[name=generation-mode]').waitFor();
    await host.getByText('状态视频 · 生成中 · 2/5', { exact: true }).waitFor();
    const reference = `${origin}${imageURL}`;
    await host.locator('[name=generation-prompt]').fill('柔和光线的肖像');
    await host.locator('[name=generation-reference]').fill(reference);
    async function capture(action) {
      const response = page.waitForResponse(value => value.url() === `${origin}${base}/generation` && value.request().method() === 'POST');
      await action();
      assert.equal((await response).status(), 200);
      return generationCalls.at(-1);
    }
    assert.deepEqual(await capture(() => host.getByRole('button', { name: '生成候选（调用 Agnes）', exact: true }).click()), {
      mode: 'create', prompt: '柔和光线的肖像', reference, count: 3, name: '浏览器小鲸鱼',
    });
    await host.locator('[name=generation-mode]').selectOption('restyle');
    await host.locator('[name=generation-prompt]').fill('改成蓝色外套');
    await host.locator('[name=generation-reference]').fill('');
    assert.deepEqual(await capture(() => host.getByRole('button', { name: '生成候选（调用 Agnes）', exact: true }).click()), {
      mode: 'restyle', prompt: '改成蓝色外套', candidateId: 'active', count: 1, name: '浏览器小鲸鱼',
    });
    await host.locator('[name=generation-dark]').check();
    assert.deepEqual(await capture(() => host.getByRole('button', { name: '为已激活形象生成状态视频', exact: true }).click()), {
      mode: 'animate', candidateId: 'active', dark: true,
    });
    await host.locator('[name=generation-dark]').uncheck();
    assert.deepEqual(await capture(() => host.getByRole('button', { name: '为已激活形象生成状态视频', exact: true }).click()), {
      mode: 'animate', candidateId: 'active', dark: false,
    });
    assert.deepEqual(await capture(() => host.getByRole('button', { name: '重试此任务', exact: true }).click()), { retryJobId: 'failed-smoke' });
    const before = requests.filter(item => item.path === `${base}/packs`).length;
    candidates = [{ id: 'generated-smoke', pack: { id: 'generated-smoke', name: '生成完成的候选', portrait: imageURL, states: {} } }];
    generationInfo.jobs = [{ id: 'completed-smoke', mode: 'create', status: 'completed', progress: { completed: 1, total: 1 } }];
    await host.locator('.candidates').getByText('生成完成的候选', { exact: true }).waitFor();
    assert.ok(requests.filter(item => item.path === `${base}/packs`).length > before, 'completed jobs must refresh candidates');
    assert.equal(activePack.id, 'smoke-active');
    assert.equal(activations, 1, 'generated candidates require their own confirmation');
    await page.keyboard.press('Escape');
    generationInfo = { available: false, models: {}, jobs: [] };
    candidates = [];
  });

  await check('drag moves and persists position without opening the panel', async () => {
    const before = await identity.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + 30);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 - 140, before.y + 95, { steps: 8 });
    await page.mouse.up();
    assert.equal(await panel.isVisible(), false);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-typing-buddy.pos')));
    assert.ok(Number.isFinite(saved.x) && Number.isFinite(saved.y));
    assert.ok(Math.abs((await identity.boundingBox()).x - before.x) > 50);
    await identity.click();
    assert.equal(await panel.isVisible(), true);
    await page.keyboard.press('Escape');
  });

  await check('connection store failure and recovery switch immediately to current server state', async () => {
    await publish('working');
    const disconnected = await page.evaluate(() => {
      const start = performance.now(); window.harness.connection('disconnected');
      return { state: document.querySelector('#dsh-typing-buddy-host').dataset.state, elapsed: performance.now() - start };
    });
    assert.equal(disconnected.state, 'connecting');
    assert.ok(disconnected.elapsed < 250);
    const recovered = await page.evaluate(() => {
      window.harness.connection('connected'); return document.querySelector('#dsh-typing-buddy-host').dataset.state;
    });
    assert.equal(recovered, 'working');
  });

  await check('dance survives status polling and returns to the latest base on video end', async () => {
    await publish('waiting_for_subagents');
    await identity.click();
    await host.getByRole('tab', { name: '活动', exact: true }).click();
    await host.getByRole('button', { name: '跳支舞', exact: true }).click();
    await waitState('dancing');
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget video.visible');
      if (!video || video.paused) return false;
      video.playbackRate = 0.1; return true;
    });
    setStatus('making_something');
    await page.evaluate(() => window.harness.emit('api-session/status', 'dance-background', true));
    await page.waitForTimeout(1300);
    assert.equal(await host.getAttribute('data-state'), 'dancing');
    assert.equal(await host.locator('.widget video.visible').evaluate(video => video.loop), false);
    await host.locator('.widget video.visible').evaluate(video => video.dispatchEvent(new Event('ended')));
    await waitState('making_something');
    assert.equal(await host.locator('.name').textContent(), '浏览器小鲸鱼');
    await page.keyboard.press('Escape');
  });

  await check('visibility change pauses media during hidden status polling and resumes when visible', async () => {
    await publish('working');
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget video.visible');
      return video && !video.paused;
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await host.locator('.widget video').evaluateAll(videos => videos.every(video => video.paused)), true);
    const plays = await page.evaluate(() => window.__media.plays);
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => window.__media.plays), plays);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => {
      const video = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot.querySelector('.widget video.visible');
      return video && !video.paused;
    });
  });

  await check('reduced motion pauses videos and never starts playback on status refresh', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => {
      const root = document.querySelector('#dsh-typing-buddy-host')?.shadowRoot;
      return root?.querySelector('.widget .avatar').classList.contains('reduced')
        && [...root.querySelectorAll('.widget video')].every(video => video.paused && !video.classList.contains('visible'));
    });
    const plays = await page.evaluate(() => window.__media.plays);
    await publish('idle');
    await publish('working');
    await page.waitForTimeout(1300); // Cross a real status interval to detect an unwanted restart.
    assert.equal(await page.evaluate(() => window.__media.plays), plays);
    assert.equal(await mainImage.evaluate(node => getComputedStyle(node).animationName), 'none');
  });

  await check('plugin disposal removes DOM, store/remote subscriptions, media sources and pollers', async () => {
    const pollCount = () => requests.filter(item => item.path === `${base}/status.json`).length;
    await page.evaluate(() => window.harness.dispose());
    assert.equal(await host.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.harness.stats()), { sessions: 0, connection: 0, remote: 0, effects: 0 });
    assert.equal(await page.evaluate(() => [...window.__media.elements].every(video => video.paused && !video.hasAttribute('src'))), true);
    const before = pollCount();
    await page.evaluate(() => { window.harness.sessions({ later: { running: true } }); window.harness.connection('disconnected'); window.harness.emit('api-session/status', 'late', true); });
    await page.waitForTimeout(1400);
    assert.equal(await host.count(), 0);
    assert.equal(pollCount(), before);
    assert.deepEqual(errors, []);
  });
  console.log(`browser smoke ok: ${checked} checks; screenshots: test-results/buddy-light.png, test-results/buddy-dark.png`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
