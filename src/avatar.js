import builtin from '../assets/avatar.jpg';
export { builtin };

export function mediaFor(pack, state, _dark, legacy = '') {
  const entry = state === 'dancing' ? pack?.dances?.[0] || pack?.states?.dancing : pack?.states?.[state];
  const portrait = pack?.portrait || legacy || builtin;
  return { video: entry?.video || '', poster: entry?.poster || portrait };
}

// Two video layers keep the previous frame visible until the next source can play.
export class AvatarView {
  constructor(container, { onEnded = () => {} } = {}) {
    this.container = container;
    this.onEnded = onEnded;
    this.image = document.createElement('img');
    this.image.alt = ''; this.image.draggable = false;
    this.image.className = 'portrait';
    this.image.onerror = () => { if (this.image.src !== builtin) this.image.src = builtin; };
    this.videos = [0, 1].map(() => {
      const video = document.createElement('video');
      video.muted = true; video.defaultMuted = true; video.playsInline = true;
      video.preload = 'auto'; video.setAttribute('aria-hidden', 'true');
      video.addEventListener('ended', () => this.onEnded());
      return video;
    });
    container.append(this.image, ...this.videos);
    this.current = -1; this.key = ''; this.failed = new Map(); this.preloads = [];
  }
  update({ pack, state, dark, legacy, reduced, hidden }) {
    this.options = { pack, state, dark, legacy, reduced, hidden };
    const media = mediaFor(pack, state, dark, legacy);
    if (this.image.getAttribute('src') !== media.poster) this.image.src = media.poster;
    this.container.dataset.state = state;
    this.container.classList.toggle('reduced', reduced);
    const key = `${media.video}|${state}`;
    const failedUntil = this.failed.get(media.video) || 0;
    if (failedUntil && failedUntil <= Date.now()) { this.failed.delete(media.video); this.key = ''; }
    if (!media.video || reduced || failedUntil > Date.now()) {
      this.key = key;
      this.videos.forEach(v => { v.pause(); v.classList.remove('visible'); });
      this.current = -1;
      return;
    }
    if (this.key !== key || this.current === -1) {
      this.key = key;
      const index = this.current === 0 ? 1 : 0;
      const video = this.videos[index];
      video.classList.remove('visible');
      video.loop = !['milestone_level_up', 'dancing'].includes(state);
      video.oncanplay = () => {
        if (this.key !== key) return;
        this.videos.forEach((v, i) => { v.classList.toggle('visible', i === index); if (i !== index) v.pause(); });
        this.current = index;
        if (!this.options.hidden) video.play().catch(() => video.classList.remove('visible'));
      };
      video.onerror = () => {
        if (this.key !== key) return;
        this.failed.set(media.video, Date.now() + 30000);
        this.current = -1;
        this.videos.forEach(v => { v.pause(); v.classList.remove('visible'); });
      };
      video.src = media.video; video.load();
    } else if (this.current >= 0) {
      const video = this.videos[this.current];
      if (hidden) video.pause(); else video.play().catch(() => {});
    }
    if (hidden) this.videos.forEach(v => v.pause());
  }
  preload(pack, dark) {
    const urls = [...new Set([
      ...Object.values(pack?.states || {}), ...(pack?.dances || []),
    ].map(e => e?.video).filter(Boolean))].slice(0, 12);
    const key = urls.join('|');
    if (key === this.preloadKey) return;
    this.preloads.forEach(v => { v.removeAttribute('src'); v.load(); });
    this.preloadKey = key; this.failed.clear();
    this.preloads = urls.map(url => {
      const video = document.createElement('video');
      video.muted = true; video.preload = 'auto'; video.src = url; video.load();
      return video;
    });
  }
  dispose() {
    [...this.videos, ...this.preloads].forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    this.container.replaceChildren();
  }
}
