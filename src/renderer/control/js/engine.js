// Moteur de lecture côté régie : décide quoi jouer et quand, et pilote la fenêtre de sortie.
// La sortie dispose de deux lecteurs (A et B) : pendant que l'un est à l'antenne, l'autre
// prépare la vidéo en attente, déjà calée sur sa première image mais invisible.

const ACTIVE = ['playing', 'paused', 'held', 'ending'];

export class Engine {
  constructor({ getCues, getSettings, isPlayable, onChange, onTime, onLevel, onError, onArmed, onEvent }) {
    this.getCues = getCues;
    this.getSettings = getSettings;
    this.isPlayable = isPlayable;
    this.onChange = onChange;
    this.onTime = onTime;
    this.onLevel = onLevel;
    this.onError = onError;
    this.onArmed = onArmed;
    this.onEvent = onEvent || (() => {});
    this.slots = { A: blankSlot(), B: blankSlot() };
    this.current = null;      // lecteur à l'antenne (ou en train de finir)
    this.standbyId = null;    // vidéo qui partira au prochain GO
    this.pendingGo = false;   // GO demandé avant que la vidéo en attente soit prête
    this.playlistTimer = null;
    window.projee.on('out:event', (ev) => this.handle(ev));
  }

  send(cmd) {
    window.projee.sendOutput(cmd);
  }

  // ---------- Paramètres effectifs d'une vidéo (réglages propres ou valeurs par défaut) ----------

  params(cue) {
    const s = this.getSettings();
    return {
      inPoint: cue.inPoint || 0,
      outPoint: cue.outPoint ?? null,
      fadeIn: cue.fadeIn ?? s.fadeIn,
      fadeOut: cue.fadeOut ?? s.fadeOut,
      endAction: cue.endAction || 'black',
      volume: cue.volume ?? 1,
      fit: cue.fit || 'contain',
    };
  }

  cue(id) {
    return this.getCues().find((c) => c.id === id) || null;
  }

  // ---------- État ----------

  get currentCue() {
    return this.current ? this.cue(this.slots[this.current].cueId) : null;
  }

  get currentState() {
    return this.current ? this.slots[this.current].state : 'black';
  }

  isActive() {
    return Object.values(this.slots).some((s) => ACTIVE.includes(s.state));
  }

  otherSlot(name) {
    return name === 'A' ? 'B' : 'A';
  }

  // ---------- Vidéo en attente ----------

  nextPlayableAfter(id) {
    const cues = this.getCues();
    const start = id ? cues.findIndex((c) => c.id === id) + 1 : 0;
    for (let i = start; i < cues.length; i++) if (this.isPlayable(cues[i])) return cues[i].id;
    return null;
  }

  setStandby(id, { keepPending = false } = {}) {
    this.standbyId = id;
    if (!keepPending) this.pendingGo = false;
    this.ensureArmed();
    this.changed();
  }

  // Prépare la vidéo en attente dans un lecteur libre.
  ensureArmed() {
    const cue = this.standbyId ? this.cue(this.standbyId) : null;
    if (!cue || !this.isPlayable(cue)) {
      this.updateChain();
      return;
    }
    const ready = Object.entries(this.slots).find(([n, s]) => n !== this.current && s.cueId === cue.id && (s.state === 'armed' || s.state === 'loading'));
    if (ready) {
      this.updateChain();
      return;
    }
    const free = ['A', 'B'].find((n) => n !== this.current && !ACTIVE.includes(this.slots[n].state));
    if (!free) return; // l'autre lecteur termine un fondu : on réessaiera à la fin
    const p = this.params(cue);
    this.slots[free] = { ...blankSlot(), cueId: cue.id, state: 'loading' };
    this.send({ type: 'load', slot: free, cueId: cue.id, src: window.projee.mediaUrl(cue.path), ...p });
  }

  // Enchaînement sans noir : la sortie bascule elle-même sur la vidéo suivante, pile à l'image.
  updateChain() {
    if (!this.current) return;
    const cur = this.slots[this.current];
    const cue = this.cue(cur.cueId);
    const other = this.otherSlot(this.current);
    const next = this.slots[other];
    if (cue && this.params(cue).endAction === 'next' && next.state === 'armed' && next.cueId === this.standbyId) {
      this.send({ type: 'chain', slot: this.current, to: other, fadeIn: 0 });
    } else {
      this.send({ type: 'chain', slot: this.current, to: null });
    }
  }

  // ---------- Commandes ----------

  go() {
    this.clearPlaylistTimer();
    const cue = this.standbyId ? this.cue(this.standbyId) : null;
    if (!cue) return false;
    const entry = Object.entries(this.slots).find(([n, s]) => n !== this.current && s.cueId === cue.id && s.state === 'armed');
    if (!entry) {
      this.pendingGo = true;
      this.ensureArmed();
      this.changed();
      return true;
    }
    this.pendingGo = false;
    const [slot] = entry;
    const p = this.params(cue);
    if (this.current && ACTIVE.includes(this.slots[this.current].state) && this.slots[this.current].state !== 'ending') {
      const prev = this.cue(this.slots[this.current].cueId);
      this.send({ type: 'fadeToBlack', slot: this.current, duration: prev ? this.params(prev).fadeOut : 0 });
      this.slots[this.current].state = 'ending';
    }
    this.send({ type: 'mire', on: false });
    this.send({ type: 'play', slot, fadeIn: p.fadeIn });
    this.slots[slot].state = 'playing';
    this.slots[slot].t = p.inPoint;
    this.current = slot;
    this.onEvent({ type: 'go', cueId: cue.id });
    this.standbyId = this.nextPlayableAfter(cue.id);
    this.ensureArmed();
    this.changed();
    return true;
  }

  togglePause() {
    if (!this.current) return;
    const s = this.getSettings();
    const slot = this.slots[this.current];
    if (slot.state === 'playing') {
      this.send({ type: 'pause', slot: this.current, black: s.pauseOnBlack, duration: 0.3 });
      slot.state = 'paused';
    } else if (slot.state === 'paused') {
      this.send({ type: 'resume', slot: this.current, duration: s.pauseOnBlack ? 0.3 : 0.05 });
      slot.state = 'playing';
    }
    this.changed();
  }

  stop(duration) {
    this.clearPlaylistTimer();
    this.pendingGo = false;
    for (const [name, s] of Object.entries(this.slots)) {
      if (['playing', 'paused', 'held'].includes(s.state)) {
        this.send({ type: 'fadeToBlack', slot: name, duration });
        s.state = 'ending';
      }
    }
    this.changed();
  }

  black() {
    this.clearPlaylistTimer();
    this.pendingGo = false;
    this.send({ type: 'black' });
    for (const s of Object.values(this.slots)) if (ACTIVE.includes(s.state)) s.state = 'done';
    this.current = null;
    this.ensureArmed();
    this.changed();
  }

  seek(time) {
    if (!this.current) return;
    this.send({ type: 'seek', slot: this.current, time });
  }

  // Une vidéo a été modifiée (réglages, fichier relié…) : on met les lecteurs à jour.
  cueUpdated(cue, { reload = false } = {}) {
    for (const [name, s] of Object.entries(this.slots)) {
      if (s.cueId !== cue.id) continue;
      if (s.state === 'armed' || s.state === 'loading') {
        if (reload) {
          this.slots[name] = blankSlot();
          this.send({ type: 'unload', slot: name });
        } else {
          this.send({ type: 'configure', slot: name, ...this.params(cue) });
        }
      } else if (ACTIVE.includes(s.state)) {
        const { inPoint, fadeIn, ...live } = this.params(cue);
        this.send({ type: 'configure', slot: name, inPoint, ...live });
      }
    }
    this.ensureArmed();
    this.updateChain();
    this.changed();
  }

  // La liste a changé (ajout, suppression, déplacement).
  cuesChanged() {
    const cues = this.getCues();
    if (this.standbyId && !cues.some((c) => c.id === this.standbyId && this.isPlayable(c))) {
      this.standbyId = null;
    }
    if (!this.standbyId && !this.isActive()) this.standbyId = this.nextPlayableAfter(null);
    for (const [name, s] of Object.entries(this.slots)) {
      if ((s.state === 'armed' || s.state === 'loading') && s.cueId !== this.standbyId) {
        this.slots[name] = blankSlot();
        this.send({ type: 'unload', slot: name });
      }
    }
    this.ensureArmed();
    this.changed();
  }

  clearPlaylistTimer() {
    clearTimeout(this.playlistTimer);
    this.playlistTimer = null;
  }

  // La sortie a été (re)chargée : on repart de zéro, sur du noir.
  resetAll() {
    this.clearPlaylistTimer();
    this.slots = { A: blankSlot(), B: blankSlot() };
    this.current = null;
    this.pendingGo = false;
    this.send({ type: 'reset' });
    this.ensureArmed();
    this.changed();
  }

  changed() {
    this.onChange();
  }

  // ---------- Événements venant de la sortie ----------

  handle(ev) {
    const slot = ev.slot ? this.slots[ev.slot] : null;
    if (slot && ev.cueId && slot.cueId !== ev.cueId) return; // événement d'un chargement périmé
    switch (ev.type) {
      case 'ready':
        this.onEvent(ev);
        break;
      case 'armed':
        slot.state = 'armed';
        slot.duration = ev.duration;
        this.onArmed(ev);
        if (this.pendingGo && ev.cueId === this.standbyId) this.go();
        else this.updateChain();
        this.changed();
        break;
      case 'started':
        if (ev.slot !== this.current) {
          // Enchaînement déclenché par la sortie elle-même.
          slot.state = 'playing';
          this.current = ev.slot;
          this.onEvent({ type: 'go', cueId: ev.cueId, chained: true });
          this.standbyId = this.nextPlayableAfter(ev.cueId);
          this.ensureArmed();
        }
        this.changed();
        break;
      case 'held':
        slot.state = 'held';
        this.changed();
        break;
      case 'ended':
      case 'stopped': {
        slot.state = 'done';
        if (ev.slot === this.current && !ev.chained) {
          this.current = null;
          // Fin réglée pour enchaîner : on lance la vidéo en attente, après le noir prévu.
          // (« next » arrive ici seulement si la suivante n'était pas prête à temps.)
          const endAction = this.cue(ev.cueId)?.endAction;
          if (ev.type === 'ended' && this.standbyId && (endAction === 'blackNext' || endAction === 'next')) {
            const gap = endAction === 'blackNext' ? Math.max(0, this.getSettings().playlistGap) : 0;
            this.playlistTimer = setTimeout(() => this.go(), gap * 1000);
          }
        }
        this.onEvent(ev);
        this.ensureArmed();
        this.changed();
        break;
      }
      case 'time':
        if (!slot) return;
        slot.t = ev.t;
        if (ev.slot === this.current) this.onTime(ev);
        break;
      case 'level':
        this.onLevel(ev);
        break;
      case 'error':
        if (slot) {
          slot.state = 'empty';
          if (ev.slot === this.current) this.current = null;
        }
        if (ev.cueId === this.standbyId) this.pendingGo = false;
        this.onError(ev);
        this.changed();
        break;
      default:
        this.onEvent(ev);
    }
  }
}

function blankSlot() {
  return { cueId: null, state: 'empty', t: 0, duration: null };
}
