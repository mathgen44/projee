// Fenêtre de réglage d'une vidéo ou d'une ligne de texte de la conduite.
import { $, escapeHtml, fmtInputTime, fmtTime, parseTime, toast } from './util.js';

const END_ACTIONS = [
  ['black', 'Retour au noir'],
  ['hold', 'Figer la dernière image'],
  ['loop', 'Boucle (jusqu’au GO suivant ou Stop)'],
  ['next', 'Enchaîner sur la suivante sans noir'],
];

const FITS = [
  ['contain', 'Adapter (bandes noires si besoin)'],
  ['cover', 'Remplir l’écran (rogne les bords)'],
  ['fill', 'Étirer (déforme l’image)'],
];

export function openCueEditor(cue, runtime, settings, onSave) {
  const dlg = $('#cueDialog');
  if (cue.type === 'text') {
    dlg.innerHTML = `
      <form method="dialog">
        <header>Ligne de texte</header>
        <div class="body">
          <textarea name="text" rows="4" placeholder="Réplique, repère, mouvement…">${escapeHtml(cue.text || '')}</textarea>
          <div class="hint">Les lignes de texte servent de repère dans la conduite ; GO les saute.</div>
        </div>
        <footer>
          <button class="btn" value="cancel">Annuler</button>
          <button class="btn primary" value="ok">Enregistrer</button>
        </footer>
      </form>`;
    dlg.onclose = () => {
      if (dlg.returnValue === 'ok') onSave({ text: $('[name=text]', dlg).value.trim() || 'Texte' });
    };
    dlg.showModal();
    $('[name=text]', dlg).focus();
    return;
  }

  const duration = runtime?.duration;
  const opt = (list, value) => list.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('');
  dlg.innerHTML = `
    <form method="dialog">
      <header>Réglages de la vidéo</header>
      <div class="body">
        <label class="row"><span>Nom</span><input type="text" name="name" value="${escapeHtml(cue.name)}"></label>
        <div class="hint">${escapeHtml(cue.path)}${duration ? ` — durée ${fmtTime(duration)}` : ''}${runtime?.width ? ` — ${runtime.width}×${runtime.height}` : ''}</div>

        <div class="editor-video-wrap"><video id="editorVideo" controls muted preload="auto"></video></div>
        <div class="row-inline">
          <label class="row-inline"><input type="checkbox" id="editorSound"> Écouter le son ici</label>
          <span class="hint">(sur la sortie son par défaut de l'ordinateur, pas celle du spectacle)</span>
        </div>

        <h3>Début et fin</h3>
        <div class="row-inline">
          <span>Début</span><input class="time-input" type="text" name="inPoint" value="${fmtInputTime(cue.inPoint || 0)}">
          <button type="button" class="btn" id="setIn">= position</button>
          <span style="width:20px"></span>
          <span>Fin</span><input class="time-input" type="text" name="outPoint" value="${cue.outPoint != null ? fmtInputTime(cue.outPoint) : ''}" placeholder="fin du fichier">
          <button type="button" class="btn" id="setOut">= position</button>
        </div>
        <div class="hint">Format m:ss.cc. Laissez la fin vide pour lire jusqu'au bout du fichier.</div>

        <h3>Fondus et son</h3>
        <label class="row"><span>Fondu d'entrée (s)</span><span class="row-inline"><input class="num-input" type="number" step="0.1" min="0" name="fadeIn" value="${cue.fadeIn ?? ''}" placeholder="${settings.fadeIn}"><span class="hint">vide = réglage général (${settings.fadeIn} s), 0 = coupe franche</span></span></label>
        <label class="row"><span>Fondu de sortie (s)</span><span class="row-inline"><input class="num-input" type="number" step="0.1" min="0" name="fadeOut" value="${cue.fadeOut ?? ''}" placeholder="${settings.fadeOut}"><span class="hint">vide = réglage général (${settings.fadeOut} s)</span></span></label>
        <label class="row"><span>Volume</span><span class="row-inline"><input type="range" name="volume" min="0" max="2" step="0.05" value="${cue.volume ?? 1}"><span id="volumeLabel"></span></span></label>

        <h3>Comportement</h3>
        <label class="row"><span>À la fin</span><select name="endAction">${opt(END_ACTIONS, cue.endAction || 'black')}</select></label>
        <label class="row"><span>Cadrage</span><select name="fit">${opt(FITS, cue.fit || 'contain')}</select></label>
        <label class="row"><span>Notes de régie</span><textarea name="notes" rows="2" placeholder="Affichées sous « En attente »">${escapeHtml(cue.notes || '')}</textarea></label>
      </div>
      <footer>
        <button class="btn" value="cancel">Annuler</button>
        <button class="btn primary" value="ok" id="saveCue">Enregistrer</button>
      </footer>
    </form>`;

  const video = $('#editorVideo', dlg);
  video.src = window.projee.mediaUrl(cue.path);
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = cue.inPoint || 0;
  }, { once: true });
  $('#editorSound', dlg).addEventListener('change', (e) => {
    video.muted = !e.target.checked;
  });
  $('#setIn', dlg).addEventListener('click', () => {
    $('[name=inPoint]', dlg).value = fmtInputTime(video.currentTime);
  });
  $('#setOut', dlg).addEventListener('click', () => {
    $('[name=outPoint]', dlg).value = fmtInputTime(video.currentTime);
  });
  const vol = $('[name=volume]', dlg);
  const showVol = () => {
    $('#volumeLabel', dlg).textContent = `${Math.round(vol.value * 100)} %`;
  };
  vol.addEventListener('input', showVol);
  showVol();

  $('#saveCue', dlg).addEventListener('click', (e) => {
    const inPoint = parseTime($('[name=inPoint]', dlg).value) ?? 0;
    const outPoint = parseTime($('[name=outPoint]', dlg).value);
    const bad = Number.isNaN(inPoint) || Number.isNaN(outPoint)
      || (outPoint != null && outPoint <= inPoint)
      || (duration && inPoint >= duration);
    if (bad) {
      e.preventDefault();
      toast('Début ou fin incorrect : la fin doit être après le début, et le début dans la vidéo.', 'error');
    }
  });

  dlg.onclose = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (dlg.returnValue !== 'ok') return;
    const num = (name) => {
      const v = $(`[name=${name}]`, dlg).value.trim();
      return v === '' ? null : Math.max(0, Number(v));
    };
    const outPoint = parseTime($('[name=outPoint]', dlg).value);
    onSave({
      name: $('[name=name]', dlg).value.trim() || cue.name,
      inPoint: parseTime($('[name=inPoint]', dlg).value) || 0,
      outPoint: outPoint != null && duration && outPoint >= duration - 0.01 ? null : outPoint,
      fadeIn: num('fadeIn'),
      fadeOut: num('fadeOut'),
      volume: Number(vol.value),
      endAction: $('[name=endAction]', dlg).value,
      fit: $('[name=fit]', dlg).value,
      notes: $('[name=notes]', dlg).value.trim(),
    });
  };
  dlg.returnValue = '';
  dlg.showModal();
}

// Icônes des actions de fin, affichées sur chaque vidéo de la conduite.
export const END_ICONS = [
  ['black', 'Fin : retour au noir', '<rect x="3" y="3" width="14" height="14" rx="2" fill="currentColor"/>'],
  ['hold', 'Fin : figer la dernière image', '<rect x="2.5" y="4" width="15" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 13.5l3.5-4 2.5 2.5 1.8-1.8 2.7 3.3z" fill="currentColor"/><circle cx="13.5" cy="7.3" r="1.3" fill="currentColor"/>'],
  ['loop', 'Fin : boucle jusqu’au GO suivant ou Stop', '<path d="M15.5 8A5.5 5.5 0 0 0 5 6.2M4.5 12A5.5 5.5 0 0 0 15 13.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 3v4h4M16.5 17v-4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'],
  ['next', 'Fin : enchaîner sur la vidéo suivante sans noir', '<path d="M3 10h10M9.5 5.5L14 10l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 4.5v11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'],
];

export function endIconSvg(action) {
  const entry = END_ICONS.find(([a]) => a === action) || END_ICONS[0];
  return `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">${entry[2]}</svg>`;
}
