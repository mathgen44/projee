// Réglages généraux, raccourcis clavier, à propos.
import { $, escapeHtml } from './util.js';

export function openSettings(settings, info, onSave) {
  const dlg = $('#settingsDialog');
  const num = (name, label, hint, step = 0.1) => `
    <label class="row"><span>${label}</span><span class="row-inline">
      <input class="num-input" type="number" min="0" step="${step}" name="${name}" value="${settings[name]}">
      <span class="hint">${hint}</span></span></label>`;
  dlg.innerHTML = `
    <form method="dialog">
      <header>Réglages</header>
      <div class="body">
        <h3>Fondus par défaut</h3>
        ${num('fadeIn', "Fondu d'entrée (s)", 'Depuis le noir, au départ de chaque vidéo. 0 = coupe franche.')}
        ${num('fadeOut', 'Fondu de sortie (s)', 'Vers le noir, à la fin de chaque vidéo.')}
        ${num('stopFade', 'Bouton Stop (s)', 'Fondu court quand on arrête une vidéo.')}
        ${num('fadeToBlack', 'Bouton Fondu au noir (s)', 'Fondu long, image et son.')}

        <h3>Lecture</h3>
        <label class="row"><span>Pause</span><select name="pauseOnBlack">
          <option value="false" ${!settings.pauseOnBlack ? 'selected' : ''}>Fige l'image sur le projecteur</option>
          <option value="true" ${settings.pauseOnBlack ? 'selected' : ''}>Passe au noir pendant la pause</option>
        </select></label>
        ${num('playlistGap', 'Noir entre deux vidéos (s)', 'En mode playlist, durée du noir avant la vidéo suivante.', 0.5)}
        <label class="row"><span>Retour vidéo</span><select name="preview">
          <option value="true" ${settings.preview ? 'selected' : ''}>Affiché dans la régie</option>
          <option value="false" ${!settings.preview ? 'selected' : ''}>Désactivé (économise le processeur)</option>
        </select></label>

        <label class="row"><span>Mises à jour</span><select name="checkUpdates">
          <option value="true" ${settings.checkUpdates ? 'selected' : ''}>Rechercher au lancement</option>
          <option value="false" ${!settings.checkUpdates ? 'selected' : ''}>Ne pas rechercher (menu ☰ pour le faire à la main)</option>
        </select></label>

        <h3>Avant le spectacle</h3>
        <ul class="hint">
          <li>Branchez le projecteur en mode <strong>Étendre</strong> (Windows : touche Windows + P), pas en mode Dupliquer.</li>
          <li>Sur Mac : Réglages Système → Bureau et Dock → activez « Les écrans disposent d'espaces distincts ».</li>
          <li>Activez « Ne pas déranger » pour qu'aucune notification n'apparaisse.</li>
          <li>Utilisez le bouton <strong>Mire</strong> pour vérifier le bon écran et le cadrage, puis verrouillez (cadenas).</li>
          <li>Testez chaque vidéo sur l'ordinateur du spectacle : un format refusé est signalé dans la conduite.</li>
        </ul>
        <div class="hint">Journal d'erreurs : ${escapeHtml(info.userData)}</div>
      </div>
      <footer>
        <button class="btn" value="cancel">Annuler</button>
        <button class="btn primary" value="ok">Enregistrer</button>
      </footer>
    </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const n = (name) => Math.max(0, Number($(`[name=${name}]`, dlg).value) || 0);
    onSave({
      fadeIn: n('fadeIn'),
      fadeOut: n('fadeOut'),
      stopFade: n('stopFade'),
      fadeToBlack: n('fadeToBlack'),
      playlistGap: n('playlistGap'),
      pauseOnBlack: $('[name=pauseOnBlack]', dlg).value === 'true',
      preview: $('[name=preview]', dlg).value === 'true',
      checkUpdates: $('[name=checkUpdates]', dlg).value === 'true',
    });
  };
  dlg.returnValue = '';
  dlg.showModal();
}

export function openShortcuts() {
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl';
  showInfo('Raccourcis clavier', `
    <table>
      <tr><td><kbd>Espace</kbd> ou <kbd>Page suivante</kbd></td><td>GO : lance la vidéo en attente</td></tr>
      <tr><td><kbd>P</kbd></td><td>Pause / reprise</td></tr>
      <tr><td><kbd>S</kbd></td><td>Stop (fondu court)</td></tr>
      <tr><td><kbd>Échap</kbd></td><td>Fondu au noir</td></tr>
      <tr><td><kbd>Maj</kbd> + <kbd>Échap</kbd> ou <kbd>B</kbd></td><td>NOIR immédiat</td></tr>
      <tr><td><kbd>↑</kbd> <kbd>↓</kbd> ou <kbd>Page précédente</kbd></td><td>Choisir la vidéo en attente</td></tr>
      <tr><td>Double-clic sur une vidéo</td><td>La lancer tout de suite</td></tr>
      <tr><td><kbd>${mod}</kbd> + <kbd>S</kbd> / <kbd>O</kbd></td><td>Enregistrer / ouvrir</td></tr>
    </table>
    <p class="hint">Une pédale ou une télécommande de présentation qui envoie Espace ou Page suivante déclenche le GO.</p>`);
}

export function openAbout(info) {
  showInfo('À propos de Projee', `
    <p><strong>Projee ${escapeHtml(info.version)}</strong> — lecteur vidéo de spectacle.</p>
    <p>Le projecteur ne montre que du noir tant qu'aucune vidéo n'est lancée, et revient au noir à la fin de chaque lecture.</p>
    <p class="hint">Libre et gratuit (licence MIT). De la même famille que Jinglee.</p>`);
}

function showInfo(title, html) {
  const dlg = $('#infoDialog');
  dlg.innerHTML = `<form method="dialog"><header>${escapeHtml(title)}</header><div class="body">${html}</div>
    <footer><button class="btn primary" value="ok">Fermer</button></footer></form>`;
  dlg.showModal();
}
