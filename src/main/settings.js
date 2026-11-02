'use strict';
// Réglages de l'application (pas du projet) : écran et sortie son choisis, valeurs par défaut des fondus…
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  output: null,              // { kind: 'display', id, label } | { kind: 'window' }
  audioSinkId: 'default',
  audioSinkLabel: '',
  fadeIn: 0.5,               // secondes, fondu depuis le noir au départ d'une vidéo
  fadeOut: 0.5,              // secondes, fondu vers le noir à la fin d'une vidéo
  fadeToBlack: 2,            // secondes, bouton « Fondu au noir »
  stopFade: 0.3,             // secondes, bouton « Stop »
  pauseOnBlack: false,       // la pause masque l'image au lieu de la figer
  playlistGap: 0,            // secondes de noir entre deux vidéos en mode playlist
  mode: 'single',            // 'single' (un GO par vidéo) | 'playlist' (enchaîne toute la liste)
  masterVolume: 1,
  preview: true,             // retour vidéo dans la fenêtre de régie
  lastProject: null,
  controlBounds: null,
};

let file;
let data = { ...DEFAULTS };
let timer = null;

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
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
