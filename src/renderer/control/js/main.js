// Fenêtre de régie : conduite, transport, projets, écrans et sorties son.
import { $, $$, el, fmtTime, toast, uid } from './util.js';
import { Engine } from './engine.js';
import { probe } from './media.js';
import { openCueEditor, END_ICONS, endIconSvg } from './editor.js';
import { openSettings, openShortcuts, openAbout } from './dialogs.js';
import { runSelftest } from './selftest.js';

const api = window.projee;

const state = {
  info: null,
  settings: null,
  filePath: null,
  name: 'Nouveau spectacle',
  cues: [],
  runtime: new Map(), // id → { duration, width, height, thumb, status: loading|ok|missing|error, error }
  dirty: false,
  locked: false,
  outputStatus: { kind: 'none' },
  audioDevices: [],
};

const rt = (id) => state.runtime.get(id) || {};
const isPlayable = (cue) => cue.type === 'video' && !['missing', 'error'].includes(rt(cue.id).status);

const engine = new Engine({
  getCues: () => state.cues,
  getSettings: () => state.settings,
  isPlayable,
  onChange: () => renderAll(),
  onTime: (ev) => renderTime(ev),
  onLevel: (ev) => renderLevel(ev),
  onError: (ev) => {
    const cue = engine.cue(ev.cueId);
    if (cue) {
      state.runtime.set(cue.id, { ...rt(cue.id), status: 'error', error: ev.message });
      toast(`« ${cue.name} » : ${ev.message}`, 'error', 8000);
      engine.cuesChanged();
    }
  },
  onArmed: (ev) => {
    const r = rt(ev.cueId);
    if (!r.duration && ev.duration) state.runtime.set(ev.cueId, { ...r, duration: ev.duration, width: ev.width, height: ev.height });
  },
  onEvent: (ev) => {
    if (ev.type === 'ready') onOutputReady();
    if (ev.type === 'sink' && !ev.ok) toast(`Sortie son indisponible : ${ev.message}`, 'error', 8000);
    selftestHook?.(ev);
  },
});

let selftestHook = null;

// ---------- Projet ----------

function setDirty(dirty = true) {
  state.dirty = dirty;
  $('#dirtyMark').hidden = !dirty;
}

function newProject() {
  engine.black();
  state.filePath = null;
  state.name = 'Nouveau spectacle';
  state.cues = [];
  state.runtime.clear();
  setDirty(false);
  engine.cuesChanged();
}

function loadProject({ filePath, project }) {
  engine.black();
  state.filePath = filePath;
  state.name = project.name;
  state.cues = project.cues;
  state.runtime.clear();
  for (const cue of state.cues) {
    if (cue.type !== 'video') continue;
    if (cue.missing) {
      state.runtime.set(cue.id, { status: 'missing' });
    } else {
      analyse(cue);
    }
    delete cue.missing;
  }
  setDirty(false);
  engine.standbyId = null;
  engine.cuesChanged();
  const missing = state.cues.filter((c) => rt(c.id).status === 'missing').length;
  if (missing) toast(`${missing} vidéo(s) introuvable(s) : cliquez sur « Relier… » dans la conduite.`, 'error', 8000);
}

function projectData() {
  return {
    name: state.name,
    cues: state.cues.map((c) => ({ ...c, missing: rt(c.id).status === 'missing' || undefined })),
  };
}

async function save(saveAs = false) {
  try {
    const target = await api.invoke('project:save', projectData(), state.filePath, saveAs);
    if (!target) return false;
    const info = await api.invoke('path:info', target);
    state.filePath = target;
    state.name = info.name;
    setDirty(false);
    renderHeader();
    toast('Projet enregistré.', 'ok', 2000);
    return true;
  } catch (err) {
    toast(`Enregistrement impossible : ${err.message}`, 'error', 8000);
    return false;
  }
}

async function confirmDiscard() {
  if (!state.dirty) return true;
  const r = await api.invoke('dialog:message', {
    type: 'question',
    buttons: ['Enregistrer', 'Ne pas enregistrer', 'Annuler'],
    defaultId: 0,
    cancelId: 2,
    message: 'Enregistrer les modifications du projet ?',
  });
  if (r.response === 0) return save();
  return r.response === 1;
}

async function openProject(filePath) {
  if (engine.isActive() && !(await confirmStopPlayback())) return;
  if (!(await confirmDiscard())) return;
  try {
    const r = filePath ? await api.invoke('project:openPath', filePath) : await api.invoke('project:open');
    if (r) loadProject(r);
  } catch (err) {
    toast(`Ouverture impossible : ${err.message}`, 'error', 8000);
  }
}

async function confirmStopPlayback() {
  const r = await api.invoke('dialog:message', {
    type: 'warning',
    buttons: ['Continuer', 'Annuler'],
    defaultId: 1,
    cancelId: 1,
    message: 'Une vidéo est en cours de lecture.',
    detail: 'Continuer coupera la vidéo (noir immédiat).',
  });
  return r.response === 0;
}

async function exportProject() {
  if (state.cues.some((c) => rt(c.id).status === 'missing')) {
    toast('Certaines vidéos sont introuvables : elles ne seront pas copiées.', 'error', 6000);
  }
  toast('Export en cours…', '', 600000);
  try {
    const target = await api.invoke('project:export', projectData());
    if (target) toast(`Projet exporté : ${target}`, 'ok', 8000);
  } catch (err) {
    toast(`Export impossible : ${err.message}`, 'error', 8000);
  } finally {
    $$('.toast').forEach((n) => n.textContent.startsWith('Export en cours') && n.remove());
  }
}

// ---------- Vidéos ----------

async function analyse(cue) {
  state.runtime.set(cue.id, { ...rt(cue.id), status: 'loading' });
  renderCues();
  const r = await probe(cue.path);
  if (!state.cues.includes(cue)) return;
  state.runtime.set(cue.id, r.ok ? { ...r, status: 'ok' } : { ...r, status: 'error' });
  if (!r.ok) toast(`« ${cue.name} » ne pourra pas être lue : ${r.error}`, 'error', 10000);
  engine.cuesChanged();
}

async function addVideos(paths, index = state.cues.length) {
  if (state.locked || !paths.length) return;
  const added = [];
  for (const p of paths) {
    const info = await api.invoke('path:info', p);
    added.push({ id: uid(), type: 'video', path: p, name: info.name, inPoint: 0, outPoint: null, fadeIn: null, fadeOut: null, volume: 1, endAction: 'black', fit: 'contain', notes: '' });
  }
  state.cues.splice(index, 0, ...added);
  setDirty();
  added.forEach(analyse);
  engine.cuesChanged();
}

function addText() {
  const cue = { id: uid(), type: 'text', text: '' };
  openCueEditor(cue, null, state.settings, (patch) => {
    Object.assign(cue, patch);
    const standbyIdx = state.cues.findIndex((c) => c.id === engine.standbyId);
    state.cues.splice(standbyIdx >= 0 ? standbyIdx : state.cues.length, 0, cue);
    setDirty();
    engine.cuesChanged();
  });
}

function editCue(cue) {
  if (state.locked) return;
  if (cue.type === 'video' && rt(cue.id).status === 'missing') {
    relink(cue);
    return;
  }
  openCueEditor(cue, rt(cue.id), state.settings, (patch) => {
    const reload = cue.type === 'video' && (patch.inPoint ?? 0) !== (cue.inPoint || 0);
    Object.assign(cue, patch);
    setDirty();
    if (cue.type === 'video') engine.cueUpdated(cue, { reload });
    else renderAll();
  });
}

async function removeCue(cue) {
  if (state.locked) return;
  const active = Object.values(engine.slots).some((s) => s.cueId === cue.id && ['playing', 'paused', 'held', 'ending'].includes(s.state));
  if (active) {
    toast("Cette vidéo est en cours de lecture : arrêtez-la avant de la retirer.", 'error');
    return;
  }
  const label = cue.type === 'video' ? `« ${cue.name} »` : 'cette ligne de texte';
  const r = await api.invoke('dialog:message', {
    type: 'question',
    buttons: ['Retirer', 'Annuler'],
    defaultId: 0,
    cancelId: 1,
    message: `Retirer ${label} de la conduite ?`,
    detail: cue.type === 'video' ? "Le fichier vidéo n'est pas supprimé de l'ordinateur." : undefined,
  });
  if (r.response !== 0) return;
  state.cues = state.cues.filter((c) => c !== cue);
  state.runtime.delete(cue.id);
  setDirty();
  engine.cuesChanged();
}

async function relink(cue) {
  const p = await api.invoke('media:relink', cue.path);
  if (!p) return;
  const info = await api.invoke('path:info', p);
  cue.path = p;
  analyse(cue);
  // Les autres vidéos manquantes sont peut-être dans le même dossier.
  const others = state.cues.filter((c) => c !== cue && rt(c.id).status === 'missing');
  if (others.length) {
    const names = await Promise.all(others.map((c) => api.invoke('path:info', c.path).then((i) => i.base)));
    const found = await api.invoke('media:findInDir', info.dir, names);
    others.forEach((c, i) => {
      if (found[i]) {
        c.path = found[i];
        analyse(c);
      }
    });
    const n = found.filter(Boolean).length;
    if (n) toast(`${n} autre(s) vidéo(s) retrouvée(s) dans le même dossier.`, 'ok');
  }
  setDirty();
}

function moveCue(fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx + 1 === toIdx) return;
  const [cue] = state.cues.splice(fromIdx, 1);
  state.cues.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, cue);
  setDirty();
  engine.cuesChanged();
}

function cueDuration(cue) {
  const d = rt(cue.id).duration;
  if (!d) return null;
  return (cue.outPoint ?? d) - (cue.inPoint || 0);
}

// ---------- Rendu ----------

function renderAll() {
  renderHeader();
  renderCues();
  renderNow();
  renderTransport();
}

function renderHeader() {
  $('#projectName').textContent = state.name;
  document.title = `${state.name} — Projee`;
  document.body.classList.toggle('locked', state.locked);
  $('#lockBtn').textContent = state.locked ? '🔒' : '🔓';
  $('#lockBtn').title = state.locked ? 'Déverrouiller' : 'Verrouiller le mode spectacle';
  $('#outputSelect').disabled = state.locked;
  $('#audioSelect').disabled = state.locked;
}

function renderCues() {
  const list = $('#cueList');
  const currentId = engine.current ? engine.slots[engine.current].cueId : null;
  list.replaceChildren();
  let n = 0;
  let total = 0;
  state.cues.forEach((cue, idx) => {
    if (cue.type === 'text') {
      list.append(el('li', {
        class: 'cue text',
        draggable: !state.locked,
        dataset: { idx },
        ondblclick: () => editCue(cue),
      },
      el('span', { class: 'num' }, '—'),
      el('div', { class: 'info' }, el('div', { class: 'name', text: cue.text })),
      el('div', { class: 'actions edit-only' },
        el('button', { title: 'Modifier', onclick: () => editCue(cue) }, '✎'),
        el('button', { title: 'Retirer', onclick: () => removeCue(cue) }, '✕'))));
      return;
    }
    n++;
    const r = rt(cue.id);
    const dur = cueDuration(cue);
    if (dur) total += dur;
    const classes = ['cue'];
    if (cue.id === engine.standbyId) classes.push('standby');
    if (cue.id === currentId) classes.push('current');
    if (r.status === 'missing') classes.push('missing');
    if (r.status === 'error') classes.push('error');
    const p = engine.params(cue);
    const meta = [];
    if (r.status === 'missing') meta.push('Fichier introuvable');
    else if (r.status === 'error') meta.push(r.error || 'Illisible');
    else if (r.status === 'loading') meta.push('Analyse…');
    else {
      meta.push(fmtTime(dur));
      if (r.width) meta.push(`${r.width}×${r.height}`);
      if (cue.inPoint || cue.outPoint != null) meta.push('✂ coupée');
      if ((cue.volume ?? 1) !== 1) meta.push(`vol. ${Math.round(cue.volume * 100)} %`);
    }
    const thumb = el('div', { class: 'thumb' });
    if (r.thumb) thumb.style.backgroundImage = `url(${r.thumb})`;
    list.append(el('li', {
      class: classes.join(' '),
      draggable: !state.locked,
      dataset: { idx, id: cue.id },
      onclick: (e) => {
        if (e.target.closest('.actions, .ends')) return;
        if (isPlayable(cue)) engine.setStandby(cue.id);
      },
      ondblclick: (e) => {
        if (e.target.closest('.actions, .ends')) return;
        if (isPlayable(cue)) {
          engine.setStandby(cue.id);
          engine.go();
        }
      },
    },
    el('span', { class: 'num', text: n }),
    thumb,
    el('div', { class: 'info' },
      el('div', { class: 'name' }, cue.name,
        cue.id === engine.standbyId ? el('span', { class: 'badge', text: engine.pendingGo ? 'préparation…' : 'en attente' }) : null,
        cue.id === currentId ? el('span', { class: 'badge', text: 'à l’antenne' }) : null),
      el('div', { class: 'meta', text: meta.join(' · ') })),
    endButtons(cue, p.endAction),
    el('div', { class: 'actions' },
      r.status === 'missing' ? el('button', { class: 'edit-only', onclick: () => relink(cue) }, 'Relier…') : null,
      el('button', { class: 'edit-only', title: 'Réglages', onclick: () => editCue(cue) }, '✎'),
      el('button', { class: 'edit-only', title: 'Retirer', onclick: () => removeCue(cue) }, '✕')),
    cue.id === currentId ? el('div', { class: 'bar' }) : null));
  });
  $('#emptyHint').hidden = state.cues.length > 0;
  $('#totalDuration').textContent = n ? `${n} vidéo${n > 1 ? 's' : ''} · ${fmtTime(total)}` : '';
}

// Choix de l'action de fin directement depuis la conduite.
function endButtons(cue, current) {
  const group = el('div', { class: 'ends' });
  for (const [action, title] of END_ICONS) {
    const b = el('button', {
      class: `end-btn${action === current ? ' active' : ''}`,
      title,
      'aria-pressed': String(action === current),
      onclick: () => setEndAction(cue, action),
    });
    b.innerHTML = endIconSvg(action);
    group.append(b);
  }
  return group;
}

function setEndAction(cue, action) {
  if (state.locked || cue.endAction === action) return;
  cue.endAction = action;
  setDirty();
  engine.cueUpdated(cue);
}

function renderNow() {
  const cue = engine.currentCue;
  const st = engine.currentState;
  const badge = $('#nowState');
  const labels = { playing: 'LECTURE', paused: 'PAUSE', held: 'IMAGE FIGÉE', ending: 'FONDU', black: 'NOIR', armed: 'NOIR', done: 'NOIR', empty: 'NOIR', loading: 'NOIR' };
  badge.textContent = labels[st] || 'NOIR';
  badge.className = `state-badge state-${['playing', 'paused', 'held', 'ending'].includes(st) ? st : 'black'}`;
  $('#nowName').textContent = cue ? cue.name : '—';
  if (!cue) {
    $('#elapsed').textContent = '0:00';
    $('#remaining').textContent = '-0:00.0';
    $('#remaining').classList.remove('soon');
    $('#durationLabel').textContent = '';
    $('#progressFill').style.width = '0';
  }
  const standby = engine.standbyId ? engine.cue(engine.standbyId) : null;
  $('#standbyName').textContent = standby ? standby.name : '— fin de la conduite —';
  $('#standbyNotes').textContent = standby?.notes || '';
  renderPreview();
}

function renderTransport() {
  const st = engine.currentState;
  $('#goBtn').disabled = !engine.standbyId;
  $('#goBtn').classList.toggle('waiting', engine.pendingGo);
  $('#pauseBtn').disabled = !['playing', 'paused'].includes(st);
  $('#pauseBtn').classList.toggle('active', st === 'paused');
  $('#pauseBtn').textContent = st === 'paused' ? '▶ Reprendre' : '⏸ Pause';
  $('#stopBtn').disabled = !engine.isActive();
  $('#fadeBtn').disabled = !engine.isActive();
  $$('.mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.settings.mode));
}

function renderTime(ev) {
  const cue = engine.cue(ev.cueId);
  if (!cue) return;
  const p = engine.params(cue);
  const dur = rt(cue.id).duration || engine.slots[ev.slot].duration;
  const end = p.outPoint ?? dur;
  const len = end - p.inPoint;
  const el = ev.t - p.inPoint;
  const remain = Math.max(0, end - ev.t);
  $('#elapsed').textContent = fmtTime(el);
  $('#remaining').textContent = '-' + fmtTime(remain, true);
  $('#remaining').classList.toggle('soon', remain < 10 && ev.state === 'playing');
  $('#durationLabel').textContent = `/ ${fmtTime(len)}`;
  const pct = len > 0 ? Math.min(100, Math.max(0, (el / len) * 100)) : 0;
  $('#progressFill').style.width = `${pct}%`;
  const bar = $('.cue.current .bar');
  if (bar) bar.style.width = `${pct}%`;
  syncPreview(ev);
}

function renderLevel(ev) {
  const db = (v) => (v <= 0.0001 ? 0 : Math.max(0, Math.min(100, ((20 * Math.log10(v) + 48) / 48) * 100)));
  $('#meterL').style.width = `${db(ev.l)}%`;
  $('#meterR').style.width = `${db(ev.r)}%`;
}

// ---------- Retour vidéo (copie muette de ce qui passe sur le projecteur) ----------

const preview = $('#preview');
let previewCueId = null;

function renderPreview() {
  const on = state.settings.preview;
  $('#previewOff').hidden = on;
  const cue = engine.currentCue;
  const st = engine.currentState;
  if (!on || !cue) {
    preview.style.opacity = '0';
    if (!cue && previewCueId) {
      setTimeout(() => {
        if (!engine.currentCue) {
          preview.pause();
          previewCueId = null;
        }
      }, 600);
    }
    return;
  }
  const p = engine.params(cue);
  if (previewCueId !== cue.id) {
    previewCueId = cue.id;
    preview.src = api.mediaUrl(cue.path);
    preview.currentTime = p.inPoint;
  }
  preview.style.objectFit = p.fit;
  const visible = st === 'playing' || st === 'held' || (st === 'paused' && !state.settings.pauseOnBlack);
  preview.style.transitionDuration = `${st === 'ending' ? p.fadeOut : p.fadeIn}s`;
  preview.style.opacity = visible ? '1' : '0';
  if (st === 'playing') preview.play().catch(() => {});
  else preview.pause();
}

function syncPreview(ev) {
  if (!state.settings.preview || ev.cueId !== previewCueId) return;
  if (Math.abs(preview.currentTime - ev.t) > 0.3) preview.currentTime = ev.t;
  if (ev.state === 'playing' && preview.paused) preview.play().catch(() => {});
  if (ev.state !== 'playing' && ev.state !== 'ending' && !preview.paused) preview.pause();
}

// ---------- Écrans et sorties son ----------

async function refreshDisplays() {
  const { displays, status, target } = await api.invoke('displays:list');
  const sel = $('#outputSelect');
  sel.replaceChildren();
  for (const d of displays) {
    sel.append(el('option', { value: `display:${d.id}`, dataset: { label: d.label } },
      `${d.label} — ${d.width}×${d.height}${d.primary ? ' (écran principal)' : ''}`));
  }
  if (target.kind === 'display' && !displays.some((d) => d.id === target.id || d.label === target.label)) {
    sel.append(el('option', { value: `display:${target.id}`, dataset: { label: target.label } }, `${target.label || 'Projecteur'} — débranché`));
  }
  sel.append(el('option', { value: 'window' }, 'Fenêtre de test (sur cet écran)'));
  if (target.kind === 'window') sel.value = 'window';
  else {
    const match = displays.find((d) => d.id === target.id) || displays.find((d) => d.label === target.label);
    sel.value = `display:${match ? match.id : target.id}`;
  }
  renderOutputStatus(status, displays);
}

function renderOutputStatus(status, displays) {
  state.outputStatus = status;
  const warn = $('#outputWarning');
  const primary = displays?.find((d) => d.primary);
  if (status.kind === 'absent') {
    warn.textContent = `Projecteur « ${status.label || 'sortie vidéo'} » non détecté : la sortie reviendra dès qu'il sera rebranché.`;
    warn.hidden = false;
  } else if (status.kind === 'display' && primary && status.id === primary.id) {
    warn.textContent = 'La sortie vidéo est sur l’écran principal : elle recouvre cette fenêtre.';
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }
}

async function onOutputChange() {
  const sel = $('#outputSelect');
  const v = sel.value;
  const target = v === 'window' ? { kind: 'window' } : { kind: 'display', id: v.slice(8), label: sel.selectedOptions[0].dataset.label || '' };
  if (target.kind === 'display') {
    const { displays } = await api.invoke('displays:list');
    const d = displays.find((x) => x.id === target.id);
    if (d?.primary) {
      const r = await api.invoke('dialog:message', {
        type: 'warning',
        buttons: ['Utiliser cet écran', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        message: 'Projeter sur l’écran principal ?',
        detail: 'La sortie vidéo, noire en plein écran, recouvrira la fenêtre de régie. Pour revenir, utilisez Alt+Tab (Windows) ou ⌘+Tab (Mac), ou débranchez le projecteur.',
      });
      if (r.response !== 0) {
        refreshDisplays();
        return;
      }
    }
  }
  const status = await api.invoke('output:set', target);
  state.settings.output = target;
  await refreshDisplays();
  if (status.kind === 'absent') toast('Écran non détecté.', 'error');
}

async function refreshAudioDevices() {
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  } catch { /* liste vide */ }
  state.audioDevices = devices;
  const sel = $('#audioSelect');
  sel.replaceChildren(el('option', { value: 'default' }, 'Sortie par défaut du système'));
  for (const d of devices) {
    if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
    sel.append(el('option', { value: d.deviceId }, d.label || `Sortie ${sel.options.length}`));
  }
  const s = state.settings;
  let id = s.audioSinkId || 'default';
  if (id !== 'default' && !devices.some((d) => d.deviceId === id)) {
    const byLabel = devices.find((d) => d.label && d.label === s.audioSinkLabel);
    if (byLabel) id = byLabel.deviceId;
    else {
      sel.append(el('option', { value: id }, `${s.audioSinkLabel || 'Sortie choisie'} — débranchée`));
    }
  }
  sel.value = id;
  return id;
}

async function applyAudioSink(id) {
  const dev = state.audioDevices.find((d) => d.deviceId === id);
  state.settings = await api.invoke('settings:set', { audioSinkId: id, audioSinkLabel: dev?.label || '' });
  api.sendOutput({ type: 'sink', id });
}

let booted = false;

async function onOutputReady() {
  // La sortie vient de démarrer (ou redémarrer après un incident) : on lui renvoie tout.
  if (!booted) return;
  const id = await refreshAudioDevices();
  api.sendOutput({ type: 'sink', id });
  api.sendOutput({ type: 'master', value: state.settings.masterVolume });
  engine.resetAll();
  if (mireOn) setMire(true);
}

// ---------- Mire ----------

let mireOn = false;

function setMire(on) {
  mireOn = on && !engine.isActive();
  const sel = $('#outputSelect');
  const label = sel.selectedOptions[0]?.textContent || '';
  api.sendOutput({ type: 'mire', on: mireOn, info: { label } });
  $('#mireBtn').classList.toggle('active', mireOn);
  if (on && !mireOn) toast('La mire n’est disponible que lorsqu’aucune vidéo ne joue.', 'error');
}

// ---------- Verrouillage ----------

async function toggleLock() {
  if (!state.locked) {
    state.locked = true;
    setMire(false);
  } else {
    const r = await api.invoke('dialog:message', {
      type: 'question',
      buttons: ['Déverrouiller', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      message: 'Déverrouiller le mode spectacle ?',
      detail: 'Les modifications de la conduite et des sorties redeviennent possibles.',
    });
    if (r.response !== 0) return;
    state.locked = false;
  }
  renderAll();
}

// ---------- Mises à jour ----------

let pendingUpdate = null;

async function checkUpdates(manual = false) {
  const r = await api.invoke('update:check');
  if (r.status === 'available') {
    pendingUpdate = r;
    showUpdateBanner();
  } else if (manual) {
    if (r.status === 'uptodate') toast(`Projee ${r.current} est à jour.`, 'ok');
    else if (r.status === 'none') toast('Aucune version n’a encore été publiée.');
    else toast(`Impossible de vérifier les mises à jour (${r.message}). L’ordinateur est-il connecté à Internet ?`, 'error', 8000);
  }
}

// Le bandeau décale l'interface : on attend qu'aucune vidéo ne joue pour l'afficher.
function showUpdateBanner() {
  if (!pendingUpdate) return;
  if (engine.isActive()) {
    setTimeout(showUpdateBanner, 5000);
    return;
  }
  const r = pendingUpdate;
  $('#updateText').textContent = `Projee ${r.version} est disponible (vous avez la version ${r.current}).`;
  $('#updateBanner').hidden = false;
}

function bindUpdateBanner() {
  $('#updateDownload').addEventListener('click', () => {
    api.invoke('update:open', pendingUpdate.url);
    toast(updateInstallHint(), '', 12000);
  });
  $('#updateDetails').addEventListener('click', () => api.invoke('update:open', pendingUpdate.page));
  $('#updateLater').addEventListener('click', () => {
    $('#updateBanner').hidden = true;
    pendingUpdate = null;
  });
}

function updateInstallHint() {
  return state.info.platform === 'darwin'
    ? 'Ouvrez le fichier téléchargé, puis glissez Projee dans Applications en remplaçant l’ancienne version.'
    : 'Quittez Projee, puis lancez le fichier téléchargé : il remplace l’ancienne version, vos projets et réglages sont conservés.';
}

// ---------- Chronomètre et horloge ----------

const chrono = { start: null, acc: 0 };

function tickClocks() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('fr-FR');
  const ms = chrono.acc + (chrono.start ? Date.now() - chrono.start : 0);
  const s = Math.floor(ms / 1000);
  $('#chrono').textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
}

$('#chrono').addEventListener('click', () => {
  if (chrono.start) {
    chrono.acc += Date.now() - chrono.start;
    chrono.start = null;
  } else {
    chrono.start = Date.now();
  }
  $('#chrono').classList.toggle('running', !!chrono.start);
  tickClocks();
});
$('#chrono').addEventListener('dblclick', () => {
  chrono.start = null;
  chrono.acc = 0;
  $('#chrono').classList.remove('running');
  tickClocks();
});

// ---------- Commandes ----------

const actions = {
  go: () => engine.go(),
  pause: () => engine.togglePause(),
  stop: () => engine.stop(state.settings.stopFade),
  fade: () => engine.stop(state.settings.fadeToBlack),
  black: () => engine.black(),
  prev: () => moveStandby(-1),
  next: () => moveStandby(1),
};

function moveStandby(dir) {
  const playable = state.cues.filter(isPlayable);
  if (!playable.length) return;
  let i = playable.findIndex((c) => c.id === engine.standbyId);
  if (i < 0) i = dir > 0 ? -1 : playable.length;
  i = Math.max(0, Math.min(playable.length - 1, i + dir));
  engine.setStandby(playable[i].id);
}

function bindUi() {
  $('#goBtn').addEventListener('click', actions.go);
  $('#pauseBtn').addEventListener('click', actions.pause);
  $('#stopBtn').addEventListener('click', actions.stop);
  $('#fadeBtn').addEventListener('click', actions.fade);
  $('#blackBtn').addEventListener('click', actions.black);
  $('#addVideosBtn').addEventListener('click', async () => addVideos(await api.invoke('media:pick')));
  $('#addTextBtn').addEventListener('click', addText);
  $('#lockBtn').addEventListener('click', toggleLock);
  $('#mireBtn').addEventListener('click', () => setMire(!mireOn));
  bindUpdateBanner();
  $('#outputSelect').addEventListener('change', onOutputChange);
  $('#audioSelect').addEventListener('change', (e) => applyAudioSink(e.target.value));

  $$('.mode button').forEach((b) => b.addEventListener('click', async () => {
    state.settings = await api.invoke('settings:set', { mode: b.dataset.mode });
    renderTransport();
  }));

  const vol = $('#masterVolume');
  vol.value = state.settings.masterVolume;
  vol.addEventListener('input', () => {
    api.sendOutput({ type: 'master', value: Number(vol.value) });
    api.invoke('settings:set', { masterVolume: Number(vol.value) }).then((s) => (state.settings = s));
  });

  $('#progress').addEventListener('click', (e) => {
    if (state.locked) return;
    const cue = engine.currentCue;
    if (!cue) return;
    const p = engine.params(cue);
    const end = p.outPoint ?? rt(cue.id).duration;
    const r = e.currentTarget.getBoundingClientRect();
    engine.seek(p.inPoint + ((e.clientX - r.left) / r.width) * (end - p.inPoint));
  });

  // Menu
  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', () => {
    menu.hidden = true;
  });
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    menu.hidden = true;
    const run = {
      new: async () => {
        if (engine.isActive() && !(await confirmStopPlayback())) return;
        if (await confirmDiscard()) newProject();
      },
      open: () => openProject(),
      save: () => save(),
      saveAs: () => save(true),
      export: exportProject,
      settings: () => openSettings(state.settings, state.info, async (patch) => {
        state.settings = await api.invoke('settings:set', patch);
        for (const c of state.cues) if (c.type === 'video') engine.cueUpdated(c);
        renderAll();
      }),
      update: () => checkUpdates(true),
      shortcuts: openShortcuts,
      about: () => openAbout(state.info),
    }[action];
    run?.();
  });

  // Les boutons ne gardent pas le focus : Espace doit toujours déclencher le GO.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.closest('dialog')) b.blur();
  });

  document.addEventListener('keydown', onKey, true);
  bindDragDrop();
}

function onKey(e) {
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  if (t.matches('input[type=text], input[type=number], textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save(e.shiftKey);
    return;
  }
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    if (!state.locked) openProject();
    return;
  }
  if (mod || e.altKey) return;
  const key = e.key;
  let action = null;
  if (key === ' ' || key === 'PageDown') action = 'go';
  else if (key === 'Escape') action = e.shiftKey ? 'black' : 'fade';
  else if (key === 'b' || key === 'B') action = 'black';
  else if (key === 'p' || key === 'P') action = 'pause';
  else if (key === 's' || key === 'S') action = 'stop';
  else if (key === 'ArrowUp' || key === 'PageUp') action = 'prev';
  else if (key === 'ArrowDown') action = 'next';
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat && action === 'go') return; // une touche maintenue ne relance pas
  actions[action]();
}

// ---------- Glisser-déposer ----------

function bindDragDrop() {
  const section = $('.cues');
  const list = $('#cueList');
  let dragIdx = null;

  const dropIndex = (e) => {
    const li = e.target.closest('.cue');
    if (!li) return state.cues.length;
    const r = li.getBoundingClientRect();
    const idx = Number(li.dataset.idx);
    return e.clientY > r.top + r.height / 2 ? idx + 1 : idx;
  };
  const clearMarks = () => $$('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));

  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.cue');
    if (!li || state.locked) return;
    dragIdx = Number(li.dataset.idx);
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-projee-cue', String(dragIdx));
  });
  list.addEventListener('dragend', () => {
    dragIdx = null;
    clearMarks();
    $$('.dragging').forEach((n) => n.classList.remove('dragging'));
  });

  section.addEventListener('dragover', (e) => {
    if (state.locked) return;
    const files = e.dataTransfer.types.includes('Files');
    if (dragIdx == null && !files) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = files ? 'copy' : 'move';
    section.classList.toggle('drop-target', files);
    clearMarks();
    const li = e.target.closest('.cue');
    if (li) {
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
    }
  });
  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget)) {
      section.classList.remove('drop-target');
      clearMarks();
    }
  });
  section.addEventListener('drop', (e) => {
    e.preventDefault();
    section.classList.remove('drop-target');
    clearMarks();
    if (state.locked) return;
    const idx = dropIndex(e);
    if (dragIdx != null) {
      moveCue(dragIdx, idx);
      dragIdx = null;
      return;
    }
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    const projectFile = paths.find((p) => p.toLowerCase().endsWith('.projee'));
    if (projectFile) openProject(projectFile);
    else addVideos(paths, idx);
  });
  // Empêche Electron d'ouvrir un fichier lâché ailleurs dans la fenêtre.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

// ---------- Démarrage ----------

async function start() {
  state.info = await api.invoke('app:info');
  state.settings = await api.invoke('settings:get');
  bindUi();
  renderAll();
  tickClocks();
  setInterval(tickClocks, 250);

  await refreshDisplays();
  await refreshAudioDevices();
  navigator.mediaDevices.addEventListener('devicechange', refreshAudioDevices);
  api.on('displays:changed', refreshDisplays);
  api.on('output:status', (status) => refreshDisplays().then(() => renderOutputStatus(status)));
  api.on('project:openRequest', (file) => openProject(file));
  api.on('app:closeRequest', async () => {
    if (engine.isActive() && !(await confirmStopPlayback())) return;
    if (!(await confirmDiscard())) return;
    api.invoke('app:quit');
  });

  booted = true;
  if (await api.invoke('output:isReady')) await onOutputReady();

  if (state.info.selftest) {
    const previewUpdate = (r) => {
      pendingUpdate = r;
      showUpdateBanner();
    };
    selftestHook = await runSelftest({ state, engine, actions, addVideos, rt, editCue, previewUpdate });
    return;
  }

  if (state.settings.checkUpdates) setTimeout(() => checkUpdates(false), 3000);

  const toOpen = state.info.pendingOpen || state.settings.lastProject;
  if (toOpen) {
    try {
      loadProject(await api.invoke('project:openPath', toOpen));
    } catch {
      if (state.info.pendingOpen) toast(`Impossible d'ouvrir ${toOpen}`, 'error');
    }
  }
}

start();
