'use strict';
// Fenêtre de sortie (projecteur). Elle ne montre que du noir, sauf pendant une lecture.
// Elle exécute les ordres de la régie et gère elle-même la fin des vidéos (fondu au noir,
// image figée, boucle, enchaînement) pour que ces moments tombent pile à l'image.

const api = window.projeeOutput;
const TICK_MS = 10;
const END_EPSILON = 0.04;

// ---------- Son : chaque lecteur → gain (fondus) → volume général → sortie choisie ----------

const ctx = new AudioContext({ latencyHint: 'playback' });
const master = ctx.createGain();
master.channelCount = 2;
master.channelCountMode = 'explicit';
master.channelInterpretation = 'speakers';
const splitter = ctx.createChannelSplitter(2);
const meters = [ctx.createAnalyser(), ctx.createAnalyser()];
master.connect(ctx.destination);
master.connect(splitter);
meters.forEach((m, i) => {
  m.fftSize = 1024;
  splitter.connect(m, i);
});
const meterBuf = new Float32Array(1024);

function rampGain(param, value, seconds) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  if (seconds > 0) param.linearRampToValueAtTime(value, now + seconds);
  else param.setValueAtTime(value, now);
}

// ---------- Lecteurs ----------

let zTop = 1;

class Slot {
  constructor(name, el) {
    this.name = name;
    this.el = el;
    el.crossOrigin = 'anonymous';
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(this.gain);
    this.gain.connect(master);
    this.cueId = null;
    this.cfg = { inPoint: 0, outPoint: null, fadeOut: 0.5, endAction: 'black', volume: 1 };
    this.state = 'empty'; // empty | loading | armed | playing | paused | ending | held | done
    this.timer = null;
    this.seq = 0;
    this.chain = null; // { slot, fadeIn } : vidéo suivante à enchaîner sans passer par le noir
    el.addEventListener('ended', () => this.reachedEnd());
    el.addEventListener('error', () => {
      if (this.cueId) emit({ type: 'error', slot: name, cueId: this.cueId, message: mediaError(el) });
    });
  }

  get end() {
    const d = this.el.duration;
    const out = this.cfg.outPoint;
    if (out != null && out > 0 && (!isFinite(d) || out < d)) return out;
    return isFinite(d) ? d : Infinity;
  }

  fade(opacity, gain, seconds) {
    const el = this.el;
    if (seconds > 0) {
      el.style.transition = `opacity ${seconds}s linear`;
    } else {
      el.style.transition = 'none';
    }
    el.style.opacity = String(opacity);
    if (seconds <= 0) void el.offsetWidth;
    rampGain(this.gain.gain, gain, seconds);
  }

  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  reset() {
    this.clearTimer();
    this.chain = null;
    this.fade(0, 0, 0);
    this.el.pause();
  }

  configure(cfg) {
    Object.assign(this.cfg, cfg);
    if ('fit' in cfg) this.el.style.objectFit = cfg.fit || 'contain';
    if ('volume' in cfg && (this.state === 'playing' || this.state === 'held')) rampGain(this.gain.gain, this.cfg.volume, 0.1);
  }

  async load(cmd) {
    this.reset();
    const seq = ++this.seq;
    this.cueId = cmd.cueId;
    this.state = 'loading';
    this.configure(cmd);
    const el = this.el;
    try {
      if (el.getAttribute('src') !== cmd.src) {
        el.src = cmd.src;
        el.load();
        await waitFor(el, 'loadedmetadata');
      }
      if (seq !== this.seq) return;
      const start = Math.max(0, this.cfg.inPoint || 0);
      if (Math.abs(el.currentTime - start) > 0.001 || el.readyState < 2) {
        el.currentTime = start;
        await waitFor(el, 'seeked');
      }
      if (el.readyState < 3) await waitFor(el, 'canplay', 8000).catch(() => {});
      if (seq !== this.seq) return;
      this.state = 'armed';
      emit({ type: 'armed', slot: this.name, cueId: this.cueId, duration: el.duration, width: el.videoWidth, height: el.videoHeight });
    } catch (err) {
      if (seq !== this.seq) return;
      this.state = 'empty';
      emit({ type: 'error', slot: this.name, cueId: this.cueId, message: err.message || mediaError(el) });
    }
  }

  async play(fadeIn) {
    if (this.state !== 'armed') return;
    this.state = 'playing';
    this.el.style.zIndex = String(++zTop);
    try {
      await ctx.resume();
      await this.el.play();
    } catch (err) {
      this.state = 'empty';
      emit({ type: 'error', slot: this.name, cueId: this.cueId, message: err.message });
      return;
    }
    this.fade(1, this.cfg.volume, fadeIn);
    emit({ type: 'started', slot: this.name, cueId: this.cueId });
  }

  // Fondu vers le noir puis arrêt. reason : 'end' (fin naturelle) ou 'stop' (demandé par la régie).
  fadeToBlack(seconds, reason) {
    if (this.state === 'empty' || this.state === 'done') return;
    this.clearTimer();
    this.state = 'ending';
    this.chain = null;
    this.fade(0, 0, seconds);
    this.timer = setTimeout(() => {
      this.el.pause();
      this.state = 'done';
      emit({ type: reason === 'end' ? 'ended' : 'stopped', slot: this.name, cueId: this.cueId });
    }, Math.max(0, seconds * 1000) + 20);
  }

  pause(black, seconds) {
    if (this.state !== 'playing' && this.state !== 'held') return;
    this.state = 'paused';
    this.clearTimer();
    if (black) {
      this.fade(0, 0, seconds);
      this.timer = setTimeout(() => this.el.pause(), seconds * 1000 + 20);
    } else {
      // Petit fondu du son pour éviter un clic ; l'image reste figée.
      rampGain(this.gain.gain, 0, 0.05);
      this.timer = setTimeout(() => this.el.pause(), 60);
    }
  }

  async resume(seconds) {
    if (this.state !== 'paused') return;
    this.clearTimer();
    this.state = 'playing';
    try {
      await ctx.resume();
      await this.el.play();
    } catch (err) {
      emit({ type: 'error', slot: this.name, cueId: this.cueId, message: err.message });
      return;
    }
    this.fade(1, this.cfg.volume, seconds);
  }

  seek(time) {
    if (!['playing', 'paused', 'held'].includes(this.state)) return;
    const t = Math.max(this.cfg.inPoint || 0, Math.min(time, this.end - 0.05));
    this.el.currentTime = t;
    if (this.state === 'held') {
      this.state = 'paused';
      rampGain(this.gain.gain, 0, 0);
    }
  }

  // Surveillance de la fin, appelée toutes les 10 ms pendant la lecture.
  tick() {
    if (this.state !== 'playing') return;
    const t = this.el.currentTime;
    const end = this.end;
    if (!isFinite(end)) return;
    const { endAction, fadeOut } = this.cfg;
    if (endAction === 'black' || (endAction === 'next' && !this.chainReady())) {
      if (fadeOut > 0 && t >= end - fadeOut) this.fadeToBlack(Math.max(0.05, end - t), 'end');
      else if (t >= end - END_EPSILON) this.fadeToBlack(0, 'end');
    } else if (t >= end - END_EPSILON) {
      this.reachedEnd();
    }
  }

  chainReady() {
    return this.chain && this.chain.slot.state === 'armed';
  }

  reachedEnd() {
    if (this.state !== 'playing') return;
    const { endAction } = this.cfg;
    if (endAction === 'loop') {
      this.el.currentTime = this.cfg.inPoint || 0;
      if (this.el.paused) this.el.play().catch(() => {});
      emit({ type: 'looped', slot: this.name, cueId: this.cueId });
    } else if (endAction === 'hold') {
      this.el.pause();
      rampGain(this.gain.gain, 0, 0.05);
      this.state = 'held';
      emit({ type: 'held', slot: this.name, cueId: this.cueId });
    } else if (endAction === 'next' && this.chainReady()) {
      const next = this.chain;
      this.chain = null;
      this.state = 'ending';
      next.slot.play(next.fadeIn);
      // La suivante passe au-dessus : on coupe celle-ci une fois la nouvelle image affichée.
      setTimeout(() => {
        this.el.pause();
        this.fade(0, 0, 0);
        this.state = 'done';
        emit({ type: 'ended', slot: this.name, cueId: this.cueId, chained: true });
      }, 80);
    } else {
      this.fadeToBlack(0, 'end');
    }
  }

  unload() {
    this.reset();
    this.seq++;
    this.state = 'empty';
    this.cueId = null;
    this.el.removeAttribute('src');
    this.el.load();
  }
}

const slots = { A: new Slot('A', document.getElementById('slotA')), B: new Slot('B', document.getElementById('slotB')) };

function waitFor(el, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const done = (fn, arg) => {
      clearTimeout(t);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', ko);
      fn(arg);
    };
    const ok = () => done(resolve);
    const ko = () => done(reject, new Error(mediaError(el)));
    const t = setTimeout(() => done(reject, new Error('Délai dépassé pendant le chargement de la vidéo')), timeout);
    el.addEventListener(event, ok);
    el.addEventListener('error', ko);
  });
}

function mediaError(el) {
  const code = el.error && el.error.code;
  if (code === 4) return 'Format ou codec non pris en charge';
  if (code === 3) return 'Erreur de décodage de la vidéo';
  if (code === 2) return 'Fichier illisible ou introuvable';
  return (el.error && el.error.message) || 'Erreur de lecture';
}

function emit(ev) {
  api.emit(ev);
}

// ---------- Mire ----------

const mire = document.getElementById('mire');
let mireInfo = null;

function drawMire() {
  const w = (mire.width = Math.round(window.innerWidth * devicePixelRatio));
  const h = (mire.height = Math.round(window.innerHeight * devicePixelRatio));
  const g = mire.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  bars.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect((i * w) / bars.length, h * 0.62, w / bars.length + 1, h * 0.2);
  });
  g.strokeStyle = '#777';
  g.lineWidth = Math.max(1, w / 1920);
  const step = w / 16;
  for (let x = step; x < w; x += step) line(g, x, 0, x, h);
  for (let y = h / 2 - Math.floor(h / 2 / step) * step; y < h; y += step) line(g, 0, y, w, y);
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(2, w / 640);
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  line(g, 0, 0, w, h);
  line(g, w, 0, 0, h);
  g.beginPath();
  g.arc(w / 2, h / 2, h * 0.4, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h / 12)}px system-ui, sans-serif`;
  g.fillText('PROJEE', w / 2, h * 0.32);
  g.font = `${Math.round(h / 28)}px system-ui, sans-serif`;
  const label = mireInfo && mireInfo.label ? mireInfo.label : 'Sortie vidéo';
  g.fillText(`${label} — ${w} × ${h}`, w / 2, h * 0.44);
}

function line(g, x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

window.addEventListener('resize', () => {
  if (!mire.hidden) drawMire();
});

// ---------- Ordres de la régie ----------

const handlers = {
  load: (c) => slots[c.slot].load(c),
  configure: (c) => slots[c.slot].configure(c),
  play: (c) => slots[c.slot].play(c.fadeIn || 0),
  fadeToBlack: (c) => slots[c.slot].fadeToBlack(c.duration || 0, 'stop'),
  pause: (c) => slots[c.slot].pause(!!c.black, c.duration || 0),
  resume: (c) => slots[c.slot].resume(c.duration || 0.05),
  seek: (c) => slots[c.slot].seek(c.time),
  unload: (c) => slots[c.slot].unload(),
  chain: (c) => {
    slots[c.slot].chain = c.to ? { slot: slots[c.to], fadeIn: c.fadeIn || 0 } : null;
  },
  black: () => {
    Object.values(slots).forEach((s) => {
      if (s.state !== 'empty' && s.state !== 'armed' && s.state !== 'loading') {
        s.reset();
        s.state = 'done';
        emit({ type: 'stopped', slot: s.name, cueId: s.cueId });
      }
    });
  },
  reset: () => Object.values(slots).forEach((s) => s.unload()),
  master: (c) => rampGain(master.gain, c.value, 0.05),
  sink: async (c) => {
    try {
      await ctx.setSinkId(!c.id || c.id === 'default' ? '' : c.id);
      emit({ type: 'sink', ok: true, id: c.id });
    } catch (err) {
      emit({ type: 'sink', ok: false, id: c.id, message: err.message });
    }
  },
  mire: (c) => {
    mireInfo = c.info || null;
    mire.hidden = !c.on;
    if (c.on) drawMire();
  },
  windowMode: (c) => document.body.classList.toggle('windowed', !!c.on),
};

api.onCommand((cmd) => {
  const fn = handlers[cmd.type];
  if (fn) fn(cmd);
});

// ---------- Boucles de surveillance ----------

setInterval(() => {
  slots.A.tick();
  slots.B.tick();
}, TICK_MS);

setInterval(() => {
  for (const s of Object.values(slots)) {
    if (['playing', 'paused', 'held', 'ending'].includes(s.state)) {
      emit({ type: 'time', slot: s.name, cueId: s.cueId, t: s.el.currentTime, state: s.state });
    }
  }
}, 100);

let silentSent = false;
setInterval(() => {
  const active = Object.values(slots).some((s) => s.state === 'playing' || s.state === 'ending');
  if (!active) {
    if (!silentSent) emit({ type: 'level', l: 0, r: 0 });
    silentSent = true;
    return;
  }
  silentSent = false;
  const peaks = meters.map((m) => {
    m.getFloatTimeDomainData(meterBuf);
    let p = 0;
    for (let i = 0; i < meterBuf.length; i++) p = Math.max(p, Math.abs(meterBuf[i]));
    return p;
  });
  emit({ type: 'level', l: peaks[0], r: peaks[1] });
}, 50);

emit({ type: 'ready' });
