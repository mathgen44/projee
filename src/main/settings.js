'use strict';
// Réglages de l'application (pas du projet) : écran et sortie son choisis, valeurs par défaut des fondus…
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 3;

const DEFAULTS = {
  version: VERSION,
  output: null,             // { kind: 'display', id, label } | { kind: 'window' }
  audioSinkId: 'default',
  audioSinkLabel: '',
  fadeIn: 0,                 // secondes, fondu depuis le noir au départ d'une vidéo (0 = coupe franche)
  fadeOut: 0,                // secondes, fondu vers le noir à la fin d'une vidéo
  fadeToBlack: 2,            // secondes, bouton « Fondu au noir »
  stopFade: 0.3,             // secondes, bouton « Stop »
  pauseOnBlack: false,       // la pause masque l'image au lieu de la figer
  playlistGap: 1,            // secondes de noir avant la suivante, pour les vidéos « noir puis suivante »
  masterVolume: 1,
  preview: true,             // retour vidéo dans la fenêtre de régie
  checkUpdates: true,        // recherche d'une nouvelle version au lancement
  lastProject: null,
  controlBounds: null,
};

let file;
let data = { ...DEFAULTS };
let timer = null;

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    data = migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

function migrate(saved) {
  if (!saved.version) {
    // Version 1 : les fondus valaient 0,5 s par défaut ; ils sont désormais à 0.
    if (saved.fadeIn === 0.5) saved.fadeIn = 0;
    if (saved.fadeOut === 0.5) saved.fadeOut = 0;
  }
  if (!saved.version || saved.version < 3) {
    // Version 3 : plus de mode « playlist » global, chaque vidéo choisit sa fin ;
    // le noir avant la suivante passe de 0 à 1 s par défaut.
    delete saved.mode;
    if (saved.playlistGap === 0) saved.playlistGap = 1;
  }
  return { ...DEFAULTS, ...saved, version: VERSION };
}

function get() {
  return data;
}

function writeNow() {
  clearTimeout(timer);
  timer = null;
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('settings write failed', err);
  }
}

function set(patch) {
  data = { ...data, ...patch };
  clearTimeout(timer);
  timer = setTimeout(writeNow, 300);
  return data;
}

module.exports = { DEFAULTS, load, get, set, flush: writeNow };
